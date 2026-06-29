use std::sync::Arc;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::state::AppState;

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

pub async fn status(State(state): State<Arc<AppState>>) -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        version: state.version.clone(),
        rns_ready: state.rns_ready(),
        lxmf_ready: state.lxmf_ready(),
    })
}

pub async fn app_info(State(state): State<Arc<AppState>>) -> Json<AppInfoResponse> {
    Json(AppInfoResponse {
        sidecar_version: state.version.clone(),
        rns_version: state.rns_version(),
        lxmf_version: state.lxmf_version(),
    })
}
