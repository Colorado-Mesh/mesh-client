//! High-level RRC session (HELLO → WELCOME → rooms) over a persistent Link.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use serde_json::json;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};
use tracing::{debug, warn};

use super::rrc_codec::{
    body_as_text, decode_envelope, encode_envelope, hello_body, msg_type, parse_joined_members,
    parse_welcome_capabilities, parse_welcome_hub_name, text_body, RrcEnvelope,
    RrcWelcomeCapabilities, RRC_IDENTITY_HASH_LEN,
};
use super::rrc_link::{open_rrc_link, RrcLinkError, RrcLinkEvent, RrcLinkHandle};

const CLIENT_NAME: &str = "mesh-client";
const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const WELCOME_TIMEOUT: Duration = Duration::from_secs(20);
const RECONNECT_BASE_MS: u64 = 2_000;
const RECONNECT_MAX_MS: u64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RrcSessionStatus {
    Disconnected,
    Connecting,
    AwaitingWelcome,
    Active,
    Reconnecting,
}

impl RrcSessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::Connecting => "connecting",
            Self::AwaitingWelcome => "awaiting_welcome",
            Self::Active => "active",
            Self::Reconnecting => "reconnecting",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RrcRoomState {
    pub name: String,
    pub members: Vec<(String, Option<String>)>,
}

pub struct RrcSessionManager {
    inner: Arc<Mutex<RrcSessionInner>>,
    cmd_tx: mpsc::Sender<SessionCommand>,
}

struct RrcSessionInner {
    status: RrcSessionStatus,
    hub_dest_hash: Option<String>,
    hub_name: Option<String>,
    nickname: Option<String>,
    rooms: HashMap<String, RrcRoomState>,
    desired_rooms: HashSet<String>,
    last_error: Option<String>,
    identity_hash: [u8; 16],
    capabilities: RrcWelcomeCapabilities,
}

