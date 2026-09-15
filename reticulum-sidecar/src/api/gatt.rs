//! HTTP + WS API for app-wide GATT sessions.

use std::sync::Arc;

use axum::Json;
use axum::extract::{
    Path, Query, State,
    ws::{Message, WebSocket, WebSocketUpgrade},
};
use axum::response::IntoResponse;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use futures_util::StreamExt;

use crate::gatt::{GattProfile, GattSessionEvent};
use crate::stack::StackHandle;

#[derive(Debug, serde::Deserialize)]
pub struct GattScanQuery {
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_timeout() -> u64 {
    5
}

fn default_mode() -> String {
    "all".into()
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateSessionBody {
    pub profile: String,
    pub address: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct WriteBody {
    /// Base64-encoded payload.
    pub data_b64: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct ExternalRegisterBody {
    pub profile: String,
    pub address: String,
}

pub async fn gatt_availability(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.gatt().availability().await)
}

pub async fn gatt_scan(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<GattScanQuery>,
) -> Json<serde_json::Value> {
    match stack.gatt().scan(&query.mode, query.timeout_secs).await {
        Ok(devices) => {
            let devices: Vec<serde_json::Value> = devices
                .into_iter()
                .map(|d| {
                    serde_json::json!({
                        "address": d.address,
                        "name": d.name,
                        "rssi": d.rssi,
                        "service_uuids": d.service_uuids,
                    })
                })
                .collect();
            Json(serde_json::json!({ "ok": true, "devices": devices }))
        }
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_create_session(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<CreateSessionBody>,
) -> Json<serde_json::Value> {
    let profile: GattProfile = match body.profile.parse() {
        Ok(p) => p,
        Err(e) => return Json(e.to_json()),
    };
    match stack.gatt().connect(profile, &body.address).await {
        Ok((session_id, mtu)) => Json(serde_json::json!({
            "ok": true,
            "sessionId": session_id,
            "mtu": mtu,
        })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_delete_session(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.gatt().disconnect(&session_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_write(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
    Json(body): Json<WriteBody>,
) -> Json<serde_json::Value> {
    let payload = match B64.decode(body.data_b64.trim()) {
        Ok(p) => p,
        Err(e) => {
            return Json(serde_json::json!({
                "ok": false,
                "code": "invalid_address",
                "error": format!("invalid data_b64: {e}"),
            }));
        }
    };
    match stack.gatt().write(&session_id, &payload).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_rssi(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.gatt().rssi(&session_id).await {
        Ok(rssi) => Json(serde_json::json!({ "ok": true, "rssi": rssi })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_is_connected(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    let connected = stack.gatt().is_connected(&session_id).await;
    Json(serde_json::json!({ "ok": true, "connected": connected }))
}

pub async fn gatt_register_external(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ExternalRegisterBody>,
) -> Json<serde_json::Value> {
    let profile: GattProfile = match body.profile.parse() {
        Ok(p) => p,
        Err(e) => return Json(e.to_json()),
    };
    match stack.gatt().register_external(profile, &body.address).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_unregister_external(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<ExternalRegisterBody>,
) -> Json<serde_json::Value> {
    let profile: GattProfile = match body.profile.parse() {
        Ok(p) => p,
        Err(e) => return Json(e.to_json()),
    };
    match stack
        .gatt()
        .unregister_external(profile, &body.address)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(e.to_json()),
    }
}

pub async fn gatt_session_ws(
    ws: WebSocketUpgrade,
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let rx = stack.gatt().subscribe();
    ws.on_upgrade(move |socket| handle_gatt_ws(socket, rx, session_id))
}

async fn handle_gatt_ws(
    mut socket: WebSocket,
    mut rx: tokio::sync::broadcast::Receiver<GattSessionEvent>,
    session_id: String,
) {
    loop {
        tokio::select! {
            evt = rx.recv() => {
                match evt {
                    Ok(ev) => {
                        let include = match &ev {
                            GattSessionEvent::Bytes { session_id: sid, .. }
                            | GattSessionEvent::Disconnected { session_id: sid, .. }
                            | GattSessionEvent::Mtu { session_id: sid, .. }
                            | GattSessionEvent::Rssi { session_id: sid, .. } => sid == &session_id,
                            GattSessionEvent::Error { session_id: sid, .. } => {
                                sid.as_ref().is_none_or(|s| s == &session_id)
                            }
                        };
                        if !include {
                            continue;
                        }
                        let payload = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".into());
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}
