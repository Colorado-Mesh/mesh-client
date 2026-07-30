use std::sync::Arc;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::StreamExt;

use crate::stack::StackHandle;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(stack): State<Arc<StackHandle>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, stack))
}

async fn handle_ws(mut socket: WebSocket, stack: Arc<StackHandle>) {
    let mut rx = stack.subscribe_events();
    loop {
        tokio::select! {
            evt = rx.recv() => {
                match evt {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        // Critical events (lxmf_message) may have been dropped. Notify the
                        // client so it can catch up via GET /api/v1/lxmf/recent.
                        tracing::warn!(
                            skipped,
                            "websocket event subscriber lagged; some events dropped"
                        );
                        let notice = serde_json::json!({
                            "type": "events_lagged",
                            "payload": { "skipped": skipped }
                        })
                        .to_string();
                        if socket.send(Message::Text(notice.into())).await.is_err() {
                            break;
                        }
                    }
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
