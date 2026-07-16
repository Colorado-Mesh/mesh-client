//! High-level RRC session (HELLO → WELCOME → rooms) over a persistent Link.
//!
//! Multi-hub: each connected hub gets its own spawned task (own Link, own
//! connect job, own reconnect loop) so a Connect to hub B never touches hub
//! A's link. `RrcSessionManager` is a thin router keyed by lowercase
//! `hub_dest_hash` hex; per-hub state lives in that hub's task via
//! `RrcSessionInner` (read directly for snapshots — no round trip through the
//! command channel is needed for status/rooms reads).

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
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
/// Soft cap on simultaneous hub sessions. Reconnecting an already-tracked hub
/// never counts as a new session, so it is exempt from this cap.
const MAX_HUB_SESSIONS: usize = 8;

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

/// Per-hub session state, mutated by that hub's task and read directly by the
/// manager for snapshots (`Arc<Mutex<_>>` shared between the two).
struct RrcSessionInner {
    status: RrcSessionStatus,
    hub_name: Option<String>,
    nickname: Option<String>,
    rooms: HashMap<String, RrcRoomState>,
    desired_rooms: HashSet<String>,
    last_error: Option<String>,
    identity_hash: [u8; 16],
    capabilities: RrcWelcomeCapabilities,
}

impl RrcSessionInner {
    fn new(identity_hash: [u8; 16]) -> Self {
        Self {
            status: RrcSessionStatus::Disconnected,
            hub_name: None,
            nickname: None,
            rooms: HashMap::new(),
            desired_rooms: HashSet::new(),
            last_error: None,
            identity_hash,
            capabilities: RrcWelcomeCapabilities::default(),
        }
    }
}

/// Handle to one hub's session task: a command channel for actions that must
/// run on that hub's Link, plus direct shared-state access for cheap reads.
#[derive(Clone)]
struct HubHandle {
    cmd_tx: mpsc::Sender<SessionCommand>,
    inner: Arc<Mutex<RrcSessionInner>>,
}

struct ManagerShared {
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    identity_hash: [u8; 16],
    hubs: Mutex<HashMap<String, HubHandle>>,
}

pub struct RrcSessionManager {
    shared: Arc<ManagerShared>,
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
    SetNickname {
        nickname: String,
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
        let shared = Arc::new(ManagerShared {
            transport_tx,
            identity,
            event_tx,
            identity_hash,
            hubs: Mutex::new(HashMap::new()),
        });
        Self { shared }
    }

    /// `{ "sessions": [ {status, hub_dest_hash, hub_name, identity_hash,
    /// nickname, rooms, error, capabilities}, ... ], "identity_hash": "..." }`
    pub async fn status_snapshot(&self) -> serde_json::Value {
        let hubs = self.shared.hubs.lock().await;
        let mut sessions = Vec::with_capacity(hubs.len());
        for (hex, handle) in hubs.iter() {
            let g = handle.inner.lock().await;
            sessions.push(session_json(hex, &g));
        }
        json!({
            "sessions": sessions,
            "identity_hash": hex::encode(self.shared.identity_hash),
        })
    }

    /// `hub_dest_hash = None` aggregates every hub's rooms with a `"hub"`
    /// field; `Some(hex)` returns that hub's rooms alone (unchanged shape).
    pub async fn rooms_snapshot(&self, hub_dest_hash: Option<&str>) -> serde_json::Value {
        match normalize_hex(hub_dest_hash) {
            Some(hex) => {
                let Some(handle) = self.get_handle(&hex).await else {
                    return json!({ "rooms": [] });
                };
                let g = handle.inner.lock().await;
                json!({ "rooms": rooms_json(&g.rooms) })
            }
            None => {
                let hubs = self.shared.hubs.lock().await;
                let mut rooms = Vec::new();
                for (hex, handle) in hubs.iter() {
                    let g = handle.inner.lock().await;
                    for r in g.rooms.values() {
                        rooms.push(json!({
                            "hub": hex,
                            "name": r.name,
                            "member_count": r.members.len(),
                            "members": members_json(&r.members),
                        }));
                    }
                }
                json!({ "rooms": rooms })
            }
        }
    }

