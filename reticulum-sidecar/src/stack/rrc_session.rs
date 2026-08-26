//! High-level RRC session (HELLO → WELCOME → rooms) over a persistent Link.
//!
//! Multi-hub: each connected hub gets its own spawned task (own Link, own
//! connect job, own reconnect loop) so a Connect to hub B never touches hub
//! A's link. `RrcSessionManager` is a thin router keyed by lowercase
//! `hub_dest_hash` hex; per-hub state lives in that hub's task via
//! `RrcSessionInner` (read directly for snapshots — no round trip through the
//! command channel is needed for status/rooms reads).

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use tracing::{debug, warn};

use super::rrc_codec::{
    RRC_IDENTITY_HASH_LEN, RrcEnvelope, RrcResourceEnvelopeMeta, RrcWelcomeCapabilities,
    RrcWelcomeLimits, apply_advisory_nick, body_as_text, decode_envelope, encode_envelope,
    hello_body, msg_type, parse_joined_members, parse_resource_envelope_body,
    parse_welcome_capabilities, parse_welcome_hub_name, parse_welcome_hub_version,
    parse_welcome_limits, text_body,
};
use super::rrc_link::{
    MAX_CONCURRENT_RRC_RESOURCES, RrcLinkError, RrcLinkEvent, RrcLinkHandle, open_rrc_link,
};

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
    hub_version: Option<String>,
    nickname: Option<String>,
    rooms: HashMap<String, RrcRoomState>,
    /// Normalized room name → optional join key retained for reconnect.
    desired_rooms: HashMap<String, Option<String>>,
    /// Wire room + join key queued after involuntary hub PARTED while still desired.
    pending_rejoins: Vec<(String, Option<String>)>,
    last_error: Option<String>,
    identity_hash: [u8; 16],
    capabilities: RrcWelcomeCapabilities,
    limits: RrcWelcomeLimits,
    /// FIFO expectations from `T_RESOURCE_ENVELOPE` until RNS Resource completes.
    pending_resources: VecDeque<(RrcResourceEnvelopeMeta, Option<String>, Instant)>,
}

impl RrcSessionInner {
    fn new(identity_hash: [u8; 16]) -> Self {
        Self {
            status: RrcSessionStatus::Disconnected,
            hub_name: None,
            hub_version: None,
            nickname: None,
            rooms: HashMap::new(),
            desired_rooms: HashMap::new(),
            pending_rejoins: Vec::new(),
            last_error: None,
            identity_hash,
            capabilities: RrcWelcomeCapabilities::default(),
            limits: RrcWelcomeLimits::default(),
            pending_resources: VecDeque::new(),
        }
    }

    fn remember_desired_room(&mut self, room: &str, key: Option<String>) {
        let norm = normalize_room(room);
        if norm.is_empty() {
            return;
        }
        let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        match self.desired_rooms.get_mut(&norm) {
            Some(existing) => {
                if key.is_some() {
                    *existing = key;
                }
            }
            None => {
                self.desired_rooms.insert(norm, key);
            }
        }
    }

    /// Queue a silent re-JOIN; dedupe by normalized room name.
    fn queue_pending_rejoin(&mut self, room: String, join_key: Option<String>) {
        let key = normalize_room(&room);
        let already_pending = self
            .pending_rejoins
            .iter()
            .any(|(pending_room, _)| normalize_room(pending_room) == key);
        if !already_pending {
            self.pending_rejoins.push((room, join_key));
        }
    }
}

