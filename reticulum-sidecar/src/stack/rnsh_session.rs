//! rnsh (remote shell) client sessions over Reticulum Links.
//!
//! One session = one `rnsh_client_execute` call driving a persistent Link to
//! a remote `rnsh` listener, run on a dedicated OS thread via
//! [`super::link_task`] (its future is not `Send`). Unlike RRC (a single
//! long-lived control Link per hub), each rnsh session is a standalone
//! interactive/one-shot command run; sessions are tracked only long enough
//! to route input/resize/output and to report the terminal status
//! (`closed` / `error`) once.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use rns_identity::identity::Identity;
use rns_runtime::rnsh::{RnshClientConfig, RnshError, RnshWindowSize, rnsh_client_execute};
use rns_transport::messages::TransportMessage;
use serde_json::json;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use uuid::Uuid;

use super::link_task::spawn_link_task;
use super::live::parse_hash16;

/// Soft cap on concurrently tracked rnsh sessions (active + not-yet-pruned
/// terminal sessions). Finished sessions are pruned opportunistically on the
/// next `connect()` so a burst of short-lived sessions cannot starve the cap.
const MAX_RNSH_SESSIONS: usize = 8;
/// Interactive sessions have no natural end; bound the underlying Link so a
/// forgotten/never-disconnected session cannot run forever.
const RNSH_SESSION_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const RNSH_TERM: &str = "xterm-256color";
const DEFAULT_ROWS: u32 = 24;
const DEFAULT_COLS: u32 = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RnshSessionStatus {
    Connecting,
    Active,
    Closed,
    Error,
}

impl RnshSessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Active => "active",
            Self::Closed => "closed",
            Self::Error => "error",
        }
    }
}

struct RnshSessionInner {
    status: RnshSessionStatus,
    destination_hash: String,
    last_error: Option<String>,
    return_code: Option<i64>,
}

/// Per-session control handles. `stdin_tx` / `window_tx` feed the running
/// `rnsh_client_execute` call; dropping `stdin_tx` signals stdin EOF.
/// `rnsh_client_execute` itself runs on a dedicated OS thread (its future is
/// not `Send` — see [`super::link_task`]), so cancellation goes through
/// `cancel_tx` rather than aborting a `tokio::task::JoinHandle`.
struct RnshSessionHandle {
    inner: Arc<Mutex<RnshSessionInner>>,
    stdin_tx: Option<mpsc::Sender<Vec<u8>>>,
    window_tx: mpsc::Sender<RnshWindowSize>,
    cancel_tx: Option<oneshot::Sender<()>>,
    thread: std::thread::JoinHandle<()>,
}

struct ManagerShared {
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    sessions: Mutex<HashMap<String, RnshSessionHandle>>,
}

pub struct RnshSessionManager {
    shared: Arc<ManagerShared>,
}

