use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Deserialize)]
pub struct GenerateBody {
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub mnemonic: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct ExportBody {
    pub passphrase: String,
}

#[derive(Deserialize)]
pub struct DisplayNameBody {
    pub display_name: String,
}

pub async fn identity_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let id = stack.identity_status().await;
    Json(serde_json::json!({
        "configured": id.configured,
        "identity_hash": id.identity_hash,
        "lxmf_hash": id.lxmf_hash,
        "display_name": id.display_name,
    }))
}

pub async fn identity_generate(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<GenerateBody>,
) -> Json<serde_json::Value> {
    match stack.identity_generate(body.display_name).await {
        Ok(id) => Json(serde_json::json!({
            "ok": true,
            "identity_hash": id.identity_hash,
            "lxmf_hash": id.lxmf_hash,
            "display_name": id.display_name,
            "mnemonic": id.mnemonic,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn identity_import(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ImportBody>,
) -> Json<serde_json::Value> {
    match stack
        .identity_import(&body.mnemonic, body.display_name)
        .await
    {
        Ok(id) => Json(serde_json::json!({
            "ok": true,
            "identity_hash": id.identity_hash,
            "lxmf_hash": id.lxmf_hash,
            "display_name": id.display_name,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn identity_export(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ExportBody>,
) -> Json<serde_json::Value> {
    match stack.identity_export_backup(&body.passphrase).await {
        Ok(backup) => Json(serde_json::json!({ "ok": true, "backup": backup })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn identity_set_display_name(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<DisplayNameBody>,
) -> Json<serde_json::Value> {
    match stack.set_display_name(&body.display_name).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}