fn reset_hub_metadata(g: &mut RrcSessionInner) {
    g.hub_name = None;
    g.hub_version = None;
    g.capabilities = RrcWelcomeCapabilities::default();
    g.limits = RrcWelcomeLimits::default();
    g.pending_resources.clear();
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
        if let Some(hex) = normalize_hex(hub_dest_hash) {
            let Some(handle) = self.get_handle(&hex).await else {
                return json!({ "rooms": [] });
            };
            let g = handle.inner.lock().await;
            json!({ "rooms": rooms_json(&g.rooms) })
        } else {
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
        rx.await
            .map_err(|_| "rrc session task stopped".to_string())?
    }

    /// `None` (or empty) tears down every tracked hub session; `Some(hex)`
    /// tears down only that hub. Either way the hub's task frees its slot.
    pub async fn disconnect(&self, dest_hash_hex: Option<&str>) {
        let targets: Vec<(String, HubHandle)> = if let Some(hex) = normalize_hex(dest_hash_hex) {
            let hubs = self.shared.hubs.lock().await;
            hubs.get(&hex)
                .cloned()
                .map(|h| (hex, h))
                .into_iter()
                .collect()
        } else {
            let hubs = self.shared.hubs.lock().await;
            hubs.iter()
                .map(|(hex, h)| (hex.clone(), h.clone()))
                .collect()
        };
        for (hex, handle) in targets {
            let (reply, rx) = oneshot::channel();
            if handle
                .cmd_tx
                .send(SessionCommand::Disconnect { reply })
                .await
                .is_ok()
            {
                let _ = rx.await;
            } else {
                // Dead command channel — free the slot so it cannot zombie-cap.
                self.shared.hubs.lock().await.remove(&hex);
            }
        }
    }

    pub async fn join(
        &self,
        hub_dest_hash: &str,
        room: String,
        key: Option<String>,
    ) -> Result<(), String> {
        let handle = self.require_handle(hub_dest_hash).await?;
        let (reply, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(SessionCommand::Join { room, key, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await
            .map_err(|_| "rrc session task stopped".to_string())?
    }

    pub async fn part(&self, hub_dest_hash: &str, room: String) -> Result<(), String> {
        let handle = self.require_handle(hub_dest_hash).await?;
        let (reply, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(SessionCommand::Part { room, reply })
            .await
            .map_err(|_| "rrc session task stopped".to_string())?;
        rx.await
            .map_err(|_| "rrc session task stopped".to_string())?
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
        rx.await
            .map_err(|_| "rrc session task stopped".to_string())?
    }

    async fn get_handle(&self, hub_dest_hash: &str) -> Option<HubHandle> {
        let hex = hub_dest_hash.trim().to_lowercase();
        self.shared.hubs.lock().await.get(&hex).cloned()
    }

    async fn require_handle(&self, hub_dest_hash: &str) -> Result<HubHandle, String> {
        self.get_handle(hub_dest_hash).await.ok_or_else(|| {
            format!(
                "no active rrc session for hub {}",
                hub_dest_hash.trim().to_lowercase()
            )
        })
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
        "hub_version": g.hub_version,
        "identity_hash": hex::encode(g.identity_hash),
        "nickname": g.nickname,
        "rooms": rooms_json(&g.rooms),
        "error": g.last_error,
        "capabilities": {
            "direct_notice": g.capabilities.direct_notice,
            "action": g.capabilities.action,
            "resource_envelope": g.capabilities.resource_envelope,
        },
        "limits": {
            "max_nick_bytes": g.limits.max_nick_bytes,
            "max_room_name_bytes": g.limits.max_room_name_bytes,
            "max_msg_body_bytes": g.limits.max_msg_body_bytes,
            "max_rooms_per_session": g.limits.max_rooms_per_session,
            "rate_limit_msgs_per_minute": g.limits.rate_limit_msgs_per_minute,
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
        // Dropping `fut` aborts establish_session. If a link was already open,
        // dropping RrcLinkHandle closes the LinkSession (cmd channel drop → close).
        // Mid-handshake cleanup is owned by LinkSession / link_endpoint guards.
    }
}

#[allow(clippy::too_many_arguments)] // connect job bundles transport + session state for one spawn site
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
                            g.rooms.clear();
                            g.desired_rooms.clear();
                            g.pending_rejoins.clear();
                            g.last_error = None;
                            reset_hub_metadata(&mut g);
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
                            g.pending_rejoins.clear();
                            reset_hub_metadata(&mut g);
                        }
                        emit(
                            &event_tx,
                            "rrc.disconnected",
                            json!({
                                "hub_dest_hash": hex,
                                "reason": "local_disconnect",
                                "will_reconnect": false,
                            }),
                        );
                        let _ = reply.send(());
                        terminate = true;
                    }
                    SessionCommand::Join { room, key, reply } => {
                        let join_key = key.clone();
                        let result = send_room_control(
                            &mut link,
                            &inner,
                            Some(room.clone()),
                            msg_type::JOIN,
                            key,
                        )
                        .await;
                        if result.is_ok() {
                            inner
                                .lock()
                                .await
                                .remember_desired_room(&room, join_key);
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
                        let result = {
                            let mut g = inner.lock().await;
                            let nick = nickname.trim().to_string();
                            if nick.is_empty() {
                                Err("nickname must not be empty".into())
                            } else if g
                                .limits
                                .max_nick_bytes
                                .is_some_and(|max| nick.len() as u64 > max)
                            {
                                Err(format!(
                                    "nickname exceeds hub limit ({} bytes)",
                                    g.limits.max_nick_bytes.unwrap_or(0)
                                ))
                            } else {
                                g.nickname = Some(nick.clone());
                                // Keep reconnect HELLO in sync with the live nickname.
                                if let Some((_, _, _, intent_nick)) = reconnect_intent.as_mut() {
                                    *intent_nick = nick;
                                }
                                Ok(())
                            }
                        };
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
                        let hub_hex = dest_hash_hex.clone();
                        reconnect_intent =
                            Some((dest_hash, dest_hash_hex, hops, nickname.clone()));
                        backoff_ms = RECONNECT_BASE_MS;
                        // Re-join desired rooms after welcome (reconnect path).
                        let rooms: Vec<(String, Option<String>)> = {
                            let g = inner.lock().await;
                            g.desired_rooms
                                .iter()
                                .map(|(room, key)| (room.clone(), key.clone()))
                                .collect()
                        };
                        for (room, key) in rooms {
                            let rejoin = send_room_control(
                                &mut link,
                                &inner,
                                Some(room.clone()),
                                msg_type::JOIN,
                                key,
                            )
                            .await;
                            if let Err(e) = rejoin {
                                handle_rejoin_failure(
                                    &inner,
                                    &event_tx,
                                    &hub_hex,
                                    &room,
                                    &e,
                                )
                                .await;
                            }
                        }
                        if let Some(reply) = reply {
                            let _ = reply.send(Ok(()));
                        }
                    }
                    Err(e) => {
                        let is_user_connect = reply.is_some();
                        let should_retry =
                            !is_user_connect && reconnect_intent.is_some();
                        {
                            let mut g = inner.lock().await;
                            if should_retry {
                                g.status = RrcSessionStatus::Reconnecting;
                            } else {
                                g.status = RrcSessionStatus::Disconnected;
                            }
                            g.last_error = Some(e.clone());
                        }
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
                                "will_reconnect": should_retry,
                            }),
                        );
                        if let Some(reply) = reply {
                            let _ = reply.send(Err(e));
                        } else if should_retry {
                            warn!("rrc reconnect failed; scheduling retry");
                        }
                        if should_retry {
                            if let Some((
                                retry_dest,
                                retry_hex,
                                retry_hops,
                                intent_nick,
                            )) = reconnect_intent.clone()
                            {
                                let nickname = resolve_reconnect_nickname(
                                    &inner,
                                    &intent_nick,
                                )
                                .await;
                                let delay = backoff_ms;
                                debug!(
                                    "rrc reconnecting to {retry_hex} in {delay}ms after failure"
                                );
                                backoff_ms =
                                    (backoff_ms.saturating_mul(2)).min(RECONNECT_MAX_MS);
                                connect_job = Some(spawn_connect_job(
                                    transport_tx.clone(),
                                    identity.clone(),
                                    Arc::clone(&inner),
                                    event_tx.clone(),
                                    retry_dest,
                                    retry_hex,
                                    retry_hops,
                                    nickname,
                                    delay,
                                    None,
                                ));
                            }
                        } else if is_user_connect {
                            // Initial connect failed — free the hub slot so
                            // failed hubs cannot exhaust MAX_HUB_SESSIONS.
                            terminate = true;
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
                        if let Some(reply) =
                            handle_inbound(&inner, &event_tx, &hex, &bytes).await
                        {
                            if let Some(handle) = link.as_ref() {
                                match encode_envelope(&reply) {
                                    Ok(out) => {
                                        if let Err(e) = handle.send(out).await {
                                            warn!("rrc PONG send failed: {e}");
                                        }
                                    }
                                    Err(e) => {
                                        warn!("rrc PONG encode failed: {e}");
                                    }
                                }
                            }
                        }
                        // True self-PARTED while room still desired (e.g. multi-link
                        // edge case) — re-JOIN without emitting rrc.room.parted.
                        let rejoins = {
                            let mut g = inner.lock().await;
                            std::mem::take(&mut g.pending_rejoins)
                        };
                        for (room, key) in rejoins {
                            let rejoin = send_room_control(
                                &mut link,
                                &inner,
                                Some(room.clone()),
                                msg_type::JOIN,
                                key,
                            )
                            .await;
                            if let Err(e) = rejoin {
                                handle_rejoin_failure(&inner, &event_tx, &hex, &room, &e).await;
                            }
                        }
                    }
                    Some(RrcLinkEvent::ResourcePayload { data }) => {
                        dispatch_resource_payload(&inner, &event_tx, &hex, data).await;
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
                                "will_reconnect": should_reconnect,
                            }),
                        );
                        if should_reconnect {
                            if let Some((dest_hash, dest_hash_hex, hops, intent_nick)) =
                                reconnect_intent.clone()
                            {
                                let nickname =
                                    resolve_reconnect_nickname(&inner, &intent_nick).await;
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

#[allow(clippy::too_many_arguments)] // handshake needs transport, identity, and hub metadata together
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
                    let hub_name = parse_welcome_hub_name(env.body.as_ref());
                    let hub_version = parse_welcome_hub_version(env.body.as_ref());
                    let capabilities = parse_welcome_capabilities(env.body.as_ref());
                    let limits = parse_welcome_limits(env.body.as_ref());
                    {
                        let mut g = inner.lock().await;
                        g.status = RrcSessionStatus::Active;
                        g.hub_name = hub_name.clone();
                        g.hub_version = hub_version;
                        g.capabilities = capabilities.clone();
                        g.limits = limits;
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
                    let msg = body_as_text(env.body.as_ref()).unwrap_or_else(|| "hub ERROR".into());
                    handle.close().await;
                    return Err(msg);
                }
                // Ignore other frames until WELCOME.
            }
            Ok(Some(RrcLinkEvent::ResourcePayload { .. })) => {
                // Greeting resources may arrive around WELCOME; ignore until Active.
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

/// Shared JOIN-failure cleanup for reconnect rejoin and pending_rejoins.
/// Removes the room from desired + live maps and notifies the renderer.
async fn handle_rejoin_failure(
    inner: &Arc<Mutex<RrcSessionInner>>,
    event_tx: &broadcast::Sender<String>,
    hub_hex: &str,
    room: &str,
    err: &str,
) {
    warn!("rrc rejoin {room} failed: {err}");
    {
        let mut g = inner.lock().await;
        let key = normalize_room(room);
        g.desired_rooms.remove(&key);
        g.rooms.remove(&key);
    }
    emit(
        event_tx,
        "rrc.room.parted",
        json!({ "hub_dest_hash": hub_hex, "room": room }),
    );
    emit(
        event_tx,
        "rrc.error",
        json!({
            "hub_dest_hash": hub_hex,
            "message": format!("rejoin {room} failed: {err}"),
        }),
    );
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
        if room.as_ref().map(|r| !r.trim().is_empty()).unwrap_or(false) {
            return Err("direct NOTICE must omit K_ROOM".into());
        }
    }
    let room_name = if dst_identity.is_some() {
        None
    } else {
        room.map(|r| r.trim().to_string()).filter(|r| !r.is_empty())
    };
    if let Some(ref b) = body {
        let max = inner.lock().await.limits.max_msg_body_bytes;
        if let Some(max) = max {
            if b.len() as u64 > max {
                return Err(format!("message exceeds hub limit ({max} bytes)"));
            }
        }
    }
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

/// Handles an inbound RRC envelope. Returns a reply envelope when the peer
/// must be answered on the wire (PING → PONG).
async fn handle_inbound(
    inner: &Arc<Mutex<RrcSessionInner>>,
    event_tx: &broadcast::Sender<String>,
    hub_dest_hash: &str,
    bytes: &[u8],
) -> Option<RrcEnvelope> {
    let Ok(env) = decode_envelope(bytes) else {
        return None;
    };
    match env.msg_type {
        msg_type::JOINED => {
            let room = env.room_name.clone().unwrap_or_default();
            let key = normalize_room(&room);
            let incoming = apply_advisory_nick(
                parse_joined_members(env.body.as_ref()),
                env.nickname.as_deref(),
            );
            let members_for_emit = {
                let mut g = inner.lock().await;
                let members = apply_joined_to_room(&mut g, &key, &room, &incoming);
                g.remember_desired_room(&room, None);
                members
            };
            emit(
                event_tx,
                "rrc.room.joined",
                json!({
                    "hub_dest_hash": hub_dest_hash,
                    "room": room,
                    "members": members_json(&members_for_emit),
                }),
            );
            None
        }
        msg_type::PARTED => {
            let room = env.room_name.clone().unwrap_or_default();
            let key = normalize_room(&room);
            let parting_peers = apply_advisory_nick(
                parse_joined_members(env.body.as_ref()),
                env.nickname.as_deref(),
            );
            let (about_self, auto_rejoin, peer_removed) = {
                let mut g = inner.lock().await;
                let our_hash = hex::encode(g.identity_hash);
                let about_self = parted_concerns_self(
                    env.body.as_ref(),
                    env.nickname.as_deref(),
                    &our_hash,
                    g.nickname.as_deref(),
                );
                if about_self {
                    g.rooms.remove(&key);
                    let auto_rejoin = match g.desired_rooms.get(&key).cloned() {
                        Some(join_key) => {
                            g.queue_pending_rejoin(room.clone(), join_key);
                            true
                        }
                        None => false,
                    };
                    (true, auto_rejoin, Vec::new())
                } else {
                    // Fanout: another member left — update roster only.
                    let mut removed = parting_peers.clone();
                    if let Some(state) = g.rooms.get_mut(&key) {
                        if !parting_peers.is_empty() {
                            for (h, _) in &parting_peers {
                                state.members.retain(|(mh, _)| !mh.eq_ignore_ascii_case(h));
                            }
                        } else if let Some(n) = env.nickname.as_deref() {
                            let n = n.trim();
                            let before = state.members.len();
                            state.members.retain(|(_, mn)| {
                                mn.as_ref()
                                    .map(|m| !m.trim().eq_ignore_ascii_case(n))
                                    .unwrap_or(true)
                            });
                            if state.members.len() < before && removed.is_empty() {
                                removed.push((String::new(), Some(n.to_string())));
                            }
                        }
                    }
                    (false, false, removed)
                }
            };
            if about_self && !auto_rejoin {
                emit(
                    event_tx,
                    "rrc.room.parted",
                    json!({ "hub_dest_hash": hub_dest_hash, "room": room }),
                );
            } else if !about_self && !peer_removed.is_empty() {
                emit(
                    event_tx,
                    "rrc.room.peer_parted",
                    json!({
                        "hub_dest_hash": hub_dest_hash,
                        "room": room,
                        "members": members_json(&peer_removed),
                    }),
                );
            }
            None
        }
        msg_type::MSG | msg_type::NOTICE | msg_type::ACTION => {
            let kind = match env.msg_type {
                msg_type::NOTICE => "notice",
                msg_type::ACTION => "action",
                _ => "msg",
            };
            let room = env.room_name.clone().unwrap_or_default();
            let body = body_as_text(env.body.as_ref()).unwrap_or_default();
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
            None
        }
        msg_type::PING => {
            // Spec (4-RRC): clients must reply to PING with PONG; hubs may close
            // the Link if the client stays silent.
            let g = inner.lock().await;
            Some(RrcEnvelope::new(
                msg_type::PONG,
                g.identity_hash,
                None,
                env.body.clone(),
                g.nickname.clone(),
            ))
        }
        msg_type::ERROR => {
            let message = body_as_text(env.body.as_ref()).unwrap_or_else(|| "hub error".into());
            {
                let mut g = inner.lock().await;
                g.last_error = Some(message.clone());
            }
            emit(
                event_tx,
                "rrc.error",
                json!({ "message": message, "hub_dest_hash": hub_dest_hash }),
            );
            None
        }
        msg_type::RESOURCE_ENVELOPE => {
            let meta = parse_resource_envelope_body(env.body.as_ref());
            if let Some(meta) = meta {
                let mut g = inner.lock().await;
                // Bound pending expectations (rrcd default max_pending=8).
                while g.pending_resources.len() >= MAX_CONCURRENT_RRC_RESOURCES {
                    g.pending_resources.pop_front();
                }
                g.pending_resources
                    .push_back((meta, env.room_name.clone(), Instant::now()));
            }
            // Offer acceptance runs on the link task; payload arrives as ResourcePayload.
            None
        }
        msg_type::WELCOME => {
            let hub_name = parse_welcome_hub_name(env.body.as_ref());
            let hub_version = parse_welcome_hub_version(env.body.as_ref());
            let capabilities = parse_welcome_capabilities(env.body.as_ref());
            let limits = parse_welcome_limits(env.body.as_ref());
            let mut g = inner.lock().await;
            if let Some(name) = hub_name {
                g.hub_name = Some(name);
            }
            if let Some(ver) = hub_version {
                g.hub_version = Some(ver);
            }
            g.capabilities = capabilities;
            g.limits = limits;
            g.status = RrcSessionStatus::Active;
            None
        }
        _ => None,
    }
}

/// EX1: actor JOINED with full list replaces; empty keeps; single-peer fanout merges.
fn apply_joined_to_room(
    g: &mut RrcSessionInner,
    key: &str,
    room: &str,
    incoming: &[(String, Option<String>)],
) -> Vec<(String, Option<String>)> {
    if let Some(state) = g.rooms.get_mut(key) {
        if incoming.is_empty() {
            // Empty JOINED (include_joined_member_list=false) must not wipe roster.
        } else if incoming.len() == 1 {
            let (h, n) = &incoming[0];
            if let Some(slot) = state
                .members
                .iter_mut()
                .find(|(mh, _)| mh.eq_ignore_ascii_case(h))
            {
                if n.as_ref().is_some_and(|s| !s.trim().is_empty()) {
                    slot.1 = n.clone();
                }
            } else {
                state.members.push((h.clone(), n.clone()));
            }
            if !room.is_empty() {
                state.name = room.to_string();
            }
        } else {
            state.members = incoming.to_vec();
            if !room.is_empty() {
                state.name = room.to_string();
            }
        }
        return state.members.clone();
    }
    let members = incoming.to_vec();
    g.rooms.insert(
        key.to_string(),
        RrcRoomState {
            name: if room.is_empty() {
                key.to_string()
            } else {
                room.to_string()
            },
            members: members.clone(),
        },
    );
    members
}

fn purge_stale_pending_resources(
    pending: &mut VecDeque<(RrcResourceEnvelopeMeta, Option<String>, Instant)>,
) {
    let now = Instant::now();
    while pending
        .front()
        .is_some_and(|(_, _, t)| now.duration_since(*t) > Duration::from_secs(30))
    {
        pending.pop_front();
    }
}

/// Match RESOURCE_ENVELOPE metadata to a completed payload by SHA256 (not FIFO).
fn take_pending_resource_for_digest(
    pending: &mut VecDeque<(RrcResourceEnvelopeMeta, Option<String>, Instant)>,
    digest: [u8; 32],
) -> Option<(RrcResourceEnvelopeMeta, Option<String>)> {
    purge_stale_pending_resources(pending);
    if let Some(idx) = pending
        .iter()
        .position(|(meta, _, _)| meta.sha256 == Some(digest))
    {
        let (meta, room, _) = pending.remove(idx)?;
        return Some((meta, room));
    }
    None
}

async fn dispatch_resource_payload(
    inner: &Arc<Mutex<RrcSessionInner>>,
    event_tx: &broadcast::Sender<String>,
    hub_dest_hash: &str,
    data: Vec<u8>,
) {
    let digest: [u8; 32] = Sha256::digest(&data).into();
    let expectation = {
        let mut g = inner.lock().await;
        take_pending_resource_for_digest(&mut g.pending_resources, digest)
    };
    let Some((meta, room)) = expectation else {
        debug!(
            "rrc resource payload with no matching envelope hub={} bytes={}",
            hub_dest_hash,
            data.len()
        );
        return;
    };
    if let Some(expected) = meta.sha256 {
        if expected != digest {
            warn!(
                "rrc resource sha256 mismatch hub={} kind={} size={}",
                hub_dest_hash,
                meta.kind,
                data.len()
            );
            return;
        }
    }
    if meta.kind == "blob" {
        debug!(
            "rrc resource blob ignored hub={} bytes={}",
            hub_dest_hash,
            data.len()
        );
        return;
    }
    if meta.kind != "notice" && meta.kind != "motd" {
        debug!(
            "rrc resource unknown kind={} hub={}",
            meta.kind, hub_dest_hash
        );
        return;
    }
    let room = room.unwrap_or_default();
    let Ok(text) = String::from_utf8(data) else {
        warn!("rrc resource payload is not utf-8 hub={hub_dest_hash}");
        return;
    };
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    emit(
        event_tx,
        "rrc.message",
        json!({
            "id": format!("rrc-res-{}", uuid::Uuid::new_v4().simple()),
            "room": room,
            "kind": "notice",
            "body": text,
            "sender_hash": hub_dest_hash,
            "nickname": serde_json::Value::Null,
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            "hub_dest_hash": hub_dest_hash,
            "dst_hash": serde_json::Value::Null,
        }),
    );
}

fn normalize_room(room: &str) -> String {
    room.trim().to_lowercase()
}

/// Decide whether an inbound PARTED means *we* left the room.
///
/// Stock rrcd:
/// - Actor-facing PART ack: no `K_NICK`; optional body `[our_hash]`.
/// - Member fanout when someone else leaves: `K_NICK` = their nick; optional
///   body `[their_hash]`.
///
/// Treating fanout as self-leave made busy rooms look like constant hub kicks.
fn parted_concerns_self(
    body: Option<&ciborium::value::Value>,
    nick: Option<&str>,
    our_hash_hex: &str,
    our_nick: Option<&str>,
) -> bool {
    let peers = parse_joined_members(body);
    if !peers.is_empty() {
        return peers
            .iter()
            .any(|(h, _)| h.eq_ignore_ascii_case(our_hash_hex));
    }
    match nick.map(str::trim).filter(|s| !s.is_empty()) {
        Some(n) => our_nick
            .map(|o| o.trim().eq_ignore_ascii_case(n))
            .unwrap_or(false),
        // No body hashes and no nick → actor-facing self PARTED.
        None => true,
    }
}

async fn resolve_reconnect_nickname(
    inner: &Arc<Mutex<RrcSessionInner>>,
    intent_nick: &str,
) -> String {
    let g = inner.lock().await;
    g.nickname
        .as_ref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let trimmed = intent_nick.trim();
            if trimmed.is_empty() {
                "mesh-client".into()
            } else {
                trimmed.to_string()
            }
        })
}

