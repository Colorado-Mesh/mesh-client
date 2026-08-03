//! LXST voice telephony via rsLXST `TelephonyService`.
//!
//! Registers `lxst.telephony`, bridges control/events to HTTP + WS, and accepts
//! renderer-owned PCM frames (Opus encode/decode stays inside rsLXST).

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use base64::Engine as _;
use lxst_core::{CallRole, Profile, RawAudioFrame, SignallingStatus};
use lxst_telephony::{
    IdentityHash, TelephonyControl, TelephonyService, TelephonyServiceEvent, TelephonyServiceParts,
};
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use serde_json::json;
use tokio::sync::{RwLock, broadcast, mpsc};

use super::live::parse_hash16;

/// Ratspeak-compatible default profile for outbound calls.
const DEFAULT_CALL_PROFILE: Profile = Profile::QualityHigh;
const DEFAULT_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);

/// QualityHigh frame duration in ms (2880 samples @ 48 kHz).
const QUALITY_HIGH_FRAME_MS: u64 = 60;

#[derive(Debug, Clone, Copy, Default)]
pub struct VoiceMediaCounters {
    pub tx_frames: u64,
    pub tx_packets: u64,
    pub rx_frames: u64,
    pub local_tx_drops: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VoiceAuditLogPhase {
    None,
    StartLogged,
    OutcomeLogged,
    EndLogged,
}

#[derive(Debug, Clone)]
pub struct VoiceAuditSession {
    pub role: &'static str,
    pub remote_hex: String,
    pub link_id_hex: Option<String>,
    pub started_at: Instant,
    pub established_at: Option<Instant>,
    pub ever_established: bool,
    log_phase: VoiceAuditLogPhase,
}

#[derive(Default)]
struct VoiceState {
    running: bool,
    microphone_muted: bool,
    active_call: Option<serde_json::Value>,
    last_error: Option<String>,
    /// Maps LXMF / peer destination hashes → identity hashes (from announce cache).
    dest_to_identity: HashMap<String, String>,
    media: VoiceMediaCounters,
    audit: Option<VoiceAuditSession>,
}

/// Bound dest→identity cache independently of the live path table (same cap as display names).
const MAX_DEST_TO_IDENTITY_CACHE: usize = 100_000;

/// High-rate PCM frames — keep off the shared `/ws` event bus (same intent as packet tap).
const VOICE_AUDIO_BROADCAST_CAP: usize = 256;

/// Insert or refresh a dest→identity mapping; evict an arbitrary entry when full.
fn insert_dest_identity_bounded(cache: &mut HashMap<String, String>, dest: String, id: String) {
    if cache.len() >= MAX_DEST_TO_IDENTITY_CACHE && !cache.contains_key(&dest) {
        if let Some(evict) = cache.keys().next().cloned() {
            cache.remove(&evict);
        }
    }
    cache.insert(dest, id);
}

struct ManagerShared {
    control_tx: Option<mpsc::Sender<TelephonyControl>>,
    event_tx: broadcast::Sender<String>,
    /// Dedicated bus for `voice.audio` PCM frames (not shared `event_tx` / `/ws`).
    voice_audio_tx: broadcast::Sender<String>,
    state: RwLock<VoiceState>,
    /// When true, PCM ingest is dropped (renderer mute).
    muted: AtomicBool,
    /// Set when `TelephonyService::registered` failed at stack start.
    register_error: Option<String>,
}

pub struct VoiceSessionManager {
    shared: Arc<ManagerShared>,
}

impl VoiceSessionManager {
    /// Register telephony on the live transport and spawn the service + event bridge.
    /// On registration failure returns a disabled manager (stack stays up).
    pub fn spawn(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: &Identity,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        match TelephonyService::registered(transport_tx, identity) {
            Ok(TelephonyServiceParts {
                service,
                control_tx,
                mut event_rx,
            }) => {
                let (voice_audio_tx, _) = broadcast::channel::<String>(VOICE_AUDIO_BROADCAST_CAP);
                let shared = Arc::new(ManagerShared {
                    control_tx: Some(control_tx),
                    event_tx: event_tx.clone(),
                    voice_audio_tx,
                    state: RwLock::new(VoiceState {
                        running: true,
                        ..VoiceState::default()
                    }),
                    muted: AtomicBool::new(false),
                    register_error: None,
                });

                tokio::spawn(service.run());

                let bridge = Arc::clone(&shared);
                tokio::spawn(async move {
                    while let Some(evt) = event_rx.recv().await {
                        bridge_service_event(&bridge, evt).await;
                    }
                    let mut st = bridge.state.write().await;
                    st.running = false;
                    st.active_call = None;
                });

                Self { shared }
            }
            Err(e) => {
                let msg = format!("lxst telephony register: {e}");
                tracing::error!(target: "voice", "{msg}");
                let (voice_audio_tx, _) = broadcast::channel::<String>(VOICE_AUDIO_BROADCAST_CAP);
                Self {
                    shared: Arc::new(ManagerShared {
                        control_tx: None,
                        event_tx,
                        voice_audio_tx,
                        state: RwLock::new(VoiceState::default()),
                        muted: AtomicBool::new(false),
                        register_error: Some(msg),
                    }),
                }
            }
        }
    }

