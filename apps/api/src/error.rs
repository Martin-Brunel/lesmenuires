use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Application error mapped to an HTTP response with a JSON body `{ "error": ... }`.
#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    BadRequest(String),
    Unauthorized,
    Internal(String),
    Db(sqlx::Error),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Db(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::NotFound(what) => (
                StatusCode::NOT_FOUND,
                format!("Ressource introuvable : {what}"),
            ),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Non authentifié".to_string()),
            AppError::Internal(detail) => {
                tracing::error!("internal error: {detail}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Erreur interne".to_string(),
                )
            }
            AppError::Db(e) => {
                tracing::error!("database error: {e:?}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Erreur interne".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
