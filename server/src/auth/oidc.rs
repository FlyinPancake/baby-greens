use anyhow::{Context, Result};
use openidconnect::{
    AdditionalClaims, Client, ClientId, ClientSecret, EmptyExtraTokenFields, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, IdTokenFields, IssuerUrl, RedirectUrl, StandardErrorResponse,
    StandardTokenResponse,
    core::{
        CoreAuthDisplay, CoreAuthPrompt, CoreErrorResponseType, CoreGenderClaim, CoreJsonWebKey,
        CoreJweContentEncryptionAlgorithm, CoreJwsSigningAlgorithm, CoreProviderMetadata,
        CoreRevocableToken, CoreRevocationErrorResponse, CoreTokenIntrospectionResponse,
        CoreTokenType,
    },
    reqwest,
};
use serde::{Deserialize, Serialize};

use crate::config::OidcConfig;

/// The non-standard `groups` claim, used for `OIDC_ALLOWED_GROUP`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupsClaim {
    #[serde(default)]
    pub groups: Vec<String>,
}

impl AdditionalClaims for GroupsClaim {}

type IdTokenFieldsWithGroups = IdTokenFields<
    GroupsClaim,
    EmptyExtraTokenFields,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJwsSigningAlgorithm,
>;

type TokenResponse = StandardTokenResponse<IdTokenFieldsWithGroups, CoreTokenType>;

/// `CoreClient` with the groups claim, in the endpoint state that discovery produces.
pub type OidcClient = Client<
    GroupsClaim,
    CoreAuthDisplay,
    CoreGenderClaim,
    CoreJweContentEncryptionAlgorithm,
    CoreJsonWebKey,
    CoreAuthPrompt,
    StandardErrorResponse<CoreErrorResponseType>,
    TokenResponse,
    CoreTokenIntrospectionResponse,
    CoreRevocableToken,
    CoreRevocationErrorResponse,
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;

/// HTTP client for talking to the provider. It must not follow redirects, so a compromised
/// provider can't point token requests at internal services.
pub fn http_client() -> Result<reqwest::Client> {
    reqwest::ClientBuilder::new()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("could not build the OIDC HTTP client")
}

pub async fn discover(
    config: &OidcConfig,
    redirect_url: RedirectUrl,
    http: &reqwest::Client,
) -> Result<OidcClient> {
    let issuer = IssuerUrl::new(config.issuer_url.clone()).context("OIDC_ISSUER_URL is invalid")?;

    let metadata = CoreProviderMetadata::discover_async(issuer, http)
        .await
        .with_context(|| format!("could not run OIDC discovery for {}", config.issuer_url))?;

    let client = OidcClient::from_provider_metadata(
        metadata,
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
    )
    .set_redirect_uri(redirect_url);

    Ok(client)
}
