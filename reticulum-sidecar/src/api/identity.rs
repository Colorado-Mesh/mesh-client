use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Deserialize)]
pub struct GenerateBody {
    pub display_name: Option<String>,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Deserialize)]
pub struct ImportBody {
    pub mnemonic: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Deserialize)]
pub struct ExportBody {
    pub passphrase: String,
}

#[derive(Deserialize)]
pub struct ImportBackupBody {
    pub backup: serde_json::Value,
    #[serde(default)]
    pub passphrase: Option<String>,
    pub display_name: Option<String>,
    #[serde(default)]
    pub replace: bool,
}

#[derive(Deserialize)]
pub struct ImportPrivateBody {
    pub private_key: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub replace: bool,
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

/// Generate a new identity. The response includes the mnemonic **once** so the
/// UI can show it for backup; it is not written to disk (`mesh_client_stack.json`
/// strips `mnemonic` on save).
pub async fn identity_generate(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<GenerateBody>,
) -> Json<serde_json::Value> {
    match stack
        .identity_generate(body.display_name, body.replace)
        .await
    {
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
        .identity_import(&body.mnemonic, body.display_name, body.replace)
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

pub async fn identity_import_backup(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ImportBackupBody>,
) -> Json<serde_json::Value> {
    let passphrase = body.passphrase.unwrap_or_default();
    match stack
        .identity_import_backup(body.backup, &passphrase, body.display_name, body.replace)
        .await
    {
        Ok(id) => Json(serde_json::json!({
            "ok": true,
            "identity_hash": id.identity_hash,
            "lxmf_hash": id.lxmf_hash,
            "display_name": id.display_name,
            "metadata_only": true,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn identity_import_private(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ImportPrivateBody>,
) -> Json<serde_json::Value> {
    match stack
        .identity_import_private(&body.private_key, body.display_name, body.replace)
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
