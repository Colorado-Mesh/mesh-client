//! LRGP (Lightweight Reticulum Gaming Protocol) game session manager.
//!
//! Bridges `lrgp-rs`'s `LrgpRouter` (game dispatch) and `LrgpStore` (SQLite
//! session mirror) to the sidecar's LXMF transport and WebSocket event bus.
//! Mirrors the voice/`VoiceSessionManager` pattern: constructed once by
//! `LiveBridge::spawn`, held behind an `Arc`, and cloned into the LXMF
//! delivery callback so inbound LRGP envelopes can be intercepted before the
//! normal chat emit path.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lrgp::app_base::IncomingDispatch;
use lrgp::constants::{
    CMD_CHALLENGE, CMD_MOVE, ERR_INVALID_MOVE, ERR_NOT_YOUR_TURN, ERR_SESSION_EXPIRED, KEY_APP,
    KEY_COMMAND, KEY_PAYLOAD, KEY_SESSION, STATUS_EXPIRED,
};
use lrgp::envelope;
use lrgp::errors::LrgpError;
use lrgp::router::LrgpRouter;
use lrgp::session::Session;
use lrgp::store::LrgpStore;
use lrgp::transport;
use serde_json::Value as JsonValue;
use tokio::sync::broadcast;

use super::games_outbound_store::GamesOutboundStore;

/// Cap on `last_envelope` so abandoned sessions cannot retain resend bytes forever.
const MAX_LAST_ENVELOPES: usize = 256;

#[cfg(test)]
static FORCE_HYDRATE_STORE_READ_ERR: AtomicBool = AtomicBool::new(false);
/// Serializes tests that touch `FORCE_HYDRATE_STORE_READ_ERR` or call non-challenge
/// `prepare_action` (which reads the flag) so parallel tests cannot observe a stale inject.
#[cfg(test)]
static FORCE_HYDRATE_STORE_READ_ERR_LOCK: Mutex<()> = Mutex::new(());

/// A dispatched-but-not-yet-sent outgoing LRGP action. Callers (LiveBridge)
/// must call [`GamesSessionManager::commit_action`] after a successful LXMF
/// send, or [`GamesSessionManager::rollback_action`] on failure.
#[derive(Debug)]
pub struct PreparedGameAction {
    pub app_id: String,
    pub session_id: String,
    pub dest_hash: String,
    pub fields: HashMap<u8, Vec<u8>>,
    pub envelope_bytes: Vec<u8>,
    pub fallback_text: String,
    snapshot: Option<Session>,
}

/// A re-derived outgoing action for resend (same envelope bytes as last time —
/// same nonce, so receiver-side replay-dedup treats it as a retransmit).
#[derive(Debug)]
pub struct PreparedResend {
    pub app_id: String,
    pub dest_hash: String,
    pub fields: HashMap<u8, Vec<u8>>,
    pub fallback_text: String,
}

pub struct GamesSessionManager {
    router: Arc<LrgpRouter>,
    store: Option<Arc<LrgpStore>>,
    outbound_store: Option<Arc<GamesOutboundStore>>,
    /// LXMF delivery hash hex of the local identity — used as `identity_id`
    /// for every router / store call (one games DB per sidecar identity).
    identity_id: String,
    event_tx: broadcast::Sender<String>,
    /// session_id -> last packed outbound envelope bytes, for resend.
    last_envelope: Mutex<HashMap<String, Vec<u8>>>,
    /// message_hash -> (session_id, app_id) for LXMF outbound status bridge.
    msg_to_session: Mutex<HashMap<String, (String, String)>>,
}

impl GamesSessionManager {
    /// Register built-in games and open the SQLite mirror under
    /// `storage_dir/lrgp/games.db`. On store-open failure, the manager stays
    /// usable for outgoing dispatch but read/list endpoints report empty.
    pub fn spawn(
        storage_dir: &Path,
        identity_id: String,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        let router = Arc::new(LrgpRouter::with_builtin_apps());

        let games_dir = storage_dir.join("lrgp");
        let store = match std::fs::create_dir_all(&games_dir) {
            Ok(()) => match LrgpStore::open(games_dir.join("games.db")) {
                Ok(store) => Some(Arc::new(store)),
                Err(e) => {
                    tracing::warn!(target: "games", "failed to open lrgp store: {e}");
                    None
                }
            },
            Err(e) => {
                tracing::warn!(target: "games", "failed to create lrgp storage dir: {e}");
                None
            }
        };

        let outbound_store = match std::fs::create_dir_all(&games_dir) {
            Ok(()) => match GamesOutboundStore::open(games_dir.join("games_outbound.db")) {
                Ok(s) => Some(Arc::new(s)),
                Err(e) => {
                    tracing::warn!(target: "games", "failed to open games outbound store: {e}");
                    None
                }
            },
            Err(e) => {
                tracing::warn!(target: "games", "failed to create games outbound storage dir: {e}");
                None
            }
        };

        let manager = Self {
            router,
            store,
            outbound_store,
            identity_id,
            event_tx,
            last_envelope: Mutex::new(HashMap::new()),
            msg_to_session: Mutex::new(HashMap::new()),
        };
        // SQLite survives stack restart; in-memory LrgpRouter does not. Without
        // this, Games tab still lists pending sessions but Accept is a no-op.
        manager.hydrate_all_from_store();
        manager.hydrate_outbound_cache();
        manager
    }

