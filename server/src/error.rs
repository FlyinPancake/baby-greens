use axum::{
    Json,
    extract::rejection::{JsonRejection, PathRejection, QueryRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::plant::Problem;

/// Error type for API handlers. Internal errors are logged and hidden from the client.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not signed in")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("invalid input")]
    Invalid(Vec<Problem>),
    /// The request is valid but conflicts with the current state, like completing a done task.
    #[error("conflict: {0}")]
    Conflict(&'static str),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// The body of every error response.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    /// A stable code, like `not_found`, `invalid`, or `task_done`.
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// For `invalid`, what's wrong with each field.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<Problem>,
}

impl AppError {
    /// A single validation problem.
    pub fn invalid(path: &str, message: &str) -> Self {
        Self::Invalid(vec![Problem {
            path: path.to_owned(),
            message: message.to_owned(),
        }])
    }
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

impl From<tower_sessions::session::Error> for AppError {
    fn from(error: tower_sessions::session::Error) -> Self {
        Self::Internal(error.into())
    }
}

impl From<JsonRejection> for AppError {
    fn from(rejection: JsonRejection) -> Self {
        Self::BadRequest(rejection.body_text())
    }
}

impl From<PathRejection> for AppError {
    fn from(rejection: PathRejection) -> Self {
        Self::BadRequest(rejection.body_text())
    }
}

impl From<QueryRejection> for AppError {
    fn from(rejection: QueryRejection) -> Self {
        Self::BadRequest(rejection.body_text())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error, message, problems) = match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized", None, Vec::new()),
            Self::NotFound => (StatusCode::NOT_FOUND, "not_found", None, Vec::new()),
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                "bad_request",
                Some(message),
                Vec::new(),
            ),
            Self::Invalid(problems) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "invalid", None, problems)
            }
            Self::Conflict(code) => (StatusCode::CONFLICT, code, None, Vec::new()),
            Self::Internal(error) => {
                tracing::error!(error = format!("{error:#}"), "request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    None,
                    Vec::new(),
                )
            }
        };

        let body = ErrorBody {
            error: error.to_owned(),
            message,
            problems,
        };
        (status, Json(body)).into_response()
    }
}
