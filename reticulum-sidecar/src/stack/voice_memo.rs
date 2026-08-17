//! LXMF voice-memo encode: PCM → Opus (`QualityMedium`) → Ogg container.
//!
//! Wire parity with Ratspeak: `AM_OPUS_OGG`, OpusHead 1ch/24 kHz, vendor `Ratspeak`,
//! 60 ms packets. Cap ~240 KiB so memos stay under the 256 KiB LXMF field limit and
//! default PN deposit size.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use lxst_core::{OpusEncoderState, Profile, RawAudioFrame};
use ogg::{PacketWriteEndInfo, PacketWriter};
use uuid::Uuid;

/// Soft cap under lxmf-core 256 KiB field + default 256 KB PN deposit.
pub const VOICE_MEMO_MAX_OGG_BYTES: usize = 240 * 1024;
/// ~4 minutes of 60 ms QualityMedium frames.
pub const VOICE_MEMO_MAX_FRAME_COUNT: usize = 4_000;
const FRAME_MS: u64 = 60;
const SAMPLE_RATE_HZ: u32 = 24_000;
/// Opus Ogg granule clock is fixed at 48 kHz (RFC 7845 §4), not the input rate.
const OPUS_GRANULE_HZ: u64 = 48_000;
const CHANNELS: u8 = 1;
const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE_HZ as usize * FRAME_MS as usize) / 1000;
/// QualityMedium ~8 kbps → ~60 B/packet; allow headroom.
const MAX_OPUS_PACKET_BYTES: usize = 60;
/// Drop memo sessions with no push_audio activity for this long.
const IDLE_TIMEOUT_MS: u64 = 5 * 60 * 1000;
/// OpusHead + OpusTags + margin for Ogg page headers.
const OGG_FIXED_OVERHEAD: usize = 128;
/// Per audio page: Ogg page header (~27 B) + segment table (~1 B) + rounding.
const OGG_PAGE_OVERHEAD: usize = 32;

pub struct VoiceMemoManager {
    sessions: Mutex<HashMap<String, VoiceMemoSession>>,
}

struct VoiceMemoSession {
    encoder: OpusEncoderState,
    opus_packets: Vec<Vec<u8>>,
    started_ms: u64,
    last_activity_ms: u64,
}

