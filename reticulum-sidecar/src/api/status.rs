use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Serialize;

use crate::stack::StackHandle;

#[derive(Serialize)]
pub struct StatusResponse {
    pub status: &'static str,
    pub version: String,
    pub rns_ready: bool,
    pub lxmf_ready: bool,
}

#[derive(Serialize)]
pub struct AppInfoResponse {
    pub sidecar_version: String,
    pub rns_version: Option<String>,
    pub lxmf_version: Option<String>,
}

pub async fn status(State(stack): State<Arc<StackHandle>>) -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION").to_string(),
        rns_ready: stack.rns_ready().await,
        lxmf_ready: stack.lxmf_ready().await,
    })
}

pub async fn app_info(State(stack): State<Arc<StackHandle>>) -> Json<AppInfoResponse> {
    Json(AppInfoResponse {
        sidecar_version: env!("CARGO_PKG_VERSION").to_string(),
        rns_version: stack.rns_version(),
        lxmf_version: stack.lxmf_version(),
    })
}
