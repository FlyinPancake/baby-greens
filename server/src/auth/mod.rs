//! Login through an OIDC provider, with the server as a confidential client. The browser only
//! ever holds a session cookie, never an OIDC token.

mod oidc;
mod origin;

use anyhow::{Context, anyhow};
use axum::{
    Router,
    extract::{FromRequestParts, Query, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use openidconnect::{
    AuthorizationCode, CsrfToken, Nonce, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope,
    TokenResponse, core::CoreAuthenticationFlow,
};
use serde::{Deserialize, Serialize};
use tower_sessions::{Expiry, Session, cookie::time::Duration};
use url::Url;
use uuid::Uuid;

use self::oidc::Provider;
pub use self::origin::require_same_origin;
use crate::{
    AppState,
    config::OidcConfig,
    db::users::{self, Identity, User},
    error::AppError,
};

const USER_ID_KEY: &str = "user_id";
const PENDING_LOGIN_KEY: &str = "pending_login";

/// How long a signed-in session lasts without a visit.
pub const SESSION_IDLE_TIMEOUT: Duration = Duration::days(30);
/// How long a started login waits for the provider to redirect back.
const PENDING_LOGIN_TIMEOUT: Duration = Duration::minutes(10);

pub struct AuthState {
    oidc: Provider,
    allowed_group: Option<String>,
    /// `PUBLIC_URL` as an origin, like `https://greens.example.ts.net`.
    public_origin: String,
}

impl AuthState {
    pub async fn new(config: &OidcConfig, public_url: &Url) -> anyhow::Result<Self> {
        let redirect_url = public_url
            .join("auth/callback")
            .context("could not build the OIDC redirect URL")?;

        let oidc = Provider::discover(config, RedirectUrl::from_url(redirect_url)).await?;

        Ok(Self {
            oidc,
            allowed_group: config.allowed_group.clone(),
            public_origin: public_url.origin().ascii_serialization(),
        })
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/login", get(login))
        .route("/callback", get(callback))
        .route("/logout", post(logout))
}

/// The signed-in user. Use it as a handler argument to require login. Requests without a valid
/// session get a 401.
pub struct AuthUser(pub User);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|(_, message)| anyhow!(message))?;

        let Some(user_id) = session.get::<Uuid>(USER_ID_KEY).await? else {
            return Err(AppError::Unauthorized);
        };

        match users::find(&state.pool, user_id).await? {
            Some(user) => Ok(Self(user)),
            None => {
                // The user row is gone, so the session is useless.
                session.flush().await?;
                Err(AppError::Unauthorized)
            }
        }
    }
}

/// What the login request remembers until the provider redirects back.
#[derive(Serialize, Deserialize)]
struct PendingLogin {
    csrf_state: String,
    nonce: String,
    pkce_verifier: String,
    return_to: String,
}

#[derive(Deserialize)]
struct LoginQuery {
    return_to: Option<String>,
}

async fn login(
    State(state): State<AppState>,
    session: Session,
    Query(query): Query<LoginQuery>,
) -> Result<Redirect, AppError> {
    let auth = &state.auth;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let client = auth.oidc.client();
    let mut request = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("email".to_owned()))
        .add_scope(Scope::new("profile".to_owned()))
        .set_pkce_challenge(pkce_challenge);

    if auth.allowed_group.is_some() {
        request = request.add_scope(Scope::new("groups".to_owned()));
    }

    let (url, csrf_state, nonce) = request.url();

    let pending = PendingLogin {
        csrf_state: csrf_state.secret().clone(),
        nonce: nonce.secret().clone(),
        pkce_verifier: pkce_verifier.secret().clone(),
        return_to: safe_return_to(query.return_to.as_deref()).to_owned(),
    };
    session.set_expiry(Some(Expiry::OnInactivity(PENDING_LOGIN_TIMEOUT)));
    session.insert(PENDING_LOGIN_KEY, pending).await?;

    Ok(Redirect::to(url.as_str()))
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Why a login failed. The code goes to the frontend as `/?auth_error=<code>`.
#[derive(Debug, thiserror::Error)]
enum LoginError {
    #[error("the provider returned an error: {0}")]
    Provider(String),
    #[error("no login was in progress, or it expired")]
    Expired,
    #[error("the state parameter didn't match")]
    StateMismatch,
    #[error("the user isn't in the allowed group")]
    NotAllowed,
    #[error(transparent)]
    Failed(#[from] anyhow::Error),
}

impl LoginError {
    fn code(&self) -> &'static str {
        match self {
            Self::Provider(_) => "provider",
            Self::Expired => "expired",
            Self::StateMismatch => "state_mismatch",
            Self::NotAllowed => "not_allowed",
            Self::Failed(_) => "failed",
        }
    }
}