enum SessionCommand {
    Connect {
        dest_hash: [u8; 16],
        dest_hash_hex: String,
        hops: u8,
        nickname: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Disconnect {
        reply: oneshot::Sender<()>,
    },
    Join {
        room: String,
        key: Option<String>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Part {
        room: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Send {
        /// Empty / None omits K_ROOM (hub-global slash commands).
        room: Option<String>,
        body: String,
        msg_type: u8,
        /// When set, send NOTICE with K_DST and omit K_ROOM (rrcd direct NOTICE).
        dst_identity: Option<[u8; RRC_IDENTITY_HASH_LEN]>,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

impl RrcSessionManager {
    pub fn spawn(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: Identity,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        let identity_hash = identity.hash;
        let inner = Arc::new(Mutex::new(RrcSessionInner {
            status: RrcSessionStatus::Disconnected,
            hub_dest_hash: None,
            hub_name: None,
            nickname: None,
            rooms: HashMap::new(),
            desired_rooms: HashSet::new(),
            last_error: None,
            identity_hash,
            capabilities: RrcWelcomeCapabilities::default(),
        }));
        let (cmd_tx, cmd_rx) = mpsc::channel(32);
        let manager_inner = inner.clone();
        tokio::spawn(async move {
            session_loop(transport_tx, identity, event_tx, manager_inner, cmd_rx).await;
        });
        Self { inner, cmd_tx }
    }

    pub async fn status_snapshot(&self) -> serde_json::Value {
        let g = self.inner.lock().await;
        let rooms: Vec<serde_json::Value> = g
            .rooms
            .values()
            .map(|r| {
                json!({
                    "name": r.name,
                    "member_count": r.members.len(),
                    "members": r.members.iter().map(|(h, n)| json!({
                        "identity_hash": h,
                        "nickname": n,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({
            "status": g.status.as_str(),
            "hub_dest_hash": g.hub_dest_hash,
            "hub_name": g.hub_name,
            "identity_hash": hex::encode(g.identity_hash),
            "nickname": g.nickname,
            "rooms": rooms,
            "error": g.last_error,
            "capabilities": {
                "direct_notice": g.capabilities.direct_notice,
                "action": g.capabilities.action,
                "resource_envelope": g.capabilities.resource_envelope,
            },
        })
    }

    pub async fn rooms_snapshot(&self) -> serde_json::Value {
        let g = self.inner.lock().await;
        let rooms: Vec<serde_json::Value> = g
            .rooms
            .values()
            .map(|r| {
                json!({
                    "name": r.name,
                    "member_count": r.members.len(),
                    "members": r.members.iter().map(|(h, n)| json!({
                        "identity_hash": h,
                        "nickname": n,
                    })).collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({ "rooms": rooms })
    }

    pub async fn connect(
        &self,
        dest_hash: [u8; 16],
        dest_hash_hex: String,
        hops: u8,
        nickname: String,
    ) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Connect {
                dest_hash,
                dest_hash_hex,
                hops,
                nickname,
                reply,
            })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    pub async fn disconnect(&self) {
        let (reply, rx) = oneshot::channel();
        if self
            .cmd_tx
            .send(SessionCommand::Disconnect { reply })
            .await
            .is_ok()
        {
            let _ = rx.await;
        }
    }

    pub async fn join(&self, room: String, key: Option<String>) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Join { room, key, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    pub async fn part(&self, room: String) -> Result<(), String> {
        let (reply, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Part { room, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    pub async fn send_chat(
        &self,
        room: Option<String>,
        body: String,
        kind: &str,
        dst_hash_hex: Option<&str>,
    ) -> Result<(), String> {
        let dst_identity = if let Some(hex_str) = dst_hash_hex {
            let clean = hex_str.trim().to_lowercase();
            if clean.len() != 32 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("dst_hash must be 32 hex characters".into());
            }
            let bytes = hex::decode(&clean).map_err(|e| e.to_string())?;
            let mut arr = [0u8; RRC_IDENTITY_HASH_LEN];
            arr.copy_from_slice(&bytes);
            Some(arr)
        } else {
            None
        };
        let msg_type = if dst_identity.is_some() {
            msg_type::NOTICE
        } else {
            match kind {
                "notice" => msg_type::NOTICE,
                "action" => msg_type::ACTION,
                _ => msg_type::MSG,
            }
        };
        let (reply, rx) = oneshot::channel();
        self.cmd_tx
            .send(SessionCommand::Send {
                room: if dst_identity.is_some() { None } else { room },
                body,
                msg_type,
                dst_identity,
                reply,
            })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }
}

async fn session_loop(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    inner: Arc<Mutex<RrcSessionInner>>,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
) {
    let mut link: Option<RrcLinkHandle> = None;
    let mut reconnect_intent: Option<( [u8; 16], String, u8, String )> = None;
    let mut backoff_ms = RECONNECT_BASE_MS;

    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else { break };
                match cmd {
                    SessionCommand::Connect {
                        dest_hash,
                        dest_hash_hex,
                        hops,
                        nickname,
                        reply,
                    } => {
                        if let Some(existing) = link.take() {
                            existing.close().await;
                        }
                        {
                            let mut g = inner.lock().await;
                            g.status = RrcSessionStatus::Connecting;
                            g.hub_dest_hash = Some(dest_hash_hex.clone());
                            g.nickname = Some(nickname.clone());
                            g.hub_name = None;
                            g.rooms.clear();
                            g.desired_rooms.clear();
                            g.last_error = None;
                            g.capabilities = RrcWelcomeCapabilities::default();
                        }
                        emit(
                            &event_tx,
                            "rrc.connected",
                            json!({
                                "hub_dest_hash": dest_hash_hex,
                                "status": "connecting",
                            }),
                        );
                        match establish_session(
                            &transport_tx,
                            identity.clone(),
                            &inner,
                            &event_tx,
                            dest_hash,
                            &dest_hash_hex,
                            hops,
                            &nickname,
                        )
                        .await
                        {
                            Ok(handle) => {
                                link = Some(handle);
                                reconnect_intent =
                                    Some((dest_hash, dest_hash_hex, hops, nickname));
                                backoff_ms = RECONNECT_BASE_MS;
                                let _ = reply.send(Ok(()));
                            }
                            Err(e) => {
                                {
                                    let mut g = inner.lock().await;
                                    g.status = RrcSessionStatus::Disconnected;
                                    g.last_error = Some(e.clone());
                                }
                                emit(
                                    &event_tx,
                                    "rrc.error",
                                    json!({ "message": e }),
                                );
                                emit(
                                    &event_tx,
                                    "rrc.disconnected",
                                    json!({
                                        "hub_dest_hash": dest_hash_hex,
                                        "reason": e,
                                    }),
                                );
                                let _ = reply.send(Err(e));
                            }
                        }
                    }
                    SessionCommand::Disconnect { reply } => {
                        reconnect_intent = None;
                        if let Some(existing) = link.take() {
                            existing.close().await;
                        }
                        let hub = {
                            let mut g = inner.lock().await;
                            let hub = g.hub_dest_hash.clone();
                            g.status = RrcSessionStatus::Disconnected;
                            g.rooms.clear();
                            g.desired_rooms.clear();
                            g.hub_name = None;
                            hub
                        };
                        emit(
                            &event_tx,
                            "rrc.disconnected",
                            json!({
                                "hub_dest_hash": hub,
                                "reason": "local_disconnect",
                            }),
                        );
                        let _ = reply.send(());
                    }
                    SessionCommand::Join { room, key, reply } => {
                        let result = send_room_control(
                            &mut link,
                            &inner,
                            Some(room.clone()),
                            msg_type::JOIN,
                            key,
                        )
                        .await;
                        if result.is_ok() {
                            inner.lock().await.desired_rooms.insert(normalize_room(&room));
                        }
                        let _ = reply.send(result);
                    }
                    SessionCommand::Part { room, reply } => {
                        let result = send_room_control(
                            &mut link,
                            &inner,
                            Some(room.clone()),
                            msg_type::PART,
                            None,
                        )
                        .await;
                        if result.is_ok() {
                            let key = normalize_room(&room);
                            let mut g = inner.lock().await;
                            g.desired_rooms.remove(&key);
                            g.rooms.remove(&key);
                        }
                        let _ = reply.send(result);
                    }
                    SessionCommand::Send {
                        room,
                        body,
                        msg_type,
                        dst_identity,
                        reply,
                    } => {
                        let result = send_envelope(
                            &mut link,
                            &inner,
                            room,
                            msg_type,
                            Some(body),
                            dst_identity,
                        )
                        .await;
                        let _ = reply.send(result);
                    }
                }
            }
            ev = async {
                match link.as_mut() {
                    Some(l) => l.event_rx.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                match ev {
                    Some(RrcLinkEvent::Data(bytes)) => {
                        handle_inbound(&inner, &event_tx, &bytes).await;
                    }
                    Some(RrcLinkEvent::Closed { reason }) => {
                        link = None;
                        let should_reconnect = reconnect_intent.is_some();
                        let hub = {
                            let mut g = inner.lock().await;
                            let hub = g.hub_dest_hash.clone();
                            if should_reconnect {
                                g.status = RrcSessionStatus::Reconnecting;
                            } else {
                                g.status = RrcSessionStatus::Disconnected;
                                g.rooms.clear();
                            }
                            g.last_error = Some(reason.clone());
                            hub
                        };
                        emit(
                            &event_tx,
                            "rrc.disconnected",
                            json!({
                                "hub_dest_hash": hub,
                                "reason": reason,
                            }),
                        );
                        if let Some((dest_hash, dest_hash_hex, hops, nickname)) =
                            reconnect_intent.clone()
                        {
                            debug!(
                                "rrc reconnecting to {dest_hash_hex} in {backoff_ms}ms"
                            );
                            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                            backoff_ms = (backoff_ms.saturating_mul(2)).min(RECONNECT_MAX_MS);
                            {
                                let mut g = inner.lock().await;
                                g.status = RrcSessionStatus::Connecting;
                            }
                            match establish_session(
                                &transport_tx,
                                identity.clone(),
                                &inner,
                                &event_tx,
                                dest_hash,
                                &dest_hash_hex,
                                hops,
                                &nickname,
                            )
                            .await
                            {
                                Ok(handle) => {
                                    // Re-join desired rooms after welcome.
                                    let rooms: Vec<String> = {
                                        let g = inner.lock().await;
                                        g.desired_rooms.iter().cloned().collect()
                                    };
                                    link = Some(handle);
                                    for room in rooms {
                                        let _ = send_room_control(
                                            &mut link,
                                            &inner,
                                            Some(room),
                                            msg_type::JOIN,
                                            None,
                                        )
                                        .await;
                                    }
                                    backoff_ms = RECONNECT_BASE_MS;
                                }
                                Err(e) => {
                                    warn!("rrc reconnect failed: {e}");
                                    let mut g = inner.lock().await;
                                    g.status = RrcSessionStatus::Reconnecting;
                                    g.last_error = Some(e.clone());
                                    emit(
                                        &event_tx,
                                        "rrc.error",
                                        json!({ "message": e }),
                                    );
                                }
                            }
                        }
                    }
                    None => {
                        link = None;
                    }
                }
            }
        }
    }
}

async fn establish_session(
    transport_tx: &mpsc::Sender<TransportMessage>,
    identity: Identity,
    inner: &Arc<Mutex<RrcSessionInner>>,
    event_tx: &broadcast::Sender<String>,
    dest_hash: [u8; 16],
    dest_hash_hex: &str,
    hops: u8,
    nickname: &str,
) -> Result<RrcLinkHandle, String> {
    let mut handle = open_rrc_link(transport_tx.clone(), identity, dest_hash, hops)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut g = inner.lock().await;
        g.status = RrcSessionStatus::AwaitingWelcome;
    }

    let hello = {
        let g = inner.lock().await;
        RrcEnvelope::new(
            msg_type::HELLO,
            g.identity_hash,
            None,
            Some(hello_body(CLIENT_NAME, CLIENT_VERSION)),
            Some(nickname.to_string()),
        )
    };
    let hello_bytes = encode_envelope(&hello).map_err(|e| e.to_string())?;
    handle
        .send(hello_bytes)
        .await
        .map_err(|e: RrcLinkError| e.to_string())?;

    let deadline = tokio::time::Instant::now() + WELCOME_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            handle.close().await;
            return Err("timed out waiting for WELCOME".into());
        }
        match tokio::time::timeout(remaining, handle.event_rx.recv()).await {
            Ok(Some(RrcLinkEvent::Data(bytes))) => {
                let Ok(env) = decode_envelope(&bytes) else {
                    continue;
                };
                if env.msg_type == msg_type::WELCOME {
                    let hub_name = parse_welcome_hub_name(&env.body);
                    let capabilities = parse_welcome_capabilities(&env.body);
                    {
                        let mut g = inner.lock().await;
                        g.status = RrcSessionStatus::Active;
                        g.hub_name = hub_name.clone();
                        g.capabilities = capabilities.clone();
                        g.last_error = None;
                    }
                    emit(
                        event_tx,
                        "rrc.connected",
                        json!({
                            "hub_dest_hash": dest_hash_hex,
                            "hub_name": hub_name,
                            "status": "active",
                            "capabilities": {
                                "direct_notice": capabilities.direct_notice,
                                "action": capabilities.action,
                                "resource_envelope": capabilities.resource_envelope,
                            },
                        }),
                    );
                    return Ok(handle);
                }
                if env.msg_type == msg_type::ERROR {
                    let msg = body_as_text(&env.body).unwrap_or_else(|| "hub ERROR".into());
                    handle.close().await;
                    return Err(msg);
                }
                // Ignore other frames until WELCOME.
            }
            Ok(Some(RrcLinkEvent::Closed { reason })) => {
                return Err(format!("link closed before WELCOME: {reason}"));
            }
            Ok(None) => return Err("link event channel closed".into()),
            Err(_) => {
                handle.close().await;
                return Err("timed out waiting for WELCOME".into());
            }
        }
    }
}

async fn send_room_control(
    link: &mut Option<RrcLinkHandle>,
    inner: &Arc<Mutex<RrcSessionInner>>,
    room: Option<String>,
    msg_type_val: u8,
    body: Option<String>,
) -> Result<(), String> {
    send_envelope(link, inner, room, msg_type_val, body, None).await
}

async fn send_envelope(
    link: &mut Option<RrcLinkHandle>,
    inner: &Arc<Mutex<RrcSessionInner>>,
    room: Option<String>,
    msg_type_val: u8,
    body: Option<String>,
    dst_identity: Option<[u8; RRC_IDENTITY_HASH_LEN]>,
) -> Result<(), String> {
    let Some(handle) = link.as_ref() else {
        return Err("not connected to an RRC hub".into());
    };
    let status = inner.lock().await.status;
    if status != RrcSessionStatus::Active && status != RrcSessionStatus::AwaitingWelcome {
        return Err(format!("rrc session not active ({})", status.as_str()));
    }
    if dst_identity.is_some() {
        if msg_type_val != msg_type::NOTICE {
            return Err("direct destination requires NOTICE type".into());
        }
        if !inner.lock().await.capabilities.direct_notice {
            return Err("hub does not advertise CAP_DIRECT_NOTICE".into());
        }
        if room
            .as_ref()
            .map(|r| !r.trim().is_empty())
            .unwrap_or(false)
        {
            return Err("direct NOTICE must omit K_ROOM".into());
        }
    }
    let room_name = if dst_identity.is_some() {
        None
    } else {
        room.map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
    };
    let env = {
        let g = inner.lock().await;
        let mut envelope = RrcEnvelope::new(
            msg_type_val,
            g.identity_hash,
            room_name,
            body.map(|b| text_body(&b)),
            g.nickname.clone(),
        );
        if let Some(dst) = dst_identity {
            envelope = envelope.with_dst(dst);
        }
        envelope
    };
    let bytes = encode_envelope(&env).map_err(|e| e.to_string())?;
    handle.send(bytes).await.map_err(|e| e.to_string())
}

async fn handle_inbound(
    inner: &Arc<Mutex<RrcSessionInner>>,
    event_tx: &broadcast::Sender<String>,
    bytes: &[u8],
) {
    let Ok(env) = decode_envelope(bytes) else {
        return;
    };
    match env.msg_type {
        msg_type::JOINED => {
            let room = env.room_name.clone().unwrap_or_default();
            let key = normalize_room(&room);
            let members = parse_joined_members(&env.body);
            {
                let mut g = inner.lock().await;
                g.rooms.insert(
                    key.clone(),
                    RrcRoomState {
                        name: room.clone(),
                        members: members.clone(),
                    },
                );
                g.desired_rooms.insert(key);
            }
            emit(
                event_tx,
                "rrc.room.joined",
                json!({
                    "room": room,
                    "members": members.iter().map(|(h, n)| json!({
                        "identity_hash": h,
                        "nickname": n,
                    })).collect::<Vec<_>>(),
                }),
            );
        }
        msg_type::PARTED => {
            let room = env.room_name.clone().unwrap_or_default();
            let key = normalize_room(&room);
            {
                let mut g = inner.lock().await;
                g.rooms.remove(&key);
            }
            emit(event_tx, "rrc.room.parted", json!({ "room": room }));
        }
        msg_type::MSG | msg_type::NOTICE | msg_type::ACTION => {
            let kind = match env.msg_type {
                msg_type::NOTICE => "notice",
                msg_type::ACTION => "action",
                _ => "msg",
            };
            let room = env.room_name.clone().unwrap_or_default();
            let body = body_as_text(&env.body).unwrap_or_default();
            let dst_hash = env.dst_identity.map(hex::encode);
            let hub_dest_hash = {
                let g = inner.lock().await;
                g.hub_dest_hash.clone()
            };
            emit(
                event_tx,
                "rrc.message",
                json!({
                    "id": hex::encode(env.msg_id),
                    "room": room,
                    "kind": kind,
                    "body": body,
                    "sender_hash": hex::encode(env.sender_identity),
                    "nickname": env.nickname,
                    "timestamp": env.timestamp,
                    "hub_dest_hash": hub_dest_hash,
                    "dst_hash": dst_hash,
                }),
            );
        }
        msg_type::PING => {
            // Respond with PONG echoing body.
            // Outbound PONG is best-effort from session_loop via a fire-and-forget;
            // hubs tolerate missed PONGs.
            let _ = env;
        }
        msg_type::ERROR => {
            let message = body_as_text(&env.body).unwrap_or_else(|| "hub error".into());
            {
                let mut g = inner.lock().await;
                g.last_error = Some(message.clone());
            }
            emit(event_tx, "rrc.error", json!({ "message": message }));
        }
        msg_type::WELCOME => {
            let hub_name = parse_welcome_hub_name(&env.body);
            let capabilities = parse_welcome_capabilities(&env.body);
            let mut g = inner.lock().await;
            if let Some(name) = hub_name {
                g.hub_name = Some(name);
            }
            g.capabilities = capabilities;
            g.status = RrcSessionStatus::Active;
        }
        _ => {}
    }
}

fn normalize_room(room: &str) -> String {
    room.trim().to_lowercase()
}

fn emit(event_tx: &broadcast::Sender<String>, event_type: &str, payload: serde_json::Value) {
    let frame = json!({ "type": event_type, "payload": payload });
    let _ = event_tx.send(frame.to_string());
}