    /// Restore in-memory envelope cache + message_hash map from the overlay DB.
    fn hydrate_outbound_cache(&self) {
        let Some(outbound) = &self.outbound_store else {
            return;
        };
        let rows = match outbound.list_for_identity(&self.identity_id) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(target: "games", "failed to list outbound rows for hydrate: {e}");
                return;
            }
        };
        if let Ok(mut cache) = self.last_envelope.lock() {
            for row in &rows {
                if !row.envelope.is_empty() {
                    cache.insert(row.session_id.clone(), row.envelope.clone());
                }
            }
        }
        if let Ok(mut map) = self.msg_to_session.lock() {
            for row in &rows {
                if let (Some(hash), Some(app_id)) = (&row.message_hash, &row.app_id) {
                    map.insert(hash.clone(), (row.session_id.clone(), app_id.clone()));
                }
            }
        }
    }

    /// Inject every SQLite session row into the in-memory router (spawn / restart).
    fn hydrate_all_from_store(&self) {
        let Some(store) = &self.store else {
            return;
        };
        let sessions = match store.list_sessions(Some(&self.identity_id), None, None) {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(target: "games", "failed to list sessions for hydrate: {e}");
                return;
            }
        };
        for session in sessions {
            let app_id = session.app_id.clone();
            let session_id = session.session_id.clone();
            if let Err(e) = self.router.restore_session(session) {
                tracing::warn!(
                    target: "games",
                    "failed to hydrate session {session_id} ({app_id}): {e}"
                );
            }
        }
    }

    fn session_in_memory(&self, app_id: &str, session_id: &str) -> bool {
        self.router
            .with_app(app_id, |app| {
                !app.get_session_state(session_id, &self.identity_id)
                    .is_empty()
            })
            .unwrap_or(false)
    }

    /// Load one session from SQLite into memory when the router has no copy.
    ///
    /// Returns `Ok(true)` when hydrated, `Ok(false)` when the row is missing, and
    /// `Err` when the store read fails (callers may retry / surface the failure).
    fn hydrate_session_from_store(&self, app_id: &str, session_id: &str) -> Result<bool, String> {
        #[cfg(test)]
        if FORCE_HYDRATE_STORE_READ_ERR.load(Ordering::SeqCst) {
            tracing::warn!(
                target: "games",
                "failed to read session {session_id} from store: injected"
            );
            return Err("store_read_failed:injected".to_string());
        }
        let Some(store) = &self.store else {
            return Ok(false);
        };
        let session = match store.get_session(session_id, &self.identity_id) {
            Ok(Some(session)) => session,
            Ok(None) => return Ok(false),
            Err(e) => {
                tracing::warn!(
                    target: "games",
                    "failed to read session {session_id} from store: {e}"
                );
                return Err(format!("store_read_failed:{e}"));
            }
        };
        let app = if session.app_id.is_empty() {
            app_id.to_string()
        } else {
            session.app_id.clone()
        };
        match self.router.restore_session(session) {
            Ok(()) => Ok(true),
            Err(e) => {
                tracing::warn!(
                    target: "games",
                    "failed to hydrate session {session_id} ({app}): {e}"
                );
                Ok(false)
            }
        }
    }

    /// Ensure a non-challenge action has an in-memory session (hydrate from SQLite if needed).
    fn ensure_session_hydrated(&self, app_id: &str, session_id: &str) -> Result<(), String> {
        if self.session_in_memory(app_id, session_id) {
            return Ok(());
        }
        match self.hydrate_session_from_store(app_id, session_id) {
            Ok(true) if self.session_in_memory(app_id, session_id) => Ok(()),
            Ok(_) => Err("unknown_session".to_string()),
            Err(e) => Err(e),
        }
    }

    pub fn status(&self) -> JsonValue {
        serde_json::json!({
            "available": true,
            "enabled": self.store.is_some(),
            "app_count": self.router.list_apps().len(),
            "reason": if self.store.is_some() {
                JsonValue::Null
            } else {
                JsonValue::String("lrgp store unavailable".into())
            },
        })
    }

    pub fn list_apps(&self) -> JsonValue {
        let apps: Vec<JsonValue> = self
            .router
            .list_apps()
            .into_iter()
            .map(|m| serde_json::to_value(m).unwrap_or(JsonValue::Null))
            .collect();
        serde_json::json!({ "apps": apps })
    }

    pub fn list_sessions(&self, peer: Option<&str>) -> JsonValue {
        let Some(store) = &self.store else {
            return serde_json::json!({ "sessions": [] });
        };
        let peer_norm = peer
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(str::to_lowercase);
        let delivery_by_session = self.delivery_states_for_identity();
        match store.list_sessions(Some(&self.identity_id), None, None) {
            Ok(sessions) => {
                let rows: Vec<JsonValue> = sessions
                    .into_iter()
                    .filter(|s| match &peer_norm {
                        Some(p) => s.contact_hash.eq_ignore_ascii_case(p),
                        None => true,
                    })
                    .map(|s| {
                        let state = delivery_by_session
                            .get(&s.session_id)
                            .map(String::as_str)
                            .unwrap_or("idle");
                        Self::session_to_json_with_delivery(&s, state)
                    })
                    .collect();
                serde_json::json!({ "sessions": rows })
            }
            Err(e) => serde_json::json!({ "sessions": [], "error": e.to_string() }),
        }
    }

    pub fn session_detail(&self, session_id: &str) -> JsonValue {
        let Some(store) = &self.store else {
            return serde_json::json!({ "session": null });
        };
        match store.get_session(session_id, &self.identity_id) {
            Ok(Some(session)) => {
                serde_json::json!({ "session": self.session_to_json(&session) })
            }
            Ok(None) => serde_json::json!({ "session": null }),
            Err(e) => serde_json::json!({ "session": null, "error": e.to_string() }),
        }
    }

    /// Serialize a session and merge overlay `delivery_state` when present (single-row lookup).
    fn session_to_json(&self, session: &Session) -> JsonValue {
        let state = self
            .delivery_state_for(&session.session_id)
            .unwrap_or_else(|| "idle".into());
        Self::session_to_json_with_delivery(session, &state)
    }

    fn session_to_json_with_delivery(session: &Session, delivery_state: &str) -> JsonValue {
        let mut value = serde_json::to_value(session).unwrap_or(JsonValue::Null);
        if let Some(obj) = value.as_object_mut() {
            obj.insert(
                "delivery_state".into(),
                JsonValue::String(delivery_state.to_string()),
            );
        }
        value
    }

    fn delivery_state_for(&self, session_id: &str) -> Option<String> {
        let outbound = self.outbound_store.as_ref()?;
        outbound
            .get(session_id, &self.identity_id)
            .ok()
            .flatten()
            .map(|r| r.delivery_state)
    }

    /// One outbound list read for `list_sessions` (avoids N× `delivery_state_for`).
    fn delivery_states_for_identity(&self) -> HashMap<String, String> {
        let Some(outbound) = &self.outbound_store else {
            return HashMap::new();
        };
        match outbound.list_for_identity(&self.identity_id) {
            Ok(rows) => rows
                .into_iter()
                .map(|r| (r.session_id, r.delivery_state))
                .collect(),
            Err(e) => {
                tracing::warn!(target: "games", "failed to list outbound delivery states: {e}");
                HashMap::new()
            }
        }
    }

    pub fn mark_read(&self, session_id: &str) -> Result<(), String> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| "lrgp store unavailable".to_string())?;
        let mut updates = HashMap::new();
        updates.insert("unread".to_string(), "0".to_string());
        store
            .update_session(session_id, &self.identity_id, &updates)
            .map_err(|e| e.to_string())
    }

    /// Best-effort: mark a session's stored status as `expired` after the local
    /// app reports its idle TTL elapsed. Keeps the SQLite mirror consistent with
    /// the router's in-memory verdict so `list_sessions` (and future refreshes)
    /// stop showing a dead game as active. Never fails the caller.
    fn persist_session_expired(&self, session_id: &str) {
        let Some(store) = &self.store else {
            return;
        };
        let mut updates = HashMap::new();
        updates.insert("status".to_string(), STATUS_EXPIRED.to_string());
        updates.insert("updated_at".to_string(), now_secs().to_string());
        if let Err(e) = store.update_session(session_id, &self.identity_id, &updates) {
            tracing::warn!(target: "games", "failed to persist expired session status: {e}");
        }
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| "lrgp store unavailable".to_string())?;
        store
            .delete_session(session_id, &self.identity_id)
            .map_err(|e| e.to_string())?;
        if let Ok(mut cache) = self.last_envelope.lock() {
            cache.remove(session_id);
        }
        if let Ok(mut map) = self.msg_to_session.lock() {
            map.retain(|_, (sid, _)| sid != session_id);
        }
        if let Some(outbound) = &self.outbound_store {
            if let Err(e) = outbound.delete(session_id, &self.identity_id) {
                tracing::warn!(target: "games", "failed to delete outbound row: {e}");
            }
        }
        Ok(())
    }

    /// Intercept an inbound LXMF message's raw fields. Returns `true` when the
    /// message was a recognized LRGP envelope and has been fully dispatched —
    /// the caller must skip the normal chat emit path in that case.
    pub fn handle_inbound_lxmf(
        &self,
        fields: &BTreeMap<u8, Vec<u8>>,
        sender_hash: &str,
        _content: &str,
    ) -> bool {
        if fields.is_empty() {
            return false;
        }
        let fields_map: HashMap<u8, Vec<u8>> =
            fields.iter().map(|(&k, v)| (k, v.clone())).collect();
        let envelope = match transport::extract_envelope(&fields_map) {
            Ok(Some(env)) => env,
            Ok(None) => return false,
            Err(e) => {
                tracing::debug!(target: "games", "lrgp envelope invalid, treating as normal message: {e}");
                return false;
            }
        };

        let app_ver = envelope
            .get(KEY_APP)
            .and_then(envelope::value_as_str)
            .unwrap_or_default();
        let Some((app_id, _version)) = envelope::parse_app_version(app_ver) else {
            return false;
        };
        let app_id = app_id.to_string();
        let session_id = envelope
            .get(KEY_SESSION)
            .and_then(envelope::value_as_str)
            .unwrap_or_default()
            .to_string();
        let command = envelope
            .get(KEY_COMMAND)
            .and_then(envelope::value_as_str)
            .unwrap_or_default()
            .to_string();

        let result = match self
            .router
            .dispatch_incoming(&envelope, sender_hash, &self.identity_id)
        {
            Ok(IncomingDispatch::Applied(r)) => r,
            Ok(IncomingDispatch::Replay) => {
                tracing::debug!(
                    target: "games",
                    "dropping in-process LRGP replay for app_id={app_id} session_id={session_id} command={command}"
                );
                return true;
            }
            Ok(IncomingDispatch::RemoteError(error)) => {
                // Remote protocol errors are accepted LRGP actions; persist so
                // transport replay after restart cannot resurface the same rejection.
                self.schedule_persist_session(&error.app_id, &error.session_id);
                let payload = serde_json::json!({
                    "app_id": error.app_id,
                    "session_id": error.session_id,
                    "command": command,
                    "sender_hash": sender_hash,
                    "direction": "inbound",
                    "session": JsonValue::Null,
                    "error": {
                        "code": error.code,
                        "message": error.message,
                        "reference": error.reference,
                    },
                });
                self.emit("games.update", &payload);
                return true;
            }
            Err(e) => {
                tracing::warn!(
                    target: "games",
                    "lrgp dispatch_incoming failed for app_id={app_id} session_id={session_id} command={command}: {e}"
                );
                return false;
            }
        };

        // Defer SQLite persist so deliver_unpacked_lxmf can release router.lock()
        // before blocking I/O. Dispatch + WS emit stay synchronous.
        self.schedule_persist_session(&app_id, &session_id);

        let mut payload = serde_json::json!({
            "app_id": app_id,
            "session_id": session_id,
            "command": command,
            "sender_hash": sender_hash,
            "direction": "inbound",
        });
        if let Some(obj) = payload.as_object_mut() {
            let session_json = result
                .session
                .map(|s| JsonValue::Object(s.into_iter().collect()));
            obj.insert("session".into(), session_json.unwrap_or(JsonValue::Null));
            if let Some(emit) = result.emit {
                obj.insert(
                    "event".into(),
                    JsonValue::Object(emit.into_iter().collect()),
                );
            }
            if let Some(error) = result.error {
                obj.insert(
                    "error".into(),
                    JsonValue::Object(error.into_iter().collect()),
                );
            }
        }
        self.emit("games.update", &payload);

        true
    }

    /// Local pre-send validation mirroring Ratspeak's `DeliveryProfile::Lrgp`
    /// client-side gate: reject before spending an LXMF envelope on a move
    /// that is obviously invalid (empty payload) or out of turn.
    fn local_reject_reason(
        &self,
        app_id: &str,
        session_id: &str,
        command: &str,
        payload: &HashMap<String, rmpv::Value>,
    ) -> Option<&'static str> {
        if command != CMD_MOVE {
            return None;
        }
        if payload.is_empty() {
            return Some(ERR_INVALID_MOVE);
        }
        if session_id.is_empty() {
            return None;
        }
        let state = self.router.with_app(app_id, |app| {
            app.get_session_state(session_id, &self.identity_id)
        })?;
        let turn = state
            .get("metadata")
            .and_then(JsonValue::as_object)
            .and_then(|m| m.get("turn"))
            .and_then(JsonValue::as_str)?;
        if turn.is_empty() || turn == self.identity_id {
            None
        } else {
            Some(ERR_NOT_YOUR_TURN)
        }
    }

    /// Snapshot + dispatch an outgoing action without sending anything over
    /// LXMF. On success the caller must send `fields` and then call
    /// [`commit_action`](Self::commit_action) or
    /// [`rollback_action`](Self::rollback_action).
    pub fn prepare_action(
        &self,
        dest_hash: &str,
        app_id: &str,
        command: &str,
        session_id: Option<&str>,
        payload_json: Option<&JsonValue>,
    ) -> Result<PreparedGameAction, String> {
        let dest_hash = dest_hash.trim().to_lowercase();
        if dest_hash.len() != 32 || !dest_hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("invalid_dest_hash".to_string());
        }

        let version = self
            .router
            .with_app(app_id, |app| app.version())
            .ok_or_else(|| "unknown_app".to_string())?;

        let session_id = match session_id.map(str::trim).filter(|s| !s.is_empty()) {
            Some(id) => id.to_string(),
            None => generate_session_id(),
        };

        // Challenge creates a new in-memory session; every other command needs one.
        // After stack restart the row may exist only in SQLite until hydrated.
        if command != CMD_CHALLENGE {
            self.ensure_session_hydrated(app_id, &session_id)?;
        }

        let payload = json_payload_to_rmpv_map(payload_json);

        if let Some(reason) = self.local_reject_reason(app_id, &session_id, command, &payload) {
            return Err(reason.to_string());
        }

        let snapshot = self
            .router
            .snapshot_before_outgoing(app_id, &session_id, &self.identity_id);

        // Challenges must bind the remote peer before accept can succeed; use
        // dispatch_outgoing_to for every outbound action (matches Ratspeak).
        let prepared = match self.router.dispatch_outgoing_to(
            app_id,
            version,
            command,
            &session_id,
            &payload,
            &self.identity_id,
            &dest_hash,
        ) {
            Ok(prepared) => prepared,
            Err(LrgpError::SessionExpired(_)) => {
                // The local app considers this session past its idle TTL, so the
                // protocol can no longer act on it (resign/move/draw all fail).
                // Persist the terminal state so `list_sessions` and the UI stop
                // offering active-only controls and the row can be deleted, then
                // surface a stable error code the renderer humanizes.
                self.persist_session_expired(&session_id);
                return Err(ERR_SESSION_EXPIRED.to_string());
            }
            Err(e) => return Err(format!("dispatch_error: {e}")),
        };

        let fields = match transport::pack_into_preencoded_fields(&prepared.envelope) {
            Ok(fields) => fields,
            Err(e) => {
                let encode_error = format!("encode_error: {e}");
                if let Err(rb) = self.router.rollback_outgoing(
                    app_id,
                    &prepared.session_id,
                    &self.identity_id,
                    snapshot,
                ) {
                    tracing::warn!(
                        target: "games",
                        "lrgp rollback_outgoing after encode failure: {rb}"
                    );
                }
                return Err(encode_error);
            }
        };
        let envelope_bytes = match envelope::pack_to_bytes(&prepared.envelope) {
            Ok(bytes) => bytes,
            Err(e) => {
                let encode_error = format!("encode_error: {e}");
                if let Err(rb) = self.router.rollback_outgoing(
                    app_id,
                    &prepared.session_id,
                    &self.identity_id,
                    snapshot,
                ) {
                    tracing::warn!(
                        target: "games",
                        "lrgp rollback_outgoing after encode failure: {rb}"
                    );
                }
                return Err(encode_error);
            }
        };

        Ok(PreparedGameAction {
            app_id: app_id.to_string(),
            session_id: prepared.session_id,
            dest_hash,
            fields,
            envelope_bytes,
            fallback_text: prepared.fallback_text,
            snapshot,
        })
    }

    /// Re-derive the last dispatched envelope for a session so it can be
    /// resent verbatim (same nonce — receiver-side dedup treats it as a
    /// retransmit rather than a new move).
    pub fn prepare_resend(&self, session_id: &str) -> Result<PreparedResend, String> {
        let envelope_bytes = {
            let from_memory = self
                .last_envelope
                .lock()
                .map_err(|_| "games cache poisoned".to_string())?
                .get(session_id)
                .cloned();
            if let Some(bytes) = from_memory {
                bytes
            } else if let Some(outbound) = &self.outbound_store {
                let row = outbound
                    .get(session_id, &self.identity_id)
                    .map_err(|e| format!("outbound_read_error: {e}"))?
                    .ok_or_else(|| "no_previous_action".to_string())?;
                if row.envelope.is_empty() {
                    return Err("no_previous_action".to_string());
                }
                if let Ok(mut cache) = self.last_envelope.lock() {
                    cache.insert(session_id.to_string(), row.envelope.clone());
                }
                row.envelope
            } else {
                return Err("no_previous_action".to_string());
            }
        };
        let envelope = envelope::unpack_from_bytes(&envelope_bytes)
            .map_err(|e| format!("resend_decode_error: {e}"))?;
        let app_ver = envelope
            .get(KEY_APP)
            .and_then(envelope::value_as_str)
            .unwrap_or_default();
        let (app_id, _version) = envelope::parse_app_version(app_ver)
            .ok_or_else(|| "resend_decode_error: invalid app.version".to_string())?;
        let app_id = app_id.to_string();
        let command = envelope
            .get(KEY_COMMAND)
            .and_then(envelope::value_as_str)
            .unwrap_or_default()
            .to_string();
        let payload = envelope
            .get(KEY_PAYLOAD)
            .and_then(envelope::map_from_value)
            .unwrap_or_default();

        let dest_hash = self
            .store_contact_hash(session_id)
            .ok_or_else(|| "unknown_session".to_string())?;

        let fallback_text = self
            .router
            .with_app(&app_id, |app| app.render_fallback(&command, &payload))
            .unwrap_or_default();
        let fields = transport::pack_into_preencoded_fields(&envelope)
            .map_err(|e| format!("resend_encode_error: {e}"))?;

        Ok(PreparedResend {
            app_id,
            dest_hash,
            fields,
            fallback_text,
        })
    }

    fn store_contact_hash(&self, session_id: &str) -> Option<String> {
        let store = self.store.as_ref()?;
        let session = store.get_session(session_id, &self.identity_id).ok()??;
        let contact = session.contact_hash;
        if contact.is_empty() {
            None
        } else {
            Some(contact)
        }
    }

    /// Persist state + cache the envelope for resend + emit WS events after a
    /// successful LXMF enqueue (`try_send`).
    pub fn commit_action(&self, action: &PreparedGameAction, message_hash: Option<&str>) {
        self.persist_session_from_state(&action.app_id, &action.session_id);
        if let Ok(mut cache) = self.last_envelope.lock() {
            cache.insert(action.session_id.clone(), action.envelope_bytes.clone());
            // Cap resend cache so deleted/abandoned sessions cannot retain
            // envelopes for the process lifetime.
            while cache.len() > MAX_LAST_ENVELOPES {
                let victim = cache.keys().find(|k| *k != &action.session_id).cloned();
                match victim {
                    Some(k) => {
                        cache.remove(&k);
                    }
                    None => break,
                }
            }
        }
        if let Some(hash) = message_hash {
            self.insert_msg_to_session(hash, &action.session_id, &action.app_id);
        }
        if let Some(outbound) = &self.outbound_store {
            if let Err(e) = outbound.upsert(
                &action.session_id,
                &self.identity_id,
                &action.envelope_bytes,
                message_hash,
                "sending",
                Some(&action.app_id),
            ) {
                tracing::warn!(target: "games", "failed to persist outbound envelope: {e}");
            } else if let Err(e) =
                outbound.prune_to_cap(&self.identity_id, Some(&action.session_id))
            {
                tracing::warn!(target: "games", "failed to prune outbound store: {e}");
            }
        }
        self.emit_action_result(&action.app_id, &action.session_id, true, None);
        self.emit_update(&action.app_id, &action.session_id, "outbound");
    }

    /// Reverse a `prepare_action` mutation after a failed LXMF send.
    /// Emits `games.action_result` ok:false and `games.update` with rolled-back state.
    pub fn rollback_action(&self, action: PreparedGameAction, error: Option<&str>) {
        if let Err(e) = self.router.rollback_outgoing(
            &action.app_id,
            &action.session_id,
            &self.identity_id,
            action.snapshot,
        ) {
            tracing::warn!(target: "games", "lrgp rollback_outgoing failed: {e}");
        }
        if let Some(outbound) = &self.outbound_store {
            if let Err(e) = outbound.set_delivery_state(
                &action.session_id,
                &self.identity_id,
                "failed",
                None,
                Some(&action.app_id),
            ) {
                tracing::warn!(target: "games", "failed to set delivery_state=failed: {e}");
            }
        }
        let err = error.unwrap_or("send_failed");
        self.emit_action_result(&action.app_id, &action.session_id, false, Some(err));
        self.emit_update(&action.app_id, &action.session_id, "outbound");
    }

    /// Map an LXMF outbound status frame onto the owning game session.
    pub fn apply_outbound_status(
        &self,
        message_hash: &str,
        wire_status: &str,
        delivery_method: Option<&str>,
    ) {
        let Some(mapped) = map_lxmf_wire_to_delivery_state(wire_status, delivery_method) else {
            return;
        };
        let (session_id, app_id) = {
            let from_map = self
                .msg_to_session
                .lock()
                .ok()
                .and_then(|m| m.get(message_hash).cloned());
            if let Some(pair) = from_map {
                pair
            } else if let Some(outbound) = &self.outbound_store {
                match outbound.get_by_message_hash(&self.identity_id, message_hash) {
                    Ok(Some(row)) => {
                        let app = row.app_id.unwrap_or_default();
                        (row.session_id, app)
                    }
                    _ => return,
                }
            } else {
                return;
            }
        };
        if let Some(outbound) = &self.outbound_store {
            if let Err(e) = outbound.set_delivery_state(
                &session_id,
                &self.identity_id,
                mapped,
                Some(message_hash),
                if app_id.is_empty() {
                    None
                } else {
                    Some(app_id.as_str())
                },
            ) {
                tracing::warn!(target: "games", "failed to update delivery_state: {e}");
            }
        }
        let app = if app_id.is_empty() { "ttt" } else { &app_id };
        self.emit_update(app, &session_id, "outbound");
    }

    /// Insert `message_hash → (session_id, app_id)` and evict oldest entries past the cap.
    fn insert_msg_to_session(&self, hash: &str, session_id: &str, app_id: &str) {
        if let Ok(mut map) = self.msg_to_session.lock() {
            map.insert(
                hash.to_string(),
                (session_id.to_string(), app_id.to_string()),
            );
            while map.len() > MAX_LAST_ENVELOPES {
                let victim = map.keys().find(|k| k.as_str() != hash).cloned();
                match victim {
                    Some(k) => {
                        map.remove(&k);
                    }
                    None => break,
                }
            }
        }
    }

    /// After a successful resend, re-bind message_hash and set delivery_state=sending.
    pub fn note_resend_enqueued(&self, session_id: &str, app_id: &str, message_hash: Option<&str>) {
        if let Some(hash) = message_hash {
            self.insert_msg_to_session(hash, session_id, app_id);
        }
        if let Some(outbound) = &self.outbound_store {
            let envelope = self
                .last_envelope
                .lock()
                .ok()
                .and_then(|c| c.get(session_id).cloned())
                .or_else(|| {
                    outbound
                        .get(session_id, &self.identity_id)
                        .ok()
                        .flatten()
                        .map(|r| r.envelope)
                });
            if let Some(bytes) = envelope {
                if bytes.is_empty() {
                    let _ = outbound.set_delivery_state(
                        session_id,
                        &self.identity_id,
                        "sending",
                        message_hash,
                        Some(app_id),
                    );
                } else {
                    let _ = outbound.upsert(
                        session_id,
                        &self.identity_id,
                        &bytes,
                        message_hash,
                        "sending",
                        Some(app_id),
                    );
                }
            }
        }
        self.emit_update(app_id, session_id, "outbound");
    }

    pub fn emit_action_result(
        &self,
        app_id: &str,
        session_id: &str,
        ok: bool,
        error: Option<&str>,
    ) {
        let mut payload =
            serde_json::json!({ "app_id": app_id, "session_id": session_id, "ok": ok });
        if let Some(err) = error {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("error".into(), serde_json::json!(err));
            }
        }
        self.emit("games.action_result", &payload);
    }

    fn emit_update(&self, app_id: &str, session_id: &str, direction: &str) {
        let detail = self.session_detail(session_id);
        let payload = serde_json::json!({
            "app_id": app_id,
            "session_id": session_id,
            "direction": direction,
            "session": detail.get("session").cloned().unwrap_or(JsonValue::Null),
        });
        self.emit("games.update", &payload);
    }

    fn emit(&self, event_type: &str, payload: &JsonValue) {
        let frame = serde_json::json!({ "type": event_type, "payload": payload });
        let _ = self.event_tx.send(frame.to_string());
    }

    /// Schedule SQLite persist off the LXMF delivery callback so it does not
    /// run while `deliver_unpacked_lxmf` holds `router.lock()`.
    fn schedule_persist_session(&self, app_id: &str, session_id: &str) {
        if session_id.is_empty() || self.store.is_none() {
            return;
        }
        let store = match &self.store {
            Some(s) => Arc::clone(s),
            None => return,
        };
        let router = Arc::clone(&self.router);
        let identity_id = self.identity_id.clone();
        let app_id = app_id.to_string();
        let session_id = session_id.to_string();
        let persist = move || {
            persist_session_from_parts(&router, &store, &identity_id, &app_id, &session_id);
        };
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn_blocking(persist);
            }
            Err(_) => {
                // Unit tests may call handle_inbound_lxmf outside a Tokio runtime.
                persist();
            }
        }
    }

    fn persist_session_from_state(&self, app_id: &str, session_id: &str) {
        let Some(store) = &self.store else {
            return;
        };
        persist_session_from_parts(&self.router, store, &self.identity_id, app_id, session_id);
    }
}