impl Default for VoiceMemoManager {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceMemoManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self) -> Result<serde_json::Value, String> {
        let encoder = OpusEncoderState::new(Profile::QualityMedium)
            .map_err(|e| format!("voice_memo_encoder: {e}"))?;
        let session_id = Uuid::new_v4().to_string();
        let started_ms = now_ms();
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "voice_memo_lock".to_string())?;
        prune_idle_sessions(&mut guard, started_ms);
        // Bound concurrent memo sessions (one per typical UI).
        if guard.len() >= 4 {
            return Err("voice_memo_busy".into());
        }
        guard.insert(
            session_id.clone(),
            VoiceMemoSession {
                encoder,
                opus_packets: Vec::new(),
                started_ms,
                last_activity_ms: started_ms,
            },
        );
        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
        }))
    }

    pub fn push_audio(
        &self,
        session_id: &str,
        channels: u8,
        samples_b64: &str,
    ) -> Result<serde_json::Value, String> {
        if channels != CHANNELS {
            return Err(format!("invalid_channels: expected {CHANNELS}"));
        }
        let samples = decode_f32_le_base64(samples_b64)?;
        if samples.len() != SAMPLES_PER_FRAME {
            return Err(format!(
                "invalid_frame_samples: {} (expected {SAMPLES_PER_FRAME})",
                samples.len()
            ));
        }
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "voice_memo_lock".to_string())?;
        let now = now_ms();
        prune_idle_sessions(&mut guard, now);
        let session = guard
            .get_mut(session_id)
            .ok_or_else(|| "voice_memo_session_unknown".to_string())?;
        if session.opus_packets.len() >= VOICE_MEMO_MAX_FRAME_COUNT {
            return Err("voice_memo_too_long".into());
        }
        let frame =
            RawAudioFrame::new(CHANNELS, samples).map_err(|e| format!("voice_memo_frame: {e}"))?;
        let encoded = session
            .encoder
            .encode_frame(&frame)
            .map_err(|e| format!("voice_memo_encode: {e}"))?;
        if encoded.payload.len() > MAX_OPUS_PACKET_BYTES {
            return Err(format!(
                "voice_memo_packet_too_large: {}",
                encoded.payload.len()
            ));
        }
        session.opus_packets.push(encoded.payload);
        session.last_activity_ms = now;
        let approx = estimate_ogg_bytes(&session.opus_packets);
        if approx > VOICE_MEMO_MAX_OGG_BYTES {
            return Err("voice_memo_too_large".into());
        }
        Ok(serde_json::json!({
            "ok": true,
            "frames": session.opus_packets.len(),
            "duration_ms": session.opus_packets.len() as u64 * FRAME_MS,
        }))
    }

    pub fn stop(&self, session_id: &str) -> Result<serde_json::Value, String> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "voice_memo_lock".to_string())?;
        prune_idle_sessions(&mut guard, now_ms());
        let session = guard
            .remove(session_id)
            .ok_or_else(|| "voice_memo_session_unknown".to_string())?;
        if session.opus_packets.is_empty() {
            return Err("voice_memo_empty".into());
        }
        let duration_ms = session.opus_packets.len() as u64 * FRAME_MS;
        let ogg = mux_opus_ogg(&session.opus_packets)?;
        if ogg.len() > VOICE_MEMO_MAX_OGG_BYTES {
            return Err(format!(
                "voice_memo_too_large: {} > {VOICE_MEMO_MAX_OGG_BYTES}",
                ogg.len()
            ));
        }
        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "ogg_base64": base64::engine::general_purpose::STANDARD.encode(&ogg),
            "duration_ms": duration_ms,
            "size_bytes": ogg.len(),
            "started_ms": session.started_ms,
            "mode": lxmf_core::constants::AM_OPUS_OGG,
        }))
    }

    pub fn cancel(&self, session_id: &str) -> Result<serde_json::Value, String> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "voice_memo_lock".to_string())?;
        prune_idle_sessions(&mut guard, now_ms());
        let removed = guard.remove(session_id).is_some();
        Ok(serde_json::json!({
            "ok": true,
            "cancelled": removed,
        }))
    }
}

#[cfg(test)]
impl VoiceMemoManager {
    /// Set every session's last activity for idle-prune tests.
    fn test_set_all_last_activity_ms(&self, last_activity_ms: u64) {
        let mut guard = self.sessions.lock().expect("voice_memo_lock");
        for session in guard.values_mut() {
            session.last_activity_ms = last_activity_ms;
        }
    }
}

fn prune_idle_sessions(guard: &mut HashMap<String, VoiceMemoSession>, now: u64) {
    guard.retain(|_, session| now.saturating_sub(session.last_activity_ms) <= IDLE_TIMEOUT_MS);
}