#[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
fn emit(event_tx: &broadcast::Sender<String>, event_type: &str, payload: serde_json::Value) {
    let frame = json!({ "type": event_type, "payload": payload });
    let _ = event_tx.send(frame.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remember_desired_room_keeps_join_key() {
        let mut inner = RrcSessionInner::new([0u8; 16]);
        inner.remember_desired_room("#Lobby", Some("secret".into()));
        assert_eq!(
            inner
                .desired_rooms
                .get("#lobby")
                .cloned()
                .flatten()
                .as_deref(),
            Some("secret")
        );
        // JOINED without key must not wipe the stored key.
        inner.remember_desired_room("#lobby", None);
        assert_eq!(
            inner
                .desired_rooms
                .get("#lobby")
                .cloned()
                .flatten()
                .as_deref(),
            Some("secret")
        );
        // Explicit new key replaces.
        inner.remember_desired_room("#lobby", Some("newkey".into()));
        assert_eq!(
            inner
                .desired_rooms
                .get("#lobby")
                .cloned()
                .flatten()
                .as_deref(),
            Some("newkey")
        );
    }

    #[test]
    fn normalize_room_trims_and_lowercases() {
        assert_eq!(normalize_room("  #General "), "#general");
    }

    #[test]
    fn involuntary_parted_queues_rejoin_when_desired() {
        let mut inner = RrcSessionInner::new([0u8; 16]);
        inner.remember_desired_room("general", None);
        inner.rooms.insert(
            "general".into(),
            RrcRoomState {
                name: "general".into(),
                members: vec![],
            },
        );
        let key = normalize_room("general");
        inner.rooms.remove(&key);
        match inner.desired_rooms.get(&key) {
            Some(join_key) => {
                inner.queue_pending_rejoin("general".into(), join_key.clone());
            }
            None => panic!("expected desired room"),
        }
        assert_eq!(inner.pending_rejoins.len(), 1);
        assert!(inner.desired_rooms.contains_key("general"));
        // Duplicate involuntary PART (case / whitespace variants) must not queue twice.
        inner.queue_pending_rejoin("  General ".into(), None);
        assert_eq!(inner.pending_rejoins.len(), 1);
        // Voluntary PART removes desired first — no rejoin queue.
        inner.desired_rooms.remove("general");
        inner.pending_rejoins.clear();
        assert!(!inner.desired_rooms.contains_key("general"));
    }

    #[test]
    fn parted_fanout_other_nick_is_not_self() {
        assert!(!parted_concerns_self(
            None,
            Some("pmow"),
            "128eb883f0c94439bdb2069947319022",
            Some("valerius"),
        ));
    }

    #[test]
    fn parted_actor_ack_without_nick_is_self() {
        assert!(parted_concerns_self(
            None,
            None,
            "128eb883f0c94439bdb2069947319022",
            Some("me"),
        ));
    }

    #[test]
    fn parted_matching_nick_is_self() {
        assert!(parted_concerns_self(
            None,
            Some("Me"),
            "128eb883f0c94439bdb2069947319022",
            Some("me"),
        ));
    }

    #[test]
    fn parted_body_hash_distinguishes_self() {
        use ciborium::value::Value;
        let our = hex::decode("128eb883f0c94439bdb2069947319022").unwrap();
        let other = hex::decode("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
        let self_body = Value::Array(vec![Value::Bytes(our)]);
        let other_body = Value::Array(vec![Value::Bytes(other)]);
        assert!(parted_concerns_self(
            Some(&self_body),
            Some("ignored-when-body"),
            "128eb883f0c94439bdb2069947319022",
            Some("me"),
        ));
        assert!(!parted_concerns_self(
            Some(&other_body),
            Some("pmow"),
            "128eb883f0c94439bdb2069947319022",
            Some("me"),
        ));
    }

    #[test]
    fn connect_reset_clears_hub_metadata() {
        let mut inner = RrcSessionInner::new([0u8; 16]);
        inner.hub_version = Some("0.3.2".into());
        inner.limits.max_nick_bytes = Some(32);
        inner.pending_resources.push_back((
            RrcResourceEnvelopeMeta {
                id: None,
                kind: "notice".into(),
                size: 1,
                sha256: Some([1u8; 32]),
                encoding: "utf-8".into(),
            },
            Some("general".into()),
            Instant::now(),
        ));
        reset_hub_metadata(&mut inner);
        assert!(inner.hub_version.is_none());
        assert!(inner.limits.max_nick_bytes.is_none());
        assert!(inner.pending_resources.is_empty());
    }

    #[test]
    fn take_pending_resource_matches_by_sha256_not_fifo() {
        let mut pending = VecDeque::new();
        let hash_a = [0xAAu8; 32];
        let hash_b = [0xBBu8; 32];
        pending.push_back((
            RrcResourceEnvelopeMeta {
                id: None,
                kind: "notice".into(),
                size: 1,
                sha256: Some(hash_a),
                encoding: "utf-8".into(),
            },
            Some("room-a".into()),
            Instant::now(),
        ));
        pending.push_back((
            RrcResourceEnvelopeMeta {
                id: None,
                kind: "notice".into(),
                size: 2,
                sha256: Some(hash_b),
                encoding: "utf-8".into(),
            },
            Some("room-b".into()),
            Instant::now(),
        ));
        let second = take_pending_resource_for_digest(&mut pending, hash_b).expect("match b");
        assert_eq!(second.1.as_deref(), Some("room-b"));
        assert_eq!(pending.len(), 1);
        assert!(take_pending_resource_for_digest(&mut pending, [0xCCu8; 32]).is_none());
        assert_eq!(pending.len(), 1);
    }
}