impl RnshSessionManager {
    pub fn spawn(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: Identity,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            shared: Arc::new(ManagerShared {
                transport_tx,
                identity,
                event_tx,
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Starts a new rnsh session against `destination_hash_hex`. Returns
    /// `{session_id, identity_hash}` on success — `identity_hash` mirrors the
    /// destination hash used to reach the remote listener (the exact remote
    /// identity is only confirmed mid-handshake by `rnsh_client_execute`,
    /// which does not surface it separately from the destination it dials).
    pub async fn connect(&self, destination_hash_hex: &str) -> Result<serde_json::Value, String> {
        let dest_hash = parse_hash16(destination_hash_hex)?;
        let clean_hex = destination_hash_hex.trim().to_lowercase();

        let mut sessions = self.shared.sessions.lock().await;
        prune_finished_sessions(&mut sessions);
        if sessions.len() >= MAX_RNSH_SESSIONS {
            return Err(format!(
                "max_sessions: maximum of {MAX_RNSH_SESSIONS} concurrent rnsh sessions"
            ));
        }

        let session_id = Uuid::new_v4().to_string();
        let inner = Arc::new(Mutex::new(RnshSessionInner {
            status: RnshSessionStatus::Connecting,
            destination_hash: clean_hex.clone(),
            last_error: None,
            return_code: None,
        }));

        let (stdin_tx, stdin_rx) = mpsc::channel::<Vec<u8>>(64);
        let (window_tx, window_rx) = mpsc::channel::<RnshWindowSize>(8);
        let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>(64);
        let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>(64);

        spawn_stream_forwarder(
            self.shared.event_tx.clone(),
            session_id.clone(),
            "rnsh.stdout",
            stdout_rx,
        );
        spawn_stream_forwarder(
            self.shared.event_tx.clone(),
            session_id.clone(),
            "rnsh.stderr",
            stderr_rx,
        );

        let cfg = RnshClientConfig {
            identity: self.shared.identity.clone(),
            destination_hash: dest_hash,
            // Empty remote command lets the listener fall back to its own
            // configured default shell.
            command: Vec::new(),
            no_id: false,
            timeout: RNSH_SESSION_TIMEOUT,
            stdin_data: Vec::new(),
            stdin_rx: Some(stdin_rx),
            stdout_tx: Some(stdout_tx),
            stderr_tx: Some(stderr_tx),
            window_rx: Some(window_rx),
            // All three false → listener allocates a PTY, matching an
            // interactive terminal session (resize / TERM are meaningful).
            pipe_stdin: false,
            pipe_stdout: false,
            pipe_stderr: false,
            term: Some(RNSH_TERM.to_string()),
            rows: Some(DEFAULT_ROWS),
            cols: Some(DEFAULT_COLS),
            hpix: None,
            vpix: None,
        };

        let transport_tx = self.shared.transport_tx.clone();
        let event_tx = self.shared.event_tx.clone();
        let inner_for_task = inner.clone();
        let session_id_for_task = session_id.clone();

        // `rnsh_client_execute`'s future is not `Send` (it holds a `Link`
        // reference across internal await points), so it must be both
        // built and driven on the dedicated thread `spawn_link_task` gives
        // us — nothing non-`Send` crosses the thread boundary here, only the
        // owned/`Send` inputs captured by the closure do.
        let (thread, cancel_tx) =
            spawn_link_task(format!("rnsh-{session_id}"), move || async move {
                let result = rnsh_client_execute(transport_tx, cfg).await;
                match result {
                    Ok(outcome) => {
                        {
                            let mut g = inner_for_task.lock().await;
                            g.status = RnshSessionStatus::Closed;
                            g.return_code = Some(outcome.return_code);
                        }
                        emit(
                            &event_tx,
                            "rnsh.closed",
                            json!({
                                "session_id": session_id_for_task,
                                "return_code": outcome.return_code,
                            }),
                        );
                    }
                    Err(e) => {
                        let (reason_key, message) = map_rnsh_error(&e);
                        {
                            let mut g = inner_for_task.lock().await;
                            g.status = RnshSessionStatus::Error;
                            g.last_error = Some(message.clone());
                        }
                        emit(
                            &event_tx,
                            "rnsh.error",
                            json!({
                                "session_id": session_id_for_task,
                                "reason_key": reason_key,
                                "message": message,
                            }),
                        );
                    }
                }
            })
            .map_err(|e| format!("failed to start rnsh session thread: {e}"))?;

        {
            let mut g = inner.lock().await;
            g.status = RnshSessionStatus::Active;
        }
        emit(
            &self.shared.event_tx,
            "rnsh.status",
            json!({
                "session_id": session_id,
                "status": "active",
                "destination_hash": clean_hex,
            }),
        );

        sessions.insert(
            session_id.clone(),
            RnshSessionHandle {
                inner,
                stdin_tx: Some(stdin_tx),
                window_tx,
                cancel_tx: Some(cancel_tx),
                thread,
            },
        );

        Ok(json!({
            "session_id": session_id,
            "identity_hash": clean_hex,
        }))
    }

    pub async fn input(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        let mut sessions = self.shared.sessions.lock().await;
        let handle = sessions
            .get_mut(session_id)
            .ok_or_else(|| "no active rnsh session".to_string())?;
        let Some(stdin_tx) = handle.stdin_tx.as_ref() else {
            return Err("rnsh session stdin already closed".into());
        };
        stdin_tx
            .send(data)
            .await
            .map_err(|_| "rnsh session stdin closed".to_string())
    }

    pub async fn resize(
        &self,
        session_id: &str,
        rows: Option<u32>,
        cols: Option<u32>,
    ) -> Result<(), String> {
        let sessions = self.shared.sessions.lock().await;
        let handle = sessions
            .get(session_id)
            .ok_or_else(|| "no active rnsh session".to_string())?;
        handle
            .window_tx
            .send(RnshWindowSize {
                rows,
                cols,
                hpix: None,
                vpix: None,
            })
            .await
            .map_err(|_| "rnsh session window closed".to_string())
    }

    /// Best-effort cancel: signals the driving thread's `rnsh_client_execute`
    /// call to stop via `cancel_tx` and drops the stdin sender.
    /// `rnsh_client_execute` may still be mid-await on transport I/O when
    /// cancelled, so upstream Link/destination cleanup (deregistration, link
    /// teardown) is not guaranteed to run to completion.
    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.shared.sessions.lock().await;
        let Some(mut handle) = sessions.remove(session_id) else {
            return Err("no active rnsh session".to_string());
        };
        if let Some(cancel_tx) = handle.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }
        handle.stdin_tx.take();
        {
            let mut g = handle.inner.lock().await;
            g.status = RnshSessionStatus::Closed;
        }
        emit(
            &self.shared.event_tx,
            "rnsh.closed",
            json!({
                "session_id": session_id,
                "reason_key": "cancelled",
            }),
        );
        Ok(())
    }

    pub async fn status_snapshot(&self) -> serde_json::Value {
        let sessions = self.shared.sessions.lock().await;
        let mut rows = Vec::with_capacity(sessions.len());
        for (id, handle) in sessions.iter() {
            let g = handle.inner.lock().await;
            rows.push(json!({
                "session_id": id,
                "status": g.status.as_str(),
                "destination_hash": g.destination_hash,
                "return_code": g.return_code,
                "error": g.last_error,
            }));
        }
        json!({ "sessions": rows })
    }
}

/// Removes sessions whose driving thread has already finished, freeing their
/// `MAX_RNSH_SESSIONS` slot. Terminal status is reported via the `rnsh.closed`
/// / `rnsh.error` events already emitted when the thread completed, so pruning
/// here does not lose information the client needs.
fn prune_finished_sessions(sessions: &mut HashMap<String, RnshSessionHandle>) {
    let finished: Vec<String> = sessions
        .iter()
        .filter(|(_, handle)| handle.thread.is_finished())
        .map(|(id, _)| id.clone())
        .collect();
    for id in finished {
        sessions.remove(&id);
    }
}

fn spawn_stream_forwarder(
    event_tx: broadcast::Sender<String>,
    session_id: String,
    event_type: &'static str,
    mut rx: mpsc::Receiver<Vec<u8>>,
) {
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            if chunk.is_empty() {
                continue;
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(&chunk);
            emit(
                &event_tx,
                event_type,
                json!({
                    "session_id": session_id,
                    "data": encoded,
                }),
            );
        }
    });
}