    /// Subscribe to high-rate `voice.audio` frames (dedicated bus, not shared `/ws`).
    pub fn subscribe_voice_audio(&self) -> broadcast::Receiver<String> {
        self.shared.voice_audio_tx.subscribe()
    }

    pub async fn status(&self) -> serde_json::Value {
        let st = self.shared.state.read().await;
        if let Some(ref err) = self.shared.register_error {
            return json!({
                "available": true,
                "enabled": false,
                "running": false,
                "microphone_muted": false,
                "codec": "opus",
                "reason": err,
                "active_call": null,
                "last_error": err,
            });
        }
        json!({
            "available": true,
            "enabled": true,
            "running": st.running,
            "microphone_muted": st.microphone_muted,
            "codec": "opus",
            "active_call": st.active_call,
            "last_error": st.last_error,
        })
    }

    pub async fn call(&self, identity_or_dest_hex: &str) -> serde_json::Value {
        let Some(control_tx) = self.shared.control_tx.as_ref() else {
            return json!({ "ok": false, "error": "voice not available" });
        };
        let remote = match self.resolve_identity_hash(identity_or_dest_hex).await {
            Ok(h) => h,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        match control_tx
            .send(TelephonyControl::Call {
                remote_identity: remote,
                profile: Some(DEFAULT_CALL_PROFILE),
                discovery_timeout: DEFAULT_DISCOVERY_TIMEOUT,
            })
            .await
        {
            Ok(()) => json!({ "ok": true, "identity_hash": hex::encode(remote) }),
            Err(e) => json!({ "ok": false, "error": format!("voice control closed: {e}") }),
        }
    }

    pub async fn answer(&self) -> serde_json::Value {
        self.send_control(TelephonyControl::Answer).await
    }

    pub async fn reject(&self) -> serde_json::Value {
        self.send_control(TelephonyControl::Hangup { ring_timeout: true })
            .await
    }

    pub async fn hangup(&self) -> serde_json::Value {
        self.send_control(TelephonyControl::Hangup {
            ring_timeout: false,
        })
        .await
    }

    pub async fn set_mute(&self, muted: bool) -> serde_json::Value {
        self.shared.muted.store(muted, Ordering::Relaxed);
        let mut st = self.shared.state.write().await;
        st.microphone_muted = muted;
        json!({ "ok": true, "microphone_muted": muted })
    }

    /// Ingest one PCM frame (base64 little-endian f32 interleaved samples).
    pub async fn send_audio(
        &self,
        profile_wire: Option<u32>,
        channels: u8,
        samples_b64: &str,
    ) -> serde_json::Value {
        if self.shared.muted.load(Ordering::Relaxed) {
            return json!({ "ok": true, "dropped": "muted" });
        }
        let samples = match decode_samples_b64(samples_b64) {
            Ok(s) => s,
            Err(e) => return json!({ "ok": false, "error": e }),
        };
        let frame = match RawAudioFrame::new(channels, samples) {
            Ok(f) => f,
            Err(e) => return json!({ "ok": false, "error": format!("invalid pcm frame: {e}") }),
        };
        let profile = match profile_wire.and_then(Profile::from_wire) {
            Some(p) => p,
            None => DEFAULT_CALL_PROFILE,
        };
        let Some(control_tx) = self.shared.control_tx.as_ref() else {
            return json!({ "ok": false, "error": "voice not available" });
        };
        match control_tx
            .send(TelephonyControl::SendOpusFrames {
                profile,
                frames: vec![frame],
            })
            .await
        {
            Ok(()) => json!({ "ok": true }),
            Err(e) => {
                {
                    let mut st = self.shared.state.write().await;
                    if st.active_call.is_some() {
                        st.media.local_tx_drops = st.media.local_tx_drops.saturating_add(1);
                    }
                }
                json!({ "ok": false, "error": format!("voice control closed: {e}") })
            }
        }
    }

    /// Cache dest → identity from announce/peer refresh (renderer/sidecar).
    pub async fn remember_identity_for_dest(&self, destination_hash: &str, identity_hash: &str) {
        let dest = destination_hash.trim().to_lowercase();
        let id = identity_hash.trim().to_lowercase();
        if dest.len() == 32 && id.len() == 32 {
            let mut st = self.shared.state.write().await;
            insert_dest_identity_bounded(&mut st.dest_to_identity, dest, id);
        }
    }

    async fn resolve_identity_hash(&self, input: &str) -> Result<IdentityHash, String> {
        let st = self.shared.state.read().await;
        resolve_identity_hash_with_cache(input, &st.dest_to_identity)
    }

    async fn send_control(&self, control: TelephonyControl) -> serde_json::Value {
        let Some(control_tx) = self.shared.control_tx.as_ref() else {
            return json!({ "ok": false, "error": "voice not available" });
        };
        match control_tx.send(control).await {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": format!("voice control closed: {e}") }),
        }
    }
}

async fn bridge_service_event(shared: &ManagerShared, evt: TelephonyServiceEvent) {
    match evt {
        TelephonyServiceEvent::OutgoingCallPending { remote_identity } => {
            let remote_hex = hex::encode(remote_identity);
            let call = json!({
                "link_id": "",
                "remote_identity": remote_hex,
                "role": "outgoing",
                "status": "calling",
                "answered": false,
            });
            {
                let mut st = shared.state.write().await;
                st.active_call = Some(call.clone());
                st.last_error = None;
                st.media = VoiceMediaCounters::default();
                begin_audit_session(&mut st, "outgoing", &remote_hex, None);
            }
            emit(
                &shared.event_tx,
                "voice.update",
                &json!({
                    "type": "outgoing_pending",
                    "remote_identity": remote_hex,
                }),
            );
        }
        TelephonyServiceEvent::OutgoingCallStarted {
            link_id,
            remote_identity,
        } => {
            let link_hex = hex::encode(link_id);
            let remote_hex = hex::encode(remote_identity);
            let call = json!({
                "link_id": link_hex,
                "remote_identity": remote_hex,
                "role": "outgoing",
                "status": "connecting",
                "answered": false,
            });
            {
                let mut st = shared.state.write().await;
                st.active_call = Some(call.clone());
                if let Some(audit) = st.audit.as_mut() {
                    audit.link_id_hex = Some(link_hex.clone());
                } else {
                    begin_audit_session(&mut st, "outgoing", &remote_hex, Some(link_hex.clone()));
                }
            }
            emit(
                &shared.event_tx,
                "voice.update",
                &json!({
                    "type": "outgoing",
                    "link_id": link_hex,
                    "remote_identity": remote_hex,
                }),
            );
        }
        TelephonyServiceEvent::OutgoingCallFailed {
            remote_identity,
            message,
        } => {
            let remote_hex = hex::encode(remote_identity);
            {
                let mut st = shared.state.write().await;
                st.active_call = None;
                st.last_error = Some(message.clone());
                log_audit_outcome_and_end(&mut st, "failed", Some(message.as_str()));
            }
            emit(
                &shared.event_tx,
                "voice.error",
                &json!({
                    "type": "outgoing_failed",
                    "remote_identity": remote_hex,
                    "message": message,
                }),
            );
        }
        TelephonyServiceEvent::IncomingCall {
            link_id,
            remote_identity,
        } => {
            let link_hex = hex::encode(link_id);
            let remote_hex = hex::encode(remote_identity);
            let call = json!({
                "link_id": link_hex,
                "remote_identity": remote_hex,
                "role": "incoming",
                "status": "ringing",
                "answered": false,
            });
            {
                let mut st = shared.state.write().await;
                st.active_call = Some(call.clone());
                st.last_error = None;
                st.media = VoiceMediaCounters::default();
                begin_audit_session(&mut st, "incoming", &remote_hex, Some(link_hex));
            }
            emit(&shared.event_tx, "voice.incoming", &call);
        }
        TelephonyServiceEvent::CallTerminated { link_id, reason } => {
            let reason_str = reason.map(signalling_status_str);
            let outcome = match reason_str {
                Some("busy") => "busy",
                Some("rejected") => "rejected",
                Some("established") => "completed",
                Some(_) | None => "terminated",
            };
            {
                let mut st = shared.state.write().await;
                st.active_call = None;
                log_audit_outcome_and_end(&mut st, outcome, reason_str);
            }
            emit(
                &shared.event_tx,
                "voice.terminated",
                &json!({
                    "link_id": hex::encode(link_id),
                    "reason": reason_str,
                }),
            );
        }
        TelephonyServiceEvent::Snapshot(snap) => {
            let active = snap.active_call.as_ref().map(|c| {
                json!({
                    "link_id": hex::encode(c.link_id),
                    "remote_identity": hex::encode(c.remote_identity),
                    "role": call_role_str(c.role),
                    "status": signalling_status_str(c.status),
                    "profile": c.profile.map(Profile::wire_value),
                    "answered": c.answered,
                })
            });
            {
                let mut st = shared.state.write().await;
                st.active_call = active.clone();
                if let Some(c) = snap.active_call.as_ref() {
                    if c.status == SignallingStatus::Established {
                        mark_audit_established(&mut st);
                    }
                }
            }
            emit(
                &shared.event_tx,
                "voice.update",
                &json!({
                    "type": "snapshot",
                    "external_busy": snap.external_busy,
                    "pending_link_count": snap.pending_link_count,
                    "active_call": active,
                }),
            );
        }
        TelephonyServiceEvent::MediaSent {
            link_id,
            frames,
            packets,
        } => {
            let link_hex = hex::encode(link_id);
            let payload = {
                let mut st = shared.state.write().await;
                st.media.tx_frames = st.media.tx_frames.saturating_add(frames as u64);
                st.media.tx_packets = st.media.tx_packets.saturating_add(packets as u64);
                json!({
                    "link_id": link_hex,
                    "tx_frames": st.media.tx_frames,
                    "tx_packets": st.media.tx_packets,
                    "rx_frames": st.media.rx_frames,
                })
            };
            emit(&shared.event_tx, "voice.stats", &payload);
        }
        TelephonyServiceEvent::MediaReceived { link_id, frames } => {
            let link_hex = hex::encode(link_id);
            let payload = {
                let mut st = shared.state.write().await;
                st.media.rx_frames = st.media.rx_frames.saturating_add(frames as u64);
                json!({
                    "link_id": link_hex,
                    "tx_frames": st.media.tx_frames,
                    "tx_packets": st.media.tx_packets,
                    "rx_frames": st.media.rx_frames,
                })
            };
            emit(&shared.event_tx, "voice.stats", &payload);
        }
        TelephonyServiceEvent::OpusFramesReceived {
            link_id,
            profile,
            frames,
        } => {
            for frame in frames {
                let samples_b64 = encode_f32_le_b64(&frame.samples);
                // Dedicated high-rate bus — do not use shared event_tx / `/ws`.
                emit(
                    &shared.voice_audio_tx,
                    "voice.audio",
                    &json!({
                        "link_id": hex::encode(link_id),
                        "profile": profile.wire_value(),
                        "channels": frame.channels,
                        "samples_b64": samples_b64,
                    }),
                );
            }
        }
        TelephonyServiceEvent::Error { message } => {
            {
                let mut st = shared.state.write().await;
                st.last_error = Some(message.clone());
                if st.active_call.is_some() {
                    st.active_call = None;
                    log_audit_outcome_and_end(&mut st, "error", Some(message.as_str()));
                }
            }
            emit(
                &shared.event_tx,
                "voice.error",
                &json!({ "type": "error", "message": message }),
            );
        }
        TelephonyServiceEvent::Stopped => {
            let mut st = shared.state.write().await;
            st.running = false;
            st.active_call = None;
            if st.audit.is_some() {
                log_audit_outcome_and_end(&mut st, "stopped", None);
            }
        }
        TelephonyServiceEvent::OpusTransmitStreamStarted { .. }
        | TelephonyServiceEvent::OpusTransmitStreamStopped { .. }
        | TelephonyServiceEvent::OpusReceiveStreamStarted { .. }
        | TelephonyServiceEvent::OpusReceiveStreamStopped { .. }
        | TelephonyServiceEvent::OpusReceiveStreamFrames { .. }
        | TelephonyServiceEvent::Drive(_) => {}
    }
}

fn begin_audit_session(
    st: &mut VoiceState,
    role: &'static str,
    remote_hex: &str,
    link_id_hex: Option<String>,
) {
    st.audit = Some(VoiceAuditSession {
        role,
        remote_hex: remote_hex.to_string(),
        link_id_hex,
        started_at: Instant::now(),
        established_at: None,
        ever_established: false,
        log_phase: VoiceAuditLogPhase::None,
    });
    log_audit_start(st);
}

fn log_audit_start(st: &mut VoiceState) {
    let Some(audit) = st.audit.as_mut() else {
        return;
    };
    if audit.log_phase != VoiceAuditLogPhase::None {
        return;
    }
    audit.log_phase = VoiceAuditLogPhase::StartLogged;
    let remote_prefix = remote_prefix(&audit.remote_hex);
    let link = audit.link_id_hex.as_deref().unwrap_or("-");
    tracing::info!(
        target: "voice",
        "call start role={} remote={} link_id={}",
        audit.role,
        remote_prefix,
        link
    );
}

fn mark_audit_established(st: &mut VoiceState) {
    let Some(audit) = st.audit.as_mut() else {
        return;
    };
    if audit.ever_established {
        return;
    }
    audit.ever_established = true;
    audit.established_at = Some(Instant::now());
    if matches!(
        audit.log_phase,
        VoiceAuditLogPhase::None | VoiceAuditLogPhase::StartLogged
    ) {
        audit.log_phase = VoiceAuditLogPhase::OutcomeLogged;
        let remote_prefix = remote_prefix(&audit.remote_hex);
        tracing::info!(
            target: "voice",
            "call connected role={} remote={}",
            audit.role,
            remote_prefix
        );
    }
}

fn log_audit_outcome_and_end(st: &mut VoiceState, outcome: &str, reason: Option<&str>) {
    let Some(mut audit) = st.audit.take() else {
        return;
    };
    if matches!(
        audit.log_phase,
        VoiceAuditLogPhase::None | VoiceAuditLogPhase::StartLogged
    ) {
        audit.log_phase = VoiceAuditLogPhase::OutcomeLogged;
        let remote_prefix = remote_prefix(&audit.remote_hex);
        let reason_s = reason.unwrap_or(outcome);
        let successful =
            outcome == "completed" || (audit.ever_established && outcome == "terminated");
        if successful && audit.ever_established && outcome == "terminated" {
            tracing::info!(
                target: "voice",
                "call ended role={} remote={} reason={}",
                audit.role,
                remote_prefix,
                reason_s
            );
        } else if outcome == "completed" {
            tracing::info!(
                target: "voice",
                "call connected role={} remote={}",
                audit.role,
                remote_prefix
            );
        } else {
            tracing::warn!(
                target: "voice",
                "call {} role={} remote={} reason={}",
                outcome,
                audit.role,
                remote_prefix,
                reason_s
            );
        }
    }
    if audit.log_phase != VoiceAuditLogPhase::EndLogged {
        audit.log_phase = VoiceAuditLogPhase::EndLogged;
        let summary = format_voice_audit_end_summary(&audit, outcome, &st.media, Instant::now());
        tracing::info!(target: "voice", "{summary}");
    }
    st.media = VoiceMediaCounters::default();
}

fn remote_prefix(remote_hex: &str) -> &str {
    let len = remote_hex.len().min(16);
    &remote_hex[..len]
}

/// Estimated RX gap percent from established duration vs received frames (QualityHigh).
pub fn estimate_rx_gap_pct(established_ms: u64, rx_frames: u64) -> u32 {
    if established_ms == 0 {
        return 0;
    }
    let expected = established_ms.saturating_add(QUALITY_HIGH_FRAME_MS.saturating_sub(1))
        / QUALITY_HIGH_FRAME_MS;
    if expected == 0 {
        return 0;
    }
    if rx_frames >= expected {
        return 0;
    }
    let missing = expected - rx_frames;
    ((missing.saturating_mul(100)) / expected) as u32
}

/// Lifecycle end summary line (no per-packet logs). Pure for unit tests.
pub fn format_voice_audit_end_summary(
    audit: &VoiceAuditSession,
    outcome: &str,
    media: &VoiceMediaCounters,
    now: Instant,
) -> String {
    let duration_ms = now.duration_since(audit.started_at).as_millis();
    let loss_field = if audit.ever_established {
        let established_ms = audit
            .established_at
            .map(|t| now.duration_since(t).as_millis() as u64)
            .unwrap_or(0);
        format!(
            "est_rx_gap_pct={}",
            estimate_rx_gap_pct(established_ms, media.rx_frames)
        )
    } else {
        "packet_loss=n/a".to_string()
    };
    format!(
        "call end outcome={} role={} remote={} duration_ms={} tx_frames={} tx_packets={} rx_frames={} local_tx_drops={} {}",
        outcome,
        audit.role,
        remote_prefix(&audit.remote_hex),
        duration_ms,
        media.tx_frames,
        media.tx_packets,
        media.rx_frames,
        media.local_tx_drops,
        loss_field
    )
}

fn emit(event_tx: &broadcast::Sender<String>, event_type: &str, payload: &serde_json::Value) {
    let frame = json!({ "type": event_type, "payload": payload });
    let _ = event_tx.send(frame.to_string());
}

fn encode_f32_le_b64(samples: &[f32]) -> String {
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn signalling_status_str(status: SignallingStatus) -> &'static str {
    match status {
        SignallingStatus::Busy => "busy",
        SignallingStatus::Rejected => "rejected",
        SignallingStatus::Calling => "calling",
        SignallingStatus::Available => "available",
        SignallingStatus::Ringing => "ringing",
        SignallingStatus::Connecting => "connecting",
        SignallingStatus::Established => "established",
    }
}

fn call_role_str(role: CallRole) -> &'static str {
    match role {
        CallRole::Incoming => "incoming",
        CallRole::Outgoing => "outgoing",
    }
}

/// Pure helper for tests / dial path: prefer cached dest→identity, else parse as identity.
pub fn resolve_identity_hash_with_cache(
    input: &str,
    dest_to_identity: &HashMap<String, String>,
) -> Result<[u8; 16], String> {
    let trimmed = input.trim().to_lowercase();
    if let Some(id_hex) = dest_to_identity.get(&trimmed) {
        return parse_hash16(id_hex);
    }
    parse_hash16(&trimmed)
}

/// Decode base64 LE f32 PCM; used by audio ingest validation tests.
pub fn decode_samples_b64(samples_b64: &str) -> Result<Vec<f32>, String> {
    if samples_b64.is_empty() {
        return Err("empty samples_b64".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(samples_b64.as_bytes())
        .map_err(|e| format!("invalid base64 samples: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("samples_b64 length must be multiple of 4".into());
    }
    let mut samples = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_identity_passthrough() {
        let hex = "aabbccddeeff00112233445566778899";
        let h = resolve_identity_hash_with_cache(hex, &HashMap::new()).unwrap();
        assert_eq!(hex::encode(h), hex);
    }

    #[test]
    fn resolve_identity_via_dest_cache() {
        let dest = "11112222333344445555666677778888".to_string();
        let id = "aabbccddeeff00112233445566778899".to_string();
        let mut map = HashMap::new();
        map.insert(dest.clone(), id.clone());
        let h = resolve_identity_hash_with_cache(&dest, &map).unwrap();
        assert_eq!(hex::encode(h), id);
    }

    #[test]
    fn resolve_identity_missing_rejects_short() {
        assert!(resolve_identity_hash_with_cache("aabb", &HashMap::new()).is_err());
    }

    #[test]
    fn decode_samples_rejects_empty() {
        assert!(decode_samples_b64("").is_err());
    }

    #[test]
    fn decode_samples_roundtrip_one_sample() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(0.5f32.to_le_bytes());
        let samples = decode_samples_b64(&b64).unwrap();
        assert_eq!(samples.len(), 1);
        assert!((samples[0] - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn signalling_status_strings_cover_wire_set() {
        assert_eq!(
            signalling_status_str(SignallingStatus::Established),
            "established"
        );
        assert_eq!(signalling_status_str(SignallingStatus::Ringing), "ringing");
        assert_eq!(call_role_str(CallRole::Incoming), "incoming");
    }

    #[test]
    fn quality_high_frame_size_contract() {
        // Keep renderer/sidecar PCM packing aligned with lxst-core Profile::QualityHigh.
        assert_eq!(Profile::QualityHigh.channels(), 1);
        assert_eq!(Profile::QualityHigh.sample_rate_hz(), 48_000);
        assert_eq!(Profile::QualityHigh.sample_frames_per_packet(), 2_880);
    }

    #[test]
    fn estimate_rx_gap_pct_zero_when_full() {
        // 600 ms ≈ 10 QualityHigh frames.
        assert_eq!(estimate_rx_gap_pct(600, 10), 0);
        assert_eq!(estimate_rx_gap_pct(600, 5), 50);
        assert_eq!(estimate_rx_gap_pct(600, 0), 100);
    }

    #[test]
    fn audit_end_summary_marks_packet_loss_na_when_never_established() {
        let started = Instant::now();
        let audit = VoiceAuditSession {
            role: "outgoing",
            remote_hex: "aabbccddeeff00112233445566778899".into(),
            link_id_hex: None,
            started_at: started,
            established_at: None,
            ever_established: false,
            log_phase: VoiceAuditLogPhase::OutcomeLogged,
        };
        let summary = format_voice_audit_end_summary(
            &audit,
            "failed",
            &VoiceMediaCounters::default(),
            started + Duration::from_secs(2),
        );
        assert!(summary.contains("outcome=failed"));
        assert!(summary.contains("packet_loss=n/a"));
        assert!(summary.contains("tx_frames=0"));
        assert!(summary.contains("tx_packets=0"));
        assert!(summary.contains("rx_frames=0"));
    }

    #[test]
    fn audit_end_summary_includes_est_rx_gap_after_established() {
        let started = Instant::now();
        let established = started + Duration::from_secs(1);
        let audit = VoiceAuditSession {
            role: "outgoing",
            remote_hex: "aabbccddeeff00112233445566778899".into(),
            link_id_hex: Some("11".repeat(16)),
            started_at: started,
            established_at: Some(established),
            ever_established: true,
            log_phase: VoiceAuditLogPhase::OutcomeLogged,
        };
        let media = VoiceMediaCounters {
            tx_frames: 20,
            tx_packets: 20,
            rx_frames: 5,
            local_tx_drops: 1,
        };
        let summary = format_voice_audit_end_summary(
            &audit,
            "completed",
            &media,
            established + Duration::from_millis(600),
        );
        assert!(summary.contains("tx_packets=20"));
        assert!(summary.contains("local_tx_drops=1"));
        assert!(summary.contains("est_rx_gap_pct="));
        assert!(!summary.contains("packet_loss=n/a"));
    }

    #[tokio::test]
    async fn status_shape_when_manager_spawns() {
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(4);
        let identity = Identity::new();
        let (event_tx, _event_rx) = broadcast::channel::<String>(8);
        tokio::spawn(async move { while transport_rx.recv().await.is_some() {} });
        let mgr = VoiceSessionManager::spawn(transport_tx, &identity, event_tx);
        let status = mgr.status().await;
        assert_eq!(status["available"], true);
        assert_eq!(status["codec"], "opus");
        assert!(status["enabled"].is_boolean());
        let _ = mgr.hangup().await;
    }

    #[tokio::test]
    async fn call_rejects_invalid_hex() {
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(4);
        let identity = Identity::new();
        let (event_tx, _event_rx) = broadcast::channel::<String>(8);
        tokio::spawn(async move { while transport_rx.recv().await.is_some() {} });
        let mgr = VoiceSessionManager::spawn(transport_tx, &identity, event_tx);
        let resp = mgr.call("not-a-hash").await;
        assert_eq!(resp["ok"], false);
        let err = resp["error"].as_str().unwrap_or("");
        assert!(
            err.contains("32 hex") || err.contains("not available"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn send_audio_rejects_empty_and_respects_mute() {
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(4);
        let identity = Identity::new();
        let (event_tx, _event_rx) = broadcast::channel::<String>(8);
        tokio::spawn(async move { while transport_rx.recv().await.is_some() {} });
        let mgr = VoiceSessionManager::spawn(transport_tx, &identity, event_tx);
        let empty = mgr.send_audio(None, 1, "").await;
        assert_eq!(empty["ok"], false);
        let _ = mgr.set_mute(true).await;
        let muted = mgr.send_audio(None, 1, "AAAA").await;
        // Muted path only when control channel is live; otherwise "not available".
        if muted["dropped"] == "muted" {
            assert_eq!(muted["ok"], true);
        } else {
            assert_eq!(muted["ok"], false);
        }
    }

    fn disabled_manager(event_tx: broadcast::Sender<String>) -> VoiceSessionManager {
        let (voice_audio_tx, _) = broadcast::channel::<String>(4);
        VoiceSessionManager {
            shared: Arc::new(ManagerShared {
                control_tx: None,
                event_tx,
                voice_audio_tx,
                state: RwLock::new(VoiceState::default()),
                muted: AtomicBool::new(false),
                register_error: Some("voice disabled for test".into()),
            }),
        }
    }

    #[tokio::test]
    async fn status_disabled_when_register_failed() {
        let (event_tx, _) = broadcast::channel::<String>(4);
        let mgr = disabled_manager(event_tx);
        let status = mgr.status().await;
        assert_eq!(status["available"], true);
        assert_eq!(status["enabled"], false);
        assert_eq!(status["running"], false);
        assert!(status["reason"].as_str().unwrap_or("").contains("disabled"));
    }

    #[tokio::test]
    async fn answer_reject_hangup_stable_when_unavailable() {
        let (event_tx, _) = broadcast::channel::<String>(4);
        let mgr = disabled_manager(event_tx);
        for resp in [mgr.answer().await, mgr.reject().await, mgr.hangup().await] {
            assert_eq!(resp["ok"], false);
            assert_eq!(resp["error"], "voice not available");
        }
    }

    #[tokio::test]
    async fn bridge_emits_incoming_update_terminated_and_error() {
        let (event_tx, mut event_rx) = broadcast::channel::<String>(16);
        let (voice_audio_tx, mut voice_audio_rx) = broadcast::channel::<String>(16);
        let shared = Arc::new(ManagerShared {
            control_tx: None,
            event_tx,
            voice_audio_tx,
            state: RwLock::new(VoiceState::default()),
            muted: AtomicBool::new(false),
            register_error: None,
        });
        let link = [0x11u8; 16];
        let remote = [0x22u8; 16];

        bridge_service_event(
            &shared,
            TelephonyServiceEvent::IncomingCall {
                link_id: link,
                remote_identity: remote,
            },
        )
        .await;
        let incoming = event_rx.try_recv().expect("voice.incoming");
        assert!(incoming.contains("\"type\":\"voice.incoming\""));
        assert!(shared.state.read().await.active_call.is_some());

        bridge_service_event(
            &shared,
            TelephonyServiceEvent::OutgoingCallPending {
                remote_identity: remote,
            },
        )
        .await;
        let update = event_rx.try_recv().expect("voice.update");
        assert!(update.contains("\"type\":\"voice.update\""));
        assert!(
            shared.state.read().await.active_call.is_some(),
            "outgoing pending must set active_call"
        );

        bridge_service_event(
            &shared,
            TelephonyServiceEvent::MediaSent {
                link_id: link,
                frames: 2,
                packets: 2,
            },
        )
        .await;
        let stats = event_rx.try_recv().expect("voice.stats");
        assert!(stats.contains("\"type\":\"voice.stats\""));
        assert!(stats.contains("\"tx_frames\":2"));

        let pcm = RawAudioFrame::new(1, vec![0.0f32; 48]).expect("pcm");
        bridge_service_event(
            &shared,
            TelephonyServiceEvent::OpusFramesReceived {
                link_id: link,
                profile: Profile::QualityHigh,
                frames: vec![pcm],
            },
        )
        .await;
        assert!(
            event_rx.try_recv().is_err(),
            "voice.audio must not use shared event bus"
        );
        let audio = voice_audio_rx
            .try_recv()
            .expect("voice.audio on dedicated bus");
        assert!(audio.contains("\"type\":\"voice.audio\""));
        assert!(audio.contains("samples_b64"));

        bridge_service_event(
            &shared,
            TelephonyServiceEvent::CallTerminated {
                link_id: link,
                reason: Some(SignallingStatus::Rejected),
            },
        )
        .await;
        let terminated = event_rx.try_recv().expect("voice.terminated");
        assert!(terminated.contains("\"type\":\"voice.terminated\""));
        assert!(shared.state.read().await.active_call.is_none());
        assert!(shared.state.read().await.audit.is_none());

        bridge_service_event(
            &shared,
            TelephonyServiceEvent::Error {
                message: "boom".into(),
            },
        )
        .await;
        let err = event_rx.try_recv().expect("voice.error");
        assert!(err.contains("\"type\":\"voice.error\""));
        assert_eq!(
            shared.state.read().await.last_error.as_deref(),
            Some("boom")
        );
    }

    #[test]
    fn dest_identity_cache_evicts_when_full() {
        let mut cache = HashMap::new();
        for i in 0..MAX_DEST_TO_IDENTITY_CACHE {
            let dest = format!("{i:032x}");
            let id = format!("{:032x}", i + 1);
            insert_dest_identity_bounded(&mut cache, dest, id);
        }
        assert_eq!(cache.len(), MAX_DEST_TO_IDENTITY_CACHE);
        let overflow_dest = "f".repeat(32);
        let overflow_id = "e".repeat(32);
        insert_dest_identity_bounded(&mut cache, overflow_dest.clone(), overflow_id.clone());
        assert_eq!(cache.len(), MAX_DEST_TO_IDENTITY_CACHE);
        assert_eq!(
            cache.get(&overflow_dest).map(String::as_str),
            Some(overflow_id.as_str())
        );
    }

    #[tokio::test]
    async fn send_audio_accepts_quality_high_frame_size() {
        let (control_tx, mut control_rx) = mpsc::channel::<TelephonyControl>(4);
        let (event_tx, _) = broadcast::channel::<String>(4);
        let (voice_audio_tx, _) = broadcast::channel::<String>(4);
        let mgr = VoiceSessionManager {
            shared: Arc::new(ManagerShared {
                control_tx: Some(control_tx),
                event_tx,
                voice_audio_tx,
                state: RwLock::new(VoiceState {
                    running: true,
                    ..VoiceState::default()
                }),
                muted: AtomicBool::new(false),
                register_error: None,
            }),
        };
        let n = Profile::QualityHigh.sample_frames_per_packet()
            * usize::from(Profile::QualityHigh.channels());
        let mut bytes = Vec::with_capacity(n * 4);
        for _ in 0..n {
            bytes.extend_from_slice(&0f32.to_le_bytes());
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let resp = mgr.send_audio(None, 1, &b64).await;
        assert_eq!(resp["ok"], true, "{resp}");
        match control_rx.recv().await {
            Some(TelephonyControl::SendOpusFrames { frames, .. }) => {
                assert_eq!(frames.len(), 1);
                assert_eq!(frames[0].samples.len(), n);
            }
            other => panic!("expected SendOpusFrames, got {other:?}"),
        }
    }
}