fn estimate_ogg_bytes(packets: &[Vec<u8>]) -> usize {
    let packet_bytes: usize = packets.iter().map(Vec::len).sum();
    packet_bytes + OGG_FIXED_OVERHEAD + packets.len() * OGG_PAGE_OVERHEAD
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn decode_f32_le_base64(samples_b64: &str) -> Result<Vec<f32>, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(samples_b64.as_bytes())
        .map_err(|e| format!("samples_b64_decode: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("samples_b64_misaligned".into());
    }
    let mut samples = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(samples)
}

/// RFC 7845 Ogg Opus mux: OpusHead + OpusTags (vendor Ratspeak) + audio pages.
///
/// Granule positions are always in **48 kHz PCM samples** (RFC 7845 §4), even when
/// OpusHead advertises a 24 kHz input rate. Using the input rate here made Chromium
/// `decodeAudioData` report ~half duration and truncate playback.
pub fn mux_opus_ogg(opus_packets: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    if opus_packets.is_empty() {
        return Err("voice_memo_empty".into());
    }
    let mut out = Vec::new();
    {
        let mut writer = PacketWriter::new(&mut out);
        let head = opus_head_packet();
        writer
            .write_packet(head, 0x1000_0001, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("ogg_write_head: {e}"))?;
        let tags = opus_tags_packet();
        writer
            .write_packet(tags, 0x1000_0001, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("ogg_write_tags: {e}"))?;
        // Opus granule clock is fixed at 48 kHz regardless of encoder input rate.
        let granule_per_packet = (OPUS_GRANULE_HZ * FRAME_MS) / 1000;
        let last = opus_packets.len() - 1;
        for (i, packet) in opus_packets.iter().enumerate() {
            let granule = granule_per_packet * (i as u64 + 1);
            let end = if i == last {
                PacketWriteEndInfo::EndStream
            } else {
                // One packet per page keeps granule positions visible to demuxers.
                PacketWriteEndInfo::EndPage
            };
            writer
                .write_packet(packet.clone(), 0x1000_0001, end, granule)
                .map_err(|e| format!("ogg_write_audio: {e}"))?;
        }
    }
    if !out.starts_with(b"OggS") {
        return Err("ogg_missing_magic".into());
    }
    Ok(out)
}

fn opus_head_packet() -> Vec<u8> {
    // RFC 7845 §5.1 OpusHead
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(CHANNELS);
    head.extend_from_slice(&0u16.to_le_bytes()); // pre-skip
    head.extend_from_slice(&SAMPLE_RATE_HZ.to_le_bytes());
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // channel mapping family
    head
}

fn opus_tags_packet() -> Vec<u8> {
    // RFC 7845 §5.2 OpusTags — vendor "Ratspeak", 0 comments
    let vendor = b"Ratspeak";
    let mut tags = Vec::with_capacity(8 + 4 + vendor.len() + 4);
    tags.extend_from_slice(b"OpusTags");
    tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
    tags.extend_from_slice(vendor);
    tags.extend_from_slice(&0u32.to_le_bytes()); // user comment list length
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mux_opus_ogg_writes_head_and_magic() {
        let packets = vec![vec![0u8; 8], vec![1u8; 10]];
        let ogg = mux_opus_ogg(&packets).expect("mux");
        assert!(ogg.starts_with(b"OggS"));
        assert!(ogg.windows(8).any(|w| w == b"OpusHead"));
        assert!(ogg.windows(8).any(|w| w == b"OpusTags"));
        assert!(ogg.windows(8).any(|w| w == b"Ratspeak"));
        // OpusHead: 1 channel, 24 kHz
        let head_at = ogg.windows(8).position(|w| w == b"OpusHead").expect("head");
        assert_eq!(ogg[head_at + 9], 1); // channels
        let rate = u32::from_le_bytes([
            ogg[head_at + 12],
            ogg[head_at + 13],
            ogg[head_at + 14],
            ogg[head_at + 15],
        ]);
        assert_eq!(rate, 24_000);
    }

    fn ogg_page_granules(ogg: &[u8]) -> Vec<u64> {
        let mut granules = Vec::new();
        let mut i = 0usize;
        while i + 27 <= ogg.len() {
            if &ogg[i..i + 4] != b"OggS" {
                i += 1;
                continue;
            }
            let granule = u64::from_le_bytes(ogg[i + 6..i + 14].try_into().expect("8 bytes"));
            let page_segments = ogg[i + 26] as usize;
            let table_end = i + 27 + page_segments;
            if table_end > ogg.len() {
                break;
            }
            let body_len: usize = ogg[i + 27..table_end].iter().map(|&b| b as usize).sum();
            let page_end = table_end + body_len;
            if page_end > ogg.len() {
                break;
            }
            granules.push(granule);
            i = page_end;
        }
        granules
    }

    #[test]
    fn mux_opus_ogg_granules_use_48khz_clock() {
        let packets = vec![vec![0u8; 8], vec![1u8; 10], vec![2u8; 12]];
        let ogg = mux_opus_ogg(&packets).expect("mux");
        let granules = ogg_page_granules(&ogg);
        // Head + tags pages use granule 0; each 60 ms audio page advances by 2880 @ 48 kHz.
        assert!(
            granules.len() >= 5,
            "expected header + audio pages, got {granules:?}"
        );
        assert_eq!(granules[0], 0);
        assert_eq!(granules[1], 0);
        assert_eq!(granules[2], 2_880);
        assert_eq!(granules[3], 5_760);
        assert_eq!(granules[4], 8_640);
    }

    #[test]
    fn memo_encode_silent_frames_round_trip_size() {
        let mgr = VoiceMemoManager::new();
        let start = mgr.start().expect("start");
        let session_id = start["session_id"].as_str().expect("id").to_string();
        let silence = vec![0f32; SAMPLES_PER_FRAME];
        let mut bytes = Vec::with_capacity(silence.len() * 4);
        for s in silence {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        for _ in 0..5 {
            mgr.push_audio(&session_id, 1, &b64).expect("audio");
        }
        let stop = mgr.stop(&session_id).expect("stop");
        assert_eq!(stop["ok"], true);
        assert_eq!(stop["duration_ms"], 300);
        let ogg = base64::engine::general_purpose::STANDARD
            .decode(stop["ogg_base64"].as_str().expect("b64"))
            .expect("decode");
        assert!(ogg.starts_with(b"OggS"));
        assert!(ogg.len() <= VOICE_MEMO_MAX_OGG_BYTES);
        assert!(ogg.len() > 40);
    }

    #[test]
    fn cancel_then_stop_fails() {
        let mgr = VoiceMemoManager::new();
        let start = mgr.start().expect("start");
        let session_id = start["session_id"].as_str().expect("id").to_string();
        mgr.cancel(&session_id).expect("cancel");
        let err = mgr.stop(&session_id).expect_err("stop after cancel");
        assert!(err.contains("unknown"), "{err}");
    }

    #[test]
    fn idle_sessions_pruned_before_start() {
        let mgr = VoiceMemoManager::new();
        for _ in 0..4 {
            mgr.start().expect("start");
        }
        mgr.start().expect_err("busy when four sessions active");

        let expired = now_ms().saturating_sub(IDLE_TIMEOUT_MS + 1);
        mgr.test_set_all_last_activity_ms(expired);
        mgr.start().expect("start after idle prune");
    }

    #[test]
    fn estimate_ogg_bytes_accounts_for_page_overhead() {
        let packets = vec![vec![0u8; 40], vec![1u8; 50]];
        let approx = estimate_ogg_bytes(&packets);
        assert_eq!(approx, 90 + OGG_FIXED_OVERHEAD + 2 * OGG_PAGE_OVERHEAD);
    }

    #[test]
    fn encode_then_lxmf_audio_field_round_trips() {
        use base64::Engine as _;
        use lxmf_core::constants::AM_OPUS_OGG;
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;

        let mgr = VoiceMemoManager::new();
        let start = mgr.start().expect("start");
        let session_id = start["session_id"].as_str().expect("id").to_string();
        let silence = vec![0f32; SAMPLES_PER_FRAME];
        let mut bytes = Vec::with_capacity(silence.len() * 4);
        for s in silence {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        mgr.push_audio(&session_id, 1, &b64).expect("audio");
        let stop = mgr.stop(&session_id).expect("stop");
        let ogg = base64::engine::general_purpose::STANDARD
            .decode(stop["ogg_base64"].as_str().expect("b64"))
            .expect("decode");

        let mut msg = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "[voice:60]",
            DeliveryMethod::Direct,
        );
        msg.set_audio_field(AM_OPUS_OGG, &ogg).expect("set");
        let audio = msg.audio_field().expect("field").expect("some");
        assert_eq!(audio.mode, AM_OPUS_OGG);
        assert_eq!(audio.bytes, ogg.as_slice());
    }
}