    /// Connects to a hub. Reconnecting an already-tracked hub (connecting,
    /// active, or reconnecting) routes to that hub's existing task and never
    /// consumes a new slot; a brand-new hub is rejected once
    /// `MAX_HUB_SESSIONS` are tracked.
    pub async fn connect(
        &self,
        dest_hash: [u8; 16],
        dest_hash_hex: String,
        hops: u8,
        nickname: String,
    ) -> Result<(), String> {
        let hex_key = dest_hash_hex.trim().to_lowercase();
        let handle = {
            let mut hubs = self.shared.hubs.lock().await;
            if let Some(existing) = hubs.get(&hex_key) {
                existing.clone()
            } else {
                if hubs.len() >= MAX_HUB_SESSIONS {
                    return Err(format!(
                        "max_hubs: maximum of {MAX_HUB_SESSIONS} RRC hubs connected"
                    ));
                }
                let inner = Arc::new(Mutex::new(RrcSessionInner::new(self.shared.identity_hash)));
                let (cmd_tx, cmd_rx) = mpsc::channel(32);
                let handle = HubHandle {
                    cmd_tx,
                    inner: inner.clone(),
                };
                hubs.insert(hex_key.clone(), handle.clone());
                let shared = Arc::clone(&self.shared);
                let hex_for_task = hex_key.clone();
                tokio::spawn(async move {
                    session_loop(shared, hex_for_task, inner, cmd_rx).await;
                });
                handle
            }
        };
        let (reply, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(SessionCommand::Connect {
                dest_hash,
                dest_hash_hex: hex_key,
                hops,
                nickname,
                reply,
            })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    /// `None` (or empty) tears down every tracked hub session; `Some(hex)`
    /// tears down only that hub. Either way the hub's task frees its slot.
    pub async fn disconnect(&self, dest_hash_hex: Option<&str>) {
        let targets: Vec<HubHandle> = match normalize_hex(dest_hash_hex) {
            Some(hex) => {
                let hubs = self.shared.hubs.lock().await;
                hubs.get(&hex).cloned().into_iter().collect()
            }
            None => {
                let hubs = self.shared.hubs.lock().await;
                hubs.values().cloned().collect()
            }
        };
        for handle in targets {
            let (reply, rx) = oneshot::channel();
            if handle
                .cmd_tx
                .send(SessionCommand::Disconnect { reply })
                .await
                .is_ok()
            {
                let _ = rx.await;
            }
        }
    }

    pub async fn join(&self, hub_dest_hash: &str, room: String, key: Option<String>) -> Result<(), String> {
        let handle = self.require_handle(hub_dest_hash).await?;
        let (reply, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(SessionCommand::Join { room, key, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    pub async fn part(&self, hub_dest_hash: &str, room: String) -> Result<(), String> {
        let handle = self.require_handle(hub_dest_hash).await?;
        let (reply, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(SessionCommand::Part { room, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await.map_err(|_| "rrc session task stopped".to_string())?
    }

    /// `hub_dest_hash = None` sets the nickname on every tracked hub (used
    /// for the next HELLO / reconnect on each); `Some(hex)` targets one hub.
    pub async fn set_nickname(
        &self,
        hub_dest_hash: Option<&str>,
        nickname: String,
    ) -> Result<(), String> {
        let nick = nickname.trim().to_string();
        if nick.is_empty() {
            return Err("nickname must not be empty".into());
        }
        let targets: Vec<HubHandle> = match normalize_hex(hub_dest_hash) {
            Some(hex) => vec![self.require_handle(&hex).await?],
            None => self.shared.hubs.lock().await.values().cloned().collect(),
        };
        let mut last_err: Option<String> = None;
        for handle in targets {
            let (reply, rx) = oneshot::channel();
            if handle
                .cmd_tx
                .send(SessionCommand::SetNickname {
                    nickname: nick.clone(),
                    reply,
                })
                .await
                .is_err()
            {
                last_err = Some("rrc session task stopped".into());
                continue;
            }
            match rx.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => last_err = Some(e),
                Err(_) => last_err = Some("rrc session task stopped".into()),
            }
        }
        match last_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    pub async fn send_chat(
        &self,
        hub_dest_hash: &str,
        room: Option<String>,
        body: String,
        kind: &str,
        dst_hash_hex: Option<&str>,
    ) -> Result<(), String> {
        let handle = self.require_handle(hub_dest_hash).await?;
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
        handle
            .cmd_tx
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

    async fn get_handle(&self, hub_dest_hash: &str) -> Option<HubHandle> {
        let hex = hub_dest_hash.trim().to_lowercase();
        self.shared.hubs.lock().await.get(&hex).cloned()
    }

    async fn require_handle(&self, hub_dest_hash: &str) -> Result<HubHandle, String> {
        self.get_handle(hub_dest_hash)
            .await
            .ok_or_else(|| format!("no active rrc session for hub {}", hub_dest_hash.trim().to_lowercase()))
    }
}

fn normalize_hex(hub_dest_hash: Option<&str>) -> Option<String> {
    hub_dest_hash
        .map(|h| h.trim().to_lowercase())
        .filter(|h| !h.is_empty())
}

fn members_json(members: &[(String, Option<String>)]) -> Vec<serde_json::Value> {
    members
        .iter()
        .map(|(h, n)| {
            json!({
                "identity_hash": h,
                "nickname": n,
            })
        })
        .collect()
}

fn rooms_json(rooms: &HashMap<String, RrcRoomState>) -> Vec<serde_json::Value> {
    rooms
        .values()
        .map(|r| {
            json!({
                "name": r.name,
                "member_count": r.members.len(),
                "members": members_json(&r.members),
            })
        })
        .collect()
}

fn session_json(hex: &str, g: &RrcSessionInner) -> serde_json::Value {
    json!({
        "status": g.status.as_str(),
        "hub_dest_hash": hex,
        "hub_name": g.hub_name,
        "identity_hash": hex::encode(g.identity_hash),
        "nickname": g.nickname,
        "rooms": rooms_json(&g.rooms),
        "error": g.last_error,
        "capabilities": {
            "direct_notice": g.capabilities.direct_notice,
            "action": g.capabilities.action,
            "resource_envelope": g.capabilities.resource_envelope,
        },
    })
}

/// In-flight establish (user connect or auto-reconnect). Dropping cancels the
/// future so Disconnect / a new Connect can run without waiting for WELCOME.
struct ConnectJob {
    fut: Pin<Box<dyn Future<Output = Result<RrcLinkHandle, String>> + Send>>,
    reply: Option<oneshot::Sender<Result<(), String>>>,
    dest_hash: [u8; 16],
    dest_hash_hex: String,
    hops: u8,
    nickname: String,
}

fn cancel_connect_job(job: &mut Option<ConnectJob>) {
    if let Some(prev) = job.take() {
        if let Some(reply) = prev.reply {
            let _ = reply.send(Err("cancelled".into()));
        }
        // Dropping `fut` aborts establish_session; RrcLinkHandle Drop closes the link task.
    }
}

fn spawn_connect_job(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    inner: Arc<Mutex<RrcSessionInner>>,
    event_tx: broadcast::Sender<String>,
    dest_hash: [u8; 16],
    dest_hash_hex: String,
    hops: u8,
    nickname: String,
    delay_ms: u64,
    reply: Option<oneshot::Sender<Result<(), String>>>,
) -> ConnectJob {
    let hex_for_fut = dest_hash_hex.clone();
    let nick_for_fut = nickname.clone();
    ConnectJob {
        fut: Box::pin(async move {
            if delay_ms > 0 {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
            {
                let mut g = inner.lock().await;
                g.status = RrcSessionStatus::Connecting;
            }
            establish_session(
                &transport_tx,
                identity,
                &inner,
                &event_tx,
                dest_hash,
                &hex_for_fut,
                hops,
                &nick_for_fut,
            )
            .await
        }),
        reply,
        dest_hash,
        dest_hash_hex,
        hops,
        nickname,
    }
}

/// Owns one hub's Link lifecycle end to end: connect, HELLO/WELCOME,
/// room (re)join, auto-reconnect with backoff, and teardown. Runs until this
/// hub receives an explicit Disconnect, at which point it removes itself
/// from `shared.hubs` (freeing its `MAX_HUB_SESSIONS` slot) and returns.
async fn session_loop(
    shared: Arc<ManagerShared>,
    hex: String,
    inner: Arc<Mutex<RrcSessionInner>>,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
) {
    let transport_tx = shared.transport_tx.clone();
    let identity = shared.identity.clone();
    let event_tx = shared.event_tx.clone();

    let mut link: Option<RrcLinkHandle> = None;
    let mut reconnect_intent: Option<([u8; 16], String, u8, String)> = None;
    let mut backoff_ms = RECONNECT_BASE_MS;
    let mut connect_job: Option<ConnectJob> = None;
    let mut terminate = false;

    loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                let Some(cmd) = cmd else {
                    // Sender side (HubHandle) dropped without an explicit
                    // Disconnect — should not happen while tracked, but clean
                    // up defensively so the slot isn't leaked.
                    shared.hubs.lock().await.remove(&hex);
                    break;
                };
                match cmd {
                    SessionCommand::Connect {
                        dest_hash,
                        dest_hash_hex,
                        hops,
                        nickname,
                        reply,
                    } => {
                        cancel_connect_job(&mut connect_job);
                        if let Some(existing) = link.take() {
                            existing.close().await;
                        }
                        reconnect_intent = None;
                        backoff_ms = RECONNECT_BASE_MS;
                        {
                            let mut g = inner.lock().await;
                            g.status = RrcSessionStatus::Connecting;
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
                        connect_job = Some(spawn_connect_job(
                            transport_tx.clone(),
                            identity.clone(),
                            Arc::clone(&inner),
                            event_tx.clone(),
                            dest_hash,
                            dest_hash_hex,
                            hops,
                            nickname,
                            0,
                            Some(reply),
                        ));
                    }
                    SessionCommand::Disconnect { reply } => {
                        cancel_connect_job(&mut connect_job);
                        reconnect_intent = None;
                        backoff_ms = RECONNECT_BASE_MS;
                        if let Some(existing) = link.take() {
                            existing.close().await;
                        }
                        {
                            let mut g = inner.lock().await;
                            g.status = RrcSessionStatus::Disconnected;
                            g.rooms.clear();
                            g.desired_rooms.clear();
                            g.hub_name = None;
                        }
                        emit(
                            &event_tx,
                            "rrc.disconnected",
                            json!({
                                "hub_dest_hash": hex,
                                "reason": "local_disconnect",
                            }),
                        );
                        let _ = reply.send(());
                        terminate = true;
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
                    SessionCommand::SetNickname { nickname, reply } => {
                        {
                            let mut g = inner.lock().await;
                            g.nickname = Some(nickname.clone());
                        }
                        // Keep reconnect HELLO in sync with the live nickname.
                        if let Some((_, _, _, nick)) = reconnect_intent.as_mut() {
                            *nick = nickname;
                        }
                        let _ = reply.send(Ok(()));
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
            result = async {
                match connect_job.as_mut() {
                    Some(job) => job.fut.as_mut().await,
                    None => std::future::pending().await,
                }
            } => {
                let Some(job) = connect_job.take() else { continue };
                let ConnectJob {
                    reply,
                    dest_hash,
                    dest_hash_hex,
                    hops,
                    nickname,
                    ..
                } = job;
                match result {
                    Ok(handle) => {
                        link = Some(handle);
                        reconnect_intent =
                            Some((dest_hash, dest_hash_hex, hops, nickname.clone()));
                        backoff_ms = RECONNECT_BASE_MS;
                        // Re-join desired rooms after welcome (reconnect path).
                        let rooms: Vec<String> = {
                            let g = inner.lock().await;
                            g.desired_rooms.iter().cloned().collect()
                        };
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
                        if let Some(reply) = reply {
                            let _ = reply.send(Ok(()));
                        }
                    }
                    Err(e) => {
                        {
                            let mut g = inner.lock().await;
                            // Keep reconnecting only when auto-reconnect still intended.
                            if reconnect_intent.is_some() && reply.is_none() {
                                g.status = RrcSessionStatus::Reconnecting;
                            } else {
                                g.status = RrcSessionStatus::Disconnected;
                            }
                            g.last_error = Some(e.clone());
                        }
                        if reply.is_some() {
                            emit(
                                &event_tx,
                                "rrc.error",
                                json!({ "message": e, "hub_dest_hash": dest_hash_hex }),
                            );
                            emit(
                                &event_tx,
                                "rrc.disconnected",
                                json!({
                                    "hub_dest_hash": dest_hash_hex,
                                    "reason": e,
                                }),
                            );
                        } else {
                            warn!("rrc reconnect failed: {e}");
                            emit(
                                &event_tx,
                                "rrc.error",
                                json!({ "message": e, "hub_dest_hash": dest_hash_hex }),
                            );
                        }
                        if let Some(reply) = reply {
                            let _ = reply.send(Err(e));
                        }
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
                        handle_inbound(&inner, &event_tx, &hex, &bytes).await;
                    }
                    Some(RrcLinkEvent::Closed { reason }) => {
                        link = None;
                        let should_reconnect =
                            reconnect_intent.is_some() && connect_job.is_none();
                        {
                            let mut g = inner.lock().await;
                            if should_reconnect {
                                g.status = RrcSessionStatus::Reconnecting;
                            } else if connect_job.is_none() {
                                g.status = RrcSessionStatus::Disconnected;
                                g.rooms.clear();
                            }
                            g.last_error = Some(reason.clone());
                        }
                        emit(
                            &event_tx,
                            "rrc.disconnected",
                            json!({
                                "hub_dest_hash": hex,
                                "reason": reason,
                            }),
                        );
                        if should_reconnect {
                            if let Some((dest_hash, dest_hash_hex, hops, _stale_nick)) =
                                reconnect_intent.clone()
                            {
                                let nickname = {
                                    let g = inner.lock().await;
                                    g.nickname.clone().unwrap_or_else(|| "mesh-client".into())
                                };
                                let delay = backoff_ms;
                                debug!(
                                    "rrc reconnecting to {dest_hash_hex} in {delay}ms"
                                );
                                backoff_ms =
                                    (backoff_ms.saturating_mul(2)).min(RECONNECT_MAX_MS);
                                connect_job = Some(spawn_connect_job(
                                    transport_tx.clone(),
                                    identity.clone(),
                                    Arc::clone(&inner),
                                    event_tx.clone(),
                                    dest_hash,
                                    dest_hash_hex,
                                    hops,
                                    nickname,
                                    delay,
                                    None,
                                ));
                            }
                        }
                    }
                    None => {
                        link = None;
                    }
                }
            }
        }

        if terminate {
            shared.hubs.lock().await.remove(&hex);
            break;
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
    hub_dest_hash: &str,
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
                    "hub_dest_hash": hub_dest_hash,
                    "room": room,
                    "members": members_json(&members),
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
            emit(
                event_tx,
                "rrc.room.parted",
                json!({ "hub_dest_hash": hub_dest_hash, "room": room }),
            );
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
            emit(
                event_tx,
                "rrc.error",
                json!({ "message": message, "hub_dest_hash": hub_dest_hash }),
            );
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
