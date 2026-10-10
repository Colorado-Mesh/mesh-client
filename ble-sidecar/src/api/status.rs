use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: &'static str,
    pub version: String,
}

pub async fn status() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