async fn callback(
    State(state): State<AppState>,
    session: Session,
    Query(query): Query<CallbackQuery>,
) -> Response {
    match finish_login(&state, &session, query).await {
        Ok(return_to) => Redirect::to(&return_to).into_response(),
        Err(error) => {
            tracing::warn!(error = format!("{error:#}"), "login failed");
            Redirect::to(&format!("/?auth_error={}", error.code())).into_response()
        }
    }
}

/// Checks the callback, exchanges the code, and starts a session. Returns where to send the
/// user next.
async fn finish_login(
    state: &AppState,
    session: &Session,
    query: CallbackQuery,
) -> Result<String, LoginError> {
    let auth = &state.auth;

    let pending: PendingLogin = session
        .remove(PENDING_LOGIN_KEY)
        .await
        .context("could not read the session")?
        .ok_or(LoginError::Expired)?;

    if let Some(error) = query.error {
        return Err(LoginError::Provider(error));
    }

    if query.state.as_deref() != Some(pending.csrf_state.as_str()) {
        return Err(LoginError::StateMismatch);
    }

    let code = query.code.context("the callback had no code")?;

    let token = auth
        .oidc
        .client()
        .exchange_code(AuthorizationCode::new(code))
        .context("the provider has no token endpoint")?
        .set_pkce_verifier(PkceCodeVerifier::new(pending.pkce_verifier))
        .request_async(auth.oidc.http())
        .await
        .context("could not exchange the code for tokens")?;

    let id_token = token.id_token().context("the provider sent no ID token")?;
    let claims = auth
        .oidc
        .verify(id_token, &Nonce::new(pending.nonce))
        .await?;

    if let Some(group) = &auth.allowed_group
        && !claims.additional_claims().groups.contains(group)
    {
        return Err(LoginError::NotAllowed);
    }

    let email = claims.email().map(|email| email.as_str());
    let display_name = claims
        .name()
        .and_then(|name| name.get(None))
        .map(|name| name.as_str())
        .or_else(|| claims.preferred_username().map(|name| name.as_str()))
        .or(email)
        .unwrap_or_else(|| claims.subject().as_str());

    let identity = Identity {
        issuer: claims.issuer().as_str(),
        subject: claims.subject().as_str(),
        display_name,
        email,
    };
    let user_id = users::upsert_from_identity(&state.pool, &identity)
        .await
        .context("could not save the user")?;

    // A new session id on login stops session fixation.
    session
        .cycle_id()
        .await
        .context("could not rotate the session id")?;
    session.set_expiry(Some(Expiry::OnInactivity(SESSION_IDLE_TIMEOUT)));
    session
        .insert(USER_ID_KEY, user_id)
        .await
        .context("could not save the session")?;

    tracing::info!(%user_id, "user signed in");
    Ok(pending.return_to)
}

async fn logout(session: Session) -> Result<StatusCode, AppError> {
    session.flush().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Only allows paths on this site, so the login flow can't be used as an open redirect.
fn safe_return_to(return_to: Option<&str>) -> &str {
    match return_to {
        Some(path) if path.starts_with('/') && !path.starts_with("//") && !path.contains('\\') => {
            path
        }
        _ => "/",
    }
}

#[cfg(test)]
mod tests {
    use super::safe_return_to;

    #[test]
    fn return_to_keeps_local_paths() {
        assert_eq!(
            safe_return_to(Some("/batches/42?tab=log")),
            "/batches/42?tab=log"
        );
    }

    #[test]
    fn return_to_rejects_other_sites() {
        assert_eq!(safe_return_to(None), "/");
        assert_eq!(safe_return_to(Some("https://evil.example")), "/");
        assert_eq!(safe_return_to(Some("//evil.example")), "/");
        assert_eq!(safe_return_to(Some("/\\evil.example")), "/");
        assert_eq!(safe_return_to(Some("batches")), "/");
    }
}