fn map_rnsh_error(err: &RnshError) -> (&'static str, String) {
    let message = err.to_string();
    let reason_key = match err {
        RnshError::NoIdentity => "not_announced",
        RnshError::PathTimeout | RnshError::Timeout(_) => "timeout",
        RnshError::Denied => "not_allowed",
        RnshError::Remote(msg) if msg.to_ascii_lowercase().contains("incompatible") => {
            "version_mismatch"
        }
        _ => "error",
    };
    (reason_key, message)
}

#[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
fn emit(event_tx: &broadcast::Sender<String>, event_type: &str, payload: serde_json::Value) {
    let frame = json!({ "type": event_type, "payload": payload });
    let _ = event_tx.send(frame.to_string());
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    const TEST_DEST: &str = "aabbccddeeff00112233445566778899";

    fn test_manager() -> (RnshSessionManager, broadcast::Receiver<String>) {
        // Dropping the transport receiver makes rnsh_client_execute fail fast
        // with TransportUnavailable on its first send.
        let (transport_tx, transport_rx) = mpsc::channel::<TransportMessage>(8);
        drop(transport_rx);
        let (event_tx, event_rx) = broadcast::channel::<String>(64);
        (
            RnshSessionManager::spawn(transport_tx, Identity::new(), event_tx),
            event_rx,
        )
    }

    async fn recv_event_of_type(
        rx: &mut broadcast::Receiver<String>,
        event_type: &str,
    ) -> serde_json::Value {
        loop {
            let frame = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("event before timeout")
                .expect("event channel open");
            let parsed: serde_json::Value = serde_json::from_str(&frame).expect("valid frame");
            if parsed["type"] == event_type {
                return parsed["payload"].clone();
            }
        }
    }

    /// Collects the first payload of each requested type, in any arrival
    /// order — the link-task thread races connect()'s own status emit, so
    /// `rnsh.error` may land before `rnsh.status`.
    async fn recv_events_of_types(
        rx: &mut broadcast::Receiver<String>,
        event_types: &[&str],
    ) -> HashMap<String, serde_json::Value> {
        let mut found: HashMap<String, serde_json::Value> = HashMap::new();
        while found.len() < event_types.len() {
            let frame = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("events before timeout")
                .expect("event channel open");
            let parsed: serde_json::Value = serde_json::from_str(&frame).expect("valid frame");
            let frame_type = parsed["type"].as_str().unwrap_or_default().to_string();
            if event_types.contains(&frame_type.as_str()) {
                found
                    .entry(frame_type)
                    .or_insert_with(|| parsed["payload"].clone());
            }
        }
        found
    }

    #[test]
    fn status_as_str_covers_all_variants() {
        assert_eq!(RnshSessionStatus::Connecting.as_str(), "connecting");
        assert_eq!(RnshSessionStatus::Active.as_str(), "active");
        assert_eq!(RnshSessionStatus::Closed.as_str(), "closed");
        assert_eq!(RnshSessionStatus::Error.as_str(), "error");
    }

    #[test]
    fn map_rnsh_error_reason_keys() {
        assert_eq!(map_rnsh_error(&RnshError::NoIdentity).0, "not_announced");
        assert_eq!(map_rnsh_error(&RnshError::PathTimeout).0, "timeout");
        assert_eq!(map_rnsh_error(&RnshError::Timeout("link")).0, "timeout");
        assert_eq!(map_rnsh_error(&RnshError::Denied).0, "not_allowed");
        assert_eq!(
            map_rnsh_error(&RnshError::Remote("Incompatible protocol version".into())).0,
            "version_mismatch"
        );
        let (key, message) = map_rnsh_error(&RnshError::Remote("boom".into()));
        assert_eq!(key, "error");
        assert!(message.contains("boom"));
        assert_eq!(map_rnsh_error(&RnshError::TransportUnavailable).0, "error");
    }

    #[tokio::test]
    async fn connect_rejects_invalid_destination_hash() {
        let (manager, _rx) = test_manager();
        assert!(manager.connect("nope").await.is_err());
        assert!(manager.connect("aabb").await.is_err());
    }

    #[tokio::test]
    async fn connect_tracks_session_and_reports_error_on_dead_transport() {
        let (manager, mut rx) = test_manager();
        let result = manager.connect(TEST_DEST).await.expect("session starts");
        let session_id = result["session_id"].as_str().expect("id").to_string();
        assert_eq!(result["identity_hash"], TEST_DEST);

        // Transport receiver is dropped, so the driving thread fails fast —
        // possibly before connect() emits rnsh.status. Accept either order.
        let events = recv_events_of_types(&mut rx, &["rnsh.status", "rnsh.error"]).await;
        let status = &events["rnsh.status"];
        assert_eq!(status["status"], "active");
        assert_eq!(status["destination_hash"], TEST_DEST);
        let error = &events["rnsh.error"];
        assert_eq!(error["session_id"], session_id);
        assert_eq!(error["reason_key"], "error");

        let snapshot = manager.status_snapshot().await;
        let rows = snapshot["sessions"].as_array().expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["session_id"], session_id);
    }

    #[tokio::test]
    async fn input_and_resize_reject_unknown_session() {
        let (manager, _rx) = test_manager();
        assert!(manager.input("missing", vec![1, 2, 3]).await.is_err());
        assert!(manager.resize("missing", Some(30), Some(90)).await.is_err());
        assert!(manager.disconnect("missing").await.is_err());
    }

    #[tokio::test]
    async fn disconnect_emits_closed_and_removes_session() {
        let (manager, mut rx) = test_manager();
        let result = manager.connect(TEST_DEST).await.expect("session starts");
        let session_id = result["session_id"].as_str().expect("id").to_string();

        manager.disconnect(&session_id).await.expect("disconnect");
        let closed = recv_event_of_type(&mut rx, "rnsh.closed").await;
        assert_eq!(closed["session_id"], session_id);
        assert_eq!(closed["reason_key"], "cancelled");

        let snapshot = manager.status_snapshot().await;
        assert_eq!(snapshot["sessions"].as_array().expect("rows").len(), 0);
        assert!(manager.input(&session_id, vec![0]).await.is_err());
    }

    #[tokio::test]
    async fn prune_finished_sessions_drops_only_finished_threads() {
        let inner = || {
            Arc::new(Mutex::new(RnshSessionInner {
                status: RnshSessionStatus::Active,
                destination_hash: TEST_DEST.to_string(),
                last_error: None,
                return_code: None,
            }))
        };
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let running_thread = std::thread::spawn(move || {
            let _ = release_rx.recv_timeout(Duration::from_secs(10));
        });
        let finished_thread = std::thread::spawn(|| {});
        while !finished_thread.is_finished() {
            std::thread::sleep(Duration::from_millis(5));
        }

        let make_handle = |thread: std::thread::JoinHandle<()>| RnshSessionHandle {
            inner: inner(),
            stdin_tx: Some(mpsc::channel::<Vec<u8>>(1).0),
            window_tx: mpsc::channel::<RnshWindowSize>(1).0,
            cancel_tx: Some(oneshot::channel::<()>().0),
            thread,
        };
        let mut sessions = HashMap::new();
        sessions.insert("finished".to_string(), make_handle(finished_thread));
        sessions.insert("running".to_string(), make_handle(running_thread));

        prune_finished_sessions(&mut sessions);
        assert!(!sessions.contains_key("finished"));
        assert!(sessions.contains_key("running"));
        release_tx.send(()).expect("release running thread");
    }

    #[tokio::test]
    async fn stream_forwarder_encodes_chunks_and_skips_empty() {
        let (event_tx, mut event_rx) = broadcast::channel::<String>(16);
        let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>(8);
        spawn_stream_forwarder(event_tx, "sess-1".to_string(), "rnsh.stdout", chunk_rx);

        chunk_tx.send(Vec::new()).await.expect("empty chunk");
        chunk_tx.send(vec![104, 105]).await.expect("hi chunk");
        let payload = recv_event_of_type(&mut event_rx, "rnsh.stdout").await;
        assert_eq!(payload["session_id"], "sess-1");
        assert_eq!(
            payload["data"],
            base64::engine::general_purpose::STANDARD.encode("hi")
        );
    }
}
