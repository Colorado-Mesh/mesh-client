use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::stack::config;
use crate::stack::{ImportMode, StackHandle, StackSettings, UpdateInterfacePatch};

#[derive(Debug, Deserialize)]
pub struct ConfigBody {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfigImportBody {
    pub content: String,
    pub mode: String,
}

pub async fn get_config(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match config::read_config(&stack.config_dir) {
        Ok(content) => Json(serde_json::json!({ "content": content })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn put_config(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ConfigBody>,
) -> Json<serde_json::Value> {
    match stack.put_config_content(&body.content).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn export_config(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match config::read_config(&stack.config_dir) {
        Ok(content) => Json(serde_json::json!({ "content": content })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn import_config(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ConfigImportBody>,
) -> Json<serde_json::Value> {
    let Some(mode) = ImportMode::parse(&body.mode) else {
        return Json(serde_json::json!({
            "ok": false,
            "error": "mode must be merge or replace"
        }));
    };
    match stack.import_config(&body.content, mode).await {
        Ok(result) => Json(serde_json::json!({
            "ok": true,
            "warnings": result.warnings
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn get_stack_settings(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match config::get_stack_settings(&stack.config_dir) {
        Ok(settings) => Json(serde_json::to_value(settings).unwrap_or_default()),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn put_stack_settings(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<StackSettings>,
) -> Json<serde_json::Value> {
    match stack.set_stack_settings(&body).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn update_interface(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateInterfacePatch>,
) -> Json<serde_json::Value> {
    match stack.update_interface(&id, body).await {
        Ok(row) => Json(serde_json::json!({ "ok": true, "interface": row })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn delete_interface(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.delete_interface(&id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}
