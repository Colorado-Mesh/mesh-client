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
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