fn persist_session_from_parts(
    router: &LrgpRouter,
    store: &LrgpStore,
    identity_id: &str,
    app_id: &str,
    session_id: &str,
) {
    if session_id.is_empty() {
        return;
    }
    let Some(state) = router.with_app(app_id, |app| app.get_session_state(session_id, identity_id))
    else {
        return;
    };
    if state.is_empty() {
        return;
    }
    if let Err(e) = save_session_from_state(store, session_id, identity_id, app_id, &state) {
        tracing::warn!(
            target: "games",
            "failed to persist lrgp session {session_id} ({app_id}): {e}"
        );
    }
}

fn generate_session_id() -> String {
    use rand::RngCore;
    let mut buf = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

/// Map LXMF wire status (+ optional delivery_method) to session `delivery_state`.
fn map_lxmf_wire_to_delivery_state(
    wire_status: &str,
    delivery_method: Option<&str>,
) -> Option<&'static str> {
    let propagated = delivery_method == Some("propagated");
    match wire_status {
        "sending" if propagated => Some("propagating"),
        "sending" => Some("sending"),
        "delivered" if propagated => Some("propagated"),
        "delivered" => Some("delivered"),
        "failed" => Some("failed"),
        _ => None,
    }
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

/// Mirrors Ratspeak's `save_session_from_state` — persist the app's own
/// in-memory `get_session_state()` JSON snapshot into the SQLite mirror after
/// every dispatch (inbound or outbound) so list/detail endpoints stay current.
///
/// `LrgpStore::save_session` is insert-only (lrgp 0.4+); existing rows go through
/// the mutable-column allowlist on `update_session`.
fn save_session_from_state(
    store: &LrgpStore,
    session_id: &str,
    identity_id: &str,
    app_id: &str,
    state: &HashMap<String, JsonValue>,
) -> Result<(), String> {
    let app_version = state
        .get("app_version")
        .and_then(JsonValue::as_u64)
        .unwrap_or(1) as u32;
    let contact_hash = state
        .get("contact_hash")
        .and_then(JsonValue::as_str)
        .unwrap_or_default();
    let initiator = state
        .get("initiator")
        .and_then(JsonValue::as_str)
        .unwrap_or_default();
    let status = state
        .get("status")
        .and_then(JsonValue::as_str)
        .unwrap_or("pending");
    let metadata: HashMap<String, JsonValue> = state
        .get("metadata")
        .and_then(JsonValue::as_object)
        .map(|m| m.clone().into_iter().collect())
        .unwrap_or_default();
    let unread = state.get("unread").and_then(JsonValue::as_i64).unwrap_or(0);
    let created_at = state
        .get("created_at")
        .and_then(JsonValue::as_f64)
        .unwrap_or_else(now_secs);
    let updated_at = state
        .get("updated_at")
        .and_then(JsonValue::as_f64)
        .unwrap_or_else(now_secs);
    let last_action_at = state
        .get("last_action_at")
        .and_then(JsonValue::as_f64)
        .unwrap_or_else(now_secs);

    match store
        .get_session(session_id, identity_id)
        .map_err(|e| e.to_string())?
    {
        Some(_) => {
            let meta_json =
                serde_json::to_string(&metadata).map_err(|e| format!("metadata serialize: {e}"))?;
            let mut updates = HashMap::new();
            updates.insert("status".to_string(), status.to_string());
            updates.insert("metadata".to_string(), meta_json);
            updates.insert("unread".to_string(), unread.to_string());
            updates.insert("updated_at".to_string(), updated_at.to_string());
            updates.insert("last_action_at".to_string(), last_action_at.to_string());
            store
                .update_session(session_id, identity_id, &updates)
                .map_err(|e| e.to_string())
        }
        None => store
            .save_session(
                session_id,
                identity_id,
                app_id,
                app_version,
                contact_hash,
                initiator,
                status,
                &metadata,
                unread,
                created_at,
                updated_at,
                last_action_at,
            )
            .map_err(|e| e.to_string()),
    }
}

fn json_to_rmpv(value: &JsonValue) -> rmpv::Value {
    match value {
        JsonValue::Null => rmpv::Value::Nil,
        JsonValue::Bool(b) => rmpv::Value::Boolean(*b),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                rmpv::Value::Integer(i.into())
            } else if let Some(u) = n.as_u64() {
                rmpv::Value::Integer(u.into())
            } else {
                rmpv::Value::F64(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => rmpv::Value::String(s.clone().into()),
        JsonValue::Array(arr) => rmpv::Value::Array(arr.iter().map(json_to_rmpv).collect()),
        JsonValue::Object(map) => rmpv::Value::Map(
            map.iter()
                .map(|(k, v)| (rmpv::Value::String(k.clone().into()), json_to_rmpv(v)))
                .collect(),
        ),
    }
}

/// Convert an HTTP request body's `payload` object into the
/// `HashMap<String, rmpv::Value>` shape `LrgpRouter` expects.
fn json_payload_to_rmpv_map(value: Option<&JsonValue>) -> HashMap<String, rmpv::Value> {
    match value.and_then(JsonValue::as_object) {
        Some(obj) => obj
            .iter()
            .map(|(k, v)| (k.clone(), json_to_rmpv(v)))
            .collect(),
        None => HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lrgp::constants::{CMD_ACCEPT, CMD_CHALLENGE, CMD_RESIGN};

    /// Hold while calling non-challenge `prepare_action`, or while injecting hydrate errors.
    fn hydrate_err_test_guard() -> std::sync::MutexGuard<'static, ()> {
        FORCE_HYDRATE_STORE_READ_ERR_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn test_manager() -> (
        tempfile::TempDir,
        GamesSessionManager,
        broadcast::Sender<String>,
    ) {
        let dir = tempfile::tempdir().expect("tempdir");
        let (event_tx, _rx) = broadcast::channel(16);
        let manager =
            GamesSessionManager::spawn(dir.path(), "selfidentityhash".into(), event_tx.clone());
        (dir, manager, event_tx)
    }

    fn inbound_challenge_fields(session_id: &str) -> BTreeMap<u8, Vec<u8>> {
        let env = envelope::pack_envelope("ttt", 1, CMD_CHALLENGE, session_id, None, None)
            .expect("pack challenge envelope");
        transport::pack_into_preencoded_fields(&env)
            .expect("pack challenge")
            .into_iter()
            .collect()
    }

    #[test]
    fn router_registers_ttt_and_chess() {
        let (_dir, manager, _) = test_manager();
        let apps = manager.router.list_apps();
        let ids: Vec<&str> = apps.iter().map(|m| m.app_id.as_str()).collect();
        assert!(ids.contains(&"ttt"));
        assert!(ids.contains(&"chess"));
        assert!(ids.contains(&"four_in_a_row"));
    }

    #[test]
    fn pack_extract_roundtrip_via_transport() {
        let env = envelope::pack_envelope("ttt", 1, "challenge", "abcdef0123456789", None, None)
            .expect("pack envelope");
        let fields = transport::pack_into_preencoded_fields(&env).expect("pack");
        let recovered = transport::extract_envelope(&fields)
            .expect("extract")
            .expect("some");
        assert_eq!(
            envelope::value_as_str(recovered.get(KEY_COMMAND).unwrap()).unwrap(),
            "challenge"
        );
    }

    #[test]
    fn prepare_action_unknown_session_without_store_row() {
        let (_dir, manager, _) = test_manager();
        let dest = "a".repeat(32);
        let _guard = hydrate_err_test_guard();
        let err = manager
            .prepare_action(&dest, "ttt", CMD_MOVE, Some("sess1"), None)
            .expect_err("expected unknown session");
        assert_eq!(err, "unknown_session");
    }

    #[test]
    fn prepare_action_propagates_store_read_failure() {
        let (_dir, manager, _) = test_manager();
        let dest = "a".repeat(32);
        let _guard = hydrate_err_test_guard();
        FORCE_HYDRATE_STORE_READ_ERR.store(true, Ordering::SeqCst);
        let err = manager
            .prepare_action(&dest, "ttt", CMD_MOVE, Some("sess-store-fail"), None)
            .expect_err("expected store read failure");
        FORCE_HYDRATE_STORE_READ_ERR.store(false, Ordering::SeqCst);
        assert!(
            err.starts_with("store_read_failed:"),
            "expected store_read_failed prefix, got {err}"
        );
        // Manager remains usable for challenges that do not require hydrate.
        let challenge = manager
            .prepare_action(&dest, "ttt", CMD_CHALLENGE, None, None)
            .expect("challenge still works without hydrate");
        assert!(!challenge.session_id.is_empty());
    }

    #[test]
    fn local_reject_maps_invalid_move_on_empty_payload() {
        let (_dir, manager, _) = test_manager();
        let dest = "a".repeat(32);
        let session_id = "cccccccccccccccc";
        assert!(manager.handle_inbound_lxmf(&inbound_challenge_fields(session_id), &dest, ""));
        let _guard = hydrate_err_test_guard();
        let err = manager
            .prepare_action(&dest, "ttt", CMD_MOVE, Some(session_id), None)
            .expect_err("expected local reject");
        assert_eq!(err, ERR_INVALID_MOVE);
    }

    #[test]
    fn accept_after_store_rehydrate_activates_pending_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        let identity = "selfidentityhash";
        let peer = "c".repeat(32);
        let session_id = "aaaaaaaaaaaaaaaa";
        let (event_tx, _rx) = broadcast::channel(16);

        {
            let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx.clone());
            assert!(manager.handle_inbound_lxmf(&inbound_challenge_fields(session_id), &peer, ""));
            let listed = manager.list_sessions(None);
            assert_eq!(listed["sessions"][0]["status"], "pending");
        }

        // Fresh manager: empty LrgpRouter memory, same SQLite file — spawn hydrates.
        let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx);
        let _guard = hydrate_err_test_guard();
        let action = manager
            .prepare_action(&peer, "ttt", CMD_ACCEPT, Some(session_id), None)
            .expect("accept should work after SQLite hydrate");
        manager.commit_action(&action, Some("testhash1"));

        let detail = manager.session_detail(session_id);
        assert_eq!(detail["session"]["status"], "active");
    }

    #[test]
    fn local_reject_maps_not_your_turn() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (event_tx, _rx) = broadcast::channel(16);
        // prepare_action requires 32-hex dest hashes; use the same shape for identity ids.
        let self_id = "a".repeat(32);
        let peer = "b".repeat(32);
        let manager = GamesSessionManager::spawn(dir.path(), self_id.clone(), event_tx.clone());
        let peer_manager =
            GamesSessionManager::spawn(&dir.path().join("peer"), peer.clone(), event_tx);

        let challenge = manager
            .prepare_action(&peer, "ttt", CMD_CHALLENGE, None, None)
            .expect("challenge prepared");
        let sid = challenge.session_id.clone();
        let challenge_fields: BTreeMap<u8, Vec<u8>> =
            challenge.fields.clone().into_iter().collect();
        manager.commit_action(&challenge, Some("testhash2"));

        assert!(peer_manager.handle_inbound_lxmf(&challenge_fields, &self_id, ""));
        let accept = peer_manager
            .prepare_action(&self_id, "ttt", CMD_ACCEPT, Some(&sid), None)
            .expect("peer accept");
        let accept_fields: BTreeMap<u8, Vec<u8>> = accept.fields.clone().into_iter().collect();
        assert!(manager.handle_inbound_lxmf(&accept_fields, &peer, ""));

        let _guard = hydrate_err_test_guard();
        // Coin-flip first turn: hand off if we own it, then assert a single not-your-turn.
        let detail = manager.session_detail(&sid);
        let turn = detail["session"]["metadata"]["turn"].as_str().unwrap_or("");
        if turn == self_id {
            let action = manager
                .prepare_action(
                    &peer,
                    "ttt",
                    CMD_MOVE,
                    Some(&sid),
                    Some(&serde_json::json!({ "i": 0 })),
                )
                .expect("own-turn move should prepare");
            manager.commit_action(&action, Some("move1"));
        }
        let err = manager
            .prepare_action(
                &peer,
                "ttt",
                CMD_MOVE,
                Some(&sid),
                Some(&serde_json::json!({ "i": 1 })),
            )
            .expect_err("expected not_your_turn when peer owns the turn");
        assert_eq!(err, ERR_NOT_YOUR_TURN);
    }

    #[test]
    fn handle_inbound_for_non_lrgp_returns_false() {
        let (_dir, manager, _) = test_manager();
        let fields: BTreeMap<u8, Vec<u8>> = BTreeMap::new();
        assert!(!manager.handle_inbound_lxmf(&fields, "peer", "hello"));
    }

    #[test]
    fn status_reports_enabled_when_store_opens() {
        let (_dir, manager, _) = test_manager();
        let status = manager.status();
        assert_eq!(status["available"], true);
        assert_eq!(status["enabled"], true);
    }

    #[test]
    fn list_apps_includes_builtin_games() {
        let (_dir, manager, _) = test_manager();
        let apps = manager.list_apps();
        let ids: Vec<String> = apps["apps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["app_id"].as_str().unwrap_or_default().to_string())
            .collect();
        assert!(ids.contains(&"ttt".to_string()));
        assert!(ids.contains(&"chess".to_string()));
        assert!(ids.contains(&"four_in_a_row".to_string()));
    }

    #[test]
    fn commit_persists_envelope_across_restart() {
        let dir = tempfile::tempdir().expect("tempdir");
        let identity = "selfidentityhash";
        let peer = "d".repeat(32);
        let session_id = "bbbbbbbbbbbbbbbb";
        let (event_tx, _rx) = broadcast::channel(16);
        {
            let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx.clone());
            assert!(manager.handle_inbound_lxmf(&inbound_challenge_fields(session_id), &peer, ""));
            let _guard = hydrate_err_test_guard();
            let accept = manager
                .prepare_action(&peer, "ttt", CMD_ACCEPT, Some(session_id), None)
                .expect("accept");
            manager.commit_action(&accept, Some("mh-restart"));
            manager
                .prepare_resend(session_id)
                .expect("resend in-process");
        }
        let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx);
        manager
            .prepare_resend(session_id)
            .expect("resend after restart");
        let detail = manager.session_detail(session_id);
        assert_eq!(detail["session"]["delivery_state"], "sending");
    }

    #[test]
    fn expired_session_action_returns_session_expired_and_persists_status() {
        let dir = tempfile::tempdir().expect("tempdir");
        let identity = "selfidentityhash";
        let peer = "f".repeat(32);
        let session_id = "eeeeeeeeeeeeeeee";
        let (event_tx, _rx) = broadcast::channel(16);

        // Establish an active session, then age it past the idle TTL in SQLite.
        {
            let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx.clone());
            assert!(manager.handle_inbound_lxmf(&inbound_challenge_fields(session_id), &peer, ""));
            let _guard = hydrate_err_test_guard();
            let accept = manager
                .prepare_action(&peer, "ttt", CMD_ACCEPT, Some(session_id), None)
                .expect("accept");
            manager.commit_action(&accept, Some("mh-expire"));
            assert_eq!(
                manager.session_detail(session_id)["session"]["status"],
                "active"
            );
            let mut aged = HashMap::new();
            aged.insert("last_action_at".to_string(), "0".to_string());
            manager
                .store
                .as_ref()
                .expect("store")
                .update_session(session_id, identity, &aged)
                .expect("age session");
        }

        // Fresh manager rehydrates the aged row; the app now reports it expired.
        let manager = GamesSessionManager::spawn(dir.path(), identity.into(), event_tx);
        let _guard = hydrate_err_test_guard();
        let err = manager
            .prepare_action(&peer, "ttt", CMD_RESIGN, Some(session_id), None)
            .expect_err("expired session must reject the action");
        assert_eq!(err, ERR_SESSION_EXPIRED);
        // The stored status is flipped to a terminal value so the UI can remove it.
        assert_eq!(
            manager.session_detail(session_id)["session"]["status"],
            "expired"
        );
    }

    #[test]
    fn delete_session_clears_outbound_envelope() {
        let (_dir, manager, _) = test_manager();
        let dest = "e".repeat(32);
        let challenge = manager
            .prepare_action(&dest, "ttt", CMD_CHALLENGE, None, None)
            .expect("challenge");
        let sid = challenge.session_id.clone();
        manager.commit_action(&challenge, Some("mh-del"));
        manager.delete_session(&sid).expect("delete");
        let err = manager.prepare_resend(&sid).expect_err("no envelope");
        assert_eq!(err, "no_previous_action");
    }

    #[test]
    fn apply_outbound_status_maps_propagating_and_failed() {
        let (_dir, manager, _) = test_manager();
        let dest = "f".repeat(32);
        let challenge = manager
            .prepare_action(&dest, "ttt", CMD_CHALLENGE, None, None)
            .expect("challenge");
        let sid = challenge.session_id.clone();
        manager.commit_action(&challenge, Some("mh-status"));
        manager.apply_outbound_status("mh-status", "sending", Some("propagated"));
        assert_eq!(
            manager.session_detail(&sid)["session"]["delivery_state"],
            "propagating"
        );
        manager.apply_outbound_status("mh-status", "delivered", Some("propagated"));
        assert_eq!(
            manager.session_detail(&sid)["session"]["delivery_state"],
            "propagated"
        );
        manager.apply_outbound_status("mh-status", "failed", None);
        assert_eq!(
            manager.session_detail(&sid)["session"]["delivery_state"],
            "failed"
        );
    }

    #[test]
    fn rollback_emits_action_result_false() {
        let (_dir, manager, event_tx) = test_manager();
        let mut rx = event_tx.subscribe();
        let dest = "a".repeat(32);
        let action = manager
            .prepare_action(&dest, "ttt", CMD_CHALLENGE, None, None)
            .expect("challenge");
        let sid = action.session_id.clone();
        manager.rollback_action(action, Some("send_failed"));
        let frame = rx.try_recv().expect("action_result frame");
        let v: JsonValue = serde_json::from_str(&frame).expect("json");
        assert_eq!(v["type"], "games.action_result");
        assert_eq!(v["payload"]["ok"], false);
        assert_eq!(v["payload"]["session_id"], sid);
        assert_eq!(v["payload"]["error"], "send_failed");
    }

    #[test]
    fn map_wire_status_helpers() {
        assert_eq!(
            map_lxmf_wire_to_delivery_state("sending", None),
            Some("sending")
        );
        assert_eq!(
            map_lxmf_wire_to_delivery_state("sending", Some("propagated")),
            Some("propagating")
        );
        assert_eq!(
            map_lxmf_wire_to_delivery_state("delivered", Some("propagated")),
            Some("propagated")
        );
        assert_eq!(
            map_lxmf_wire_to_delivery_state("delivered", None),
            Some("delivered")
        );
        assert_eq!(
            map_lxmf_wire_to_delivery_state("failed", None),
            Some("failed")
        );
        assert_eq!(map_lxmf_wire_to_delivery_state("unknown", None), None);
    }
}
