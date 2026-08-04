//! LXMF delivery destination announce + inbound receive (Ratspeak/lxmd parity).
//!
//! Inbound paths:
//! - **Direct / resource** — decrypted link payloads via `set_link_packet_channel` /
//!   `set_resource_completed_channel`
//! - **Opportunistic** — destination-encrypted DATA packets via `set_inbound_raw_channel`
//!   (Sideband / Columba short messages; lxmd wires the same channel)

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use lxmf_core::handlers::get_announce_app_data;
use lxmf_core::message::LxMessage;
use lxmf_core::router::LxmRouter;
use rns_identity::announce::AnnounceData;
use rns_identity::identity::Identity;
use rns_runtime::link_manager::{LinkManager, register_destination};
use rns_transport::messages::{OutboundRequest, TransportMessage};
use rns_wire::context::PacketContext;
use rns_wire::flags::{DestinationType, HeaderType, PacketFlags, PacketType, TransportType};
use rns_wire::header::PacketHeader;
use tokio::sync::{Mutex as TokioMutex, RwLock, mpsc};

use super::config;
use super::persistence::PersistedState;

pub const LXMF_APP: &str = "lxmf.delivery";

/// Brief pause after a successful pre-sync LXMF announce so hubs can flood the reverse path
/// before LinkRequest (matches the effective delay of “Announce now, then Sync”).
pub const PROPAGATION_SYNC_ANNOUNCE_SETTLE: Duration = Duration::from_secs(2);

const UNPACK_WARN_INTERVAL: Duration = Duration::from_secs(5);
static LAST_UNPACK_WARN_MS: AtomicU64 = AtomicU64::new(0);

fn rate_limited_unpack_warn(error: &str, len: usize) {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let prev = LAST_UNPACK_WARN_MS.load(Ordering::Relaxed);
    if now_ms.saturating_sub(prev) < UNPACK_WARN_INTERVAL.as_millis() as u64 {
        tracing::debug!(error = %error, len, "link data not an LXMF message");
        return;
    }
    LAST_UNPACK_WARN_MS.store(now_ms, Ordering::Relaxed);
    tracing::warn!(error = %error, len, "link data not an LXMF message");
}

fn mark_announce_sent(last_at: &Arc<Mutex<Option<Instant>>>) {
    if let Ok(mut slot) = last_at.lock() {
        *slot = Some(Instant::now());
    }
}

/// Build a broadcast LXMF delivery announce packet (lxmd `create_announce_packet` shape).
pub fn build_lxmf_delivery_announce_packet(
    identity: &Identity,
    lxmf_dest_hash: [u8; 16],
    display_name: Option<&str>,
) -> Result<Vec<u8>, String> {
    let app_data = get_announce_app_data(display_name, None);
    let announce = AnnounceData::create(identity, LXMF_APP, Some(app_data.as_slice()), None)
        .map_err(|e| format!("Failed to create LXMF announce: {e}"))?;
    let flags = PacketFlags {
        header_type: HeaderType::Header1,
        context_flag: false,
        transport_type: TransportType::Broadcast,
        destination_type: DestinationType::Single,
        packet_type: PacketType::Announce,
    };
    let header = PacketHeader {
        flags,
        hops: 0,
        transport_id: None,
        destination_hash: lxmf_dest_hash,
        context: PacketContext::None,
    };
    let mut raw = header.pack();
    raw.extend_from_slice(&announce.pack());
    Ok(raw)
}

/// Queue an LXMF delivery announce on the transport outbound channel.
pub async fn send_lxmf_delivery_announce(
    transport_tx: &mpsc::Sender<TransportMessage>,
    identity: &Identity,
    lxmf_dest_hash: [u8; 16],
    display_name: Option<&str>,
) -> Result<(), String> {
    let raw = build_lxmf_delivery_announce_packet(identity, lxmf_dest_hash, display_name)?;
    transport_tx
        .send(TransportMessage::Outbound(OutboundRequest {
            raw: Bytes::from(raw),
            destination_hash: lxmf_dest_hash,
        }))
        .await
        .map_err(|e| format!("Failed to send LXMF announce: {e}"))
}

fn resolve_announce_display_name(state: &PersistedState) -> Option<String> {
    state
        .identity
        .display_name
        .as_ref()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && n != "Self")
}

/// Startup announce (after a short interface settle) + periodic announces from `announce_interval_sec`.
pub fn spawn_lxmf_announce_loop(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    lxmf_dest_hash: [u8; 16],
    config_dir: std::path::PathBuf,
    inner: Arc<RwLock<PersistedState>>,
    last_announce_at: Arc<Mutex<Option<Instant>>>,
) {
    tokio::spawn(async move {
        // Brief settle so interfaces can come online (lxmd waits up to 30s; we announce after 2s).
        tokio::time::sleep(Duration::from_secs(2)).await;
        {
            let display_name = {
                let state = inner.read().await;
                resolve_announce_display_name(&state)
            };
            match send_lxmf_delivery_announce(
                &transport_tx,
                &identity,
                lxmf_dest_hash,
                display_name.as_deref(),
            )
            .await
            {
                Ok(()) => {
                    mark_announce_sent(&last_announce_at);
                    tracing::info!("LXMF delivery startup announce sent");
                }
                Err(e) => tracing::warn!("LXMF delivery startup announce failed: {e}"),
            }
        }

        loop {
            let interval_sec = read_announce_interval_sec(&config_dir);
            if interval_sec == 0 {
                // Startup-only: sleep indefinitely; manual POST /api/v1/announces still works.
                tokio::time::sleep(Duration::from_secs(86_400)).await;
                continue;
            }
            tokio::time::sleep(Duration::from_secs(u64::from(interval_sec))).await;
            let display_name = {
                let state = inner.read().await;
                resolve_announce_display_name(&state)
            };
            match send_lxmf_delivery_announce(
                &transport_tx,
                &identity,
                lxmf_dest_hash,
                display_name.as_deref(),
            )
            .await
            {
                Ok(()) => {
                    mark_announce_sent(&last_announce_at);
                    tracing::debug!(interval_sec, "LXMF delivery periodic announce sent");
                }
                Err(e) => tracing::warn!("LXMF delivery periodic announce failed: {e}"),
            }
        }
    });
}

fn read_announce_interval_sec(config_dir: &Path) -> u32 {
    config::get_stack_settings(config_dir)
        .map(|s| s.announce_interval_sec)
        .unwrap_or(config::DEFAULT_ANNOUNCE_INTERVAL_SEC)
}

/// Register `lxmf.delivery` + LinkManager and feed inbound LXMF into the router callback.
///
/// Wires Direct/resource channels **and** `set_inbound_raw_channel` (lxmd parity) so
/// opportunistic packets from Python clients (Sideband, Columba) are not dropped after
/// LinkManager decrypts/proves them.
pub fn spawn_lxmf_inbound_receiver(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: &Identity,
    lxmf_dest_hash: [u8; 16],
    router: Arc<TokioMutex<LxmRouter>>,
) {
    let delivery_rx = register_destination(&transport_tx, lxmf_dest_hash, LXMF_APP);
    // Unbounded: rsReticulum LinkManager::set_link_packet_channel requires UnboundedSender.
    // Bound only if upstream grows a bounded setter; do not buffer-copy into a second queue.
    let (link_packet_tx, mut link_packet_rx) = mpsc::unbounded_channel::<(Vec<u8>, [u8; 16])>();
    let (resource_tx, mut resource_rx) = mpsc::channel::<(Vec<u8>, [u8; 16])>(256);
    // Bounded: opportunistic bursts from hubs; drop-oldest via try_send on the LinkManager side.
    let (inbound_raw_tx, mut inbound_raw_rx) = mpsc::channel::<Vec<u8>>(256);

    let identity_for_raw = identity.clone();
    let mut link_mgr = LinkManager::with_destination(
        transport_tx,
        delivery_rx,
        identity,
        LXMF_APP,
        identity.get_signing_key(),
    );
    link_mgr.set_link_packet_channel(link_packet_tx);
    link_mgr.set_resource_completed_channel(resource_tx);
    link_mgr.set_inbound_raw_channel(inbound_raw_tx);

    tokio::spawn(async move {
        link_mgr.run().await;
    });

    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some((plaintext, link_id)) = link_packet_rx.recv() => {
                    tracing::debug!(
                        link_id = %hex::encode(link_id),
                        len = plaintext.len(),
                        "LXMF inbound link packet"
                    );
                    handle_link_delivered_data(&router, lxmf_dest_hash, &plaintext).await;
                }
                Some((data, link_id)) = resource_rx.recv() => {
                    tracing::debug!(
                        link_id = %hex::encode(link_id),
                        len = data.len(),
                        "LXMF inbound resource completed"
                    );
                    handle_link_delivered_data(&router, lxmf_dest_hash, &data).await;
                }
                Some(raw) = inbound_raw_rx.recv() => {
                    tracing::debug!(len = raw.len(), "LXMF inbound opportunistic packet");
                    handle_opportunistic_raw_packet(&router, &identity_for_raw, lxmf_dest_hash, &raw)
                        .await;
                }
                else => break,
            }
        }
    });
}

/// Prepend `lxmf_dest_hash` when the sender omitted it (Python opportunistic strips dest hash).
pub(crate) fn prepend_lxmf_dest_hash_if_needed(lxmf_dest_hash: [u8; 16], data: &[u8]) -> Vec<u8> {
    if data.len() >= 16 && data[..16] == lxmf_dest_hash {
        data.to_vec()
    } else {
        let mut full = lxmf_dest_hash.to_vec();
        full.extend_from_slice(data);
        full
    }
}

/// Decrypt an opportunistic DATA packet payload (after RNS header) with the local identity.
///
/// LinkManager already decrypts once to emit an RNS proof; we decrypt again from the raw
/// frame (same as lxmd `decrypt_inbound`) because the raw channel forwards ciphertext.
pub(crate) fn decrypt_opportunistic_payload(identity: &Identity, raw: &[u8]) -> Option<Vec<u8>> {
    let (header, data_offset) = PacketHeader::unpack(raw).ok()?;
    if header.flags.packet_type != PacketType::Data {
        return None;
    }
    let payload = raw.get(data_offset..)?;
    if payload.is_empty() {
        return None;
    }
    identity.decrypt(payload, None, false).ok()
}

async fn deliver_unpacked_lxmf(router: &Arc<TokioMutex<LxmRouter>>, msg: &LxMessage, via: &str) {
    tracing::debug!(
        from = %hex::encode(msg.source_hash),
        len = msg.content.len(),
        via,
        "inbound LXMF message"
    );
    let router = router.lock().await;
    if let Some(ref cb) = router.delivery_callback {
        cb(msg);
    }
}

async fn handle_link_delivered_data(
    router: &Arc<TokioMutex<LxmRouter>>,
    lxmf_dest_hash: [u8; 16],
    data: &[u8],
) {
    if data.is_empty() {
        return;
    }
    let unpack_data = prepend_lxmf_dest_hash_if_needed(lxmf_dest_hash, data);
    let msg = match LxMessage::unpack(&unpack_data) {
        Ok(msg) => msg,
        Err(e) => {
            rate_limited_unpack_warn(&e.to_string(), unpack_data.len());
            return;
        }
    };
    deliver_unpacked_lxmf(router, &msg, "link").await;
}

async fn handle_opportunistic_raw_packet(
    router: &Arc<TokioMutex<LxmRouter>>,
    identity: &Identity,
    lxmf_dest_hash: [u8; 16],
    raw: &[u8],
) {
    let Some(plaintext) = decrypt_opportunistic_payload(identity, raw) else {
        tracing::debug!(len = raw.len(), "opportunistic LXMF decrypt failed");
        return;
    };
    let unpack_data = prepend_lxmf_dest_hash_if_needed(lxmf_dest_hash, &plaintext);
    let msg = match LxMessage::unpack(&unpack_data) {
        Ok(msg) => msg,
        Err(e) => {
            rate_limited_unpack_warn(&e.to_string(), unpack_data.len());
            return;
        }
    };
    deliver_unpacked_lxmf(router, &msg, "opportunistic").await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use lxmf_core::constants::DeliveryMethod;
    use rns_identity::destination::Destination;
    use rns_identity::identity::Identity;
    use rns_wire::flags::PacketType;

    #[test]
    fn build_announce_packet_is_non_empty_announce() {
        let identity = Identity::new();
        let lxmf_hash = Destination::hash_from_name_and_identity(LXMF_APP, Some(&identity.hash));
        let raw =
            build_lxmf_delivery_announce_packet(&identity, lxmf_hash, Some("Test Peer")).unwrap();
        assert!(raw.len() > 16);
    }

    #[test]
    fn build_announce_allows_nil_display_name() {
        let identity = Identity::new();
        let lxmf_hash = Destination::hash_from_name_and_identity(LXMF_APP, Some(&identity.hash));
        let raw = build_lxmf_delivery_announce_packet(&identity, lxmf_hash, None).unwrap();
        assert!(raw.len() > 16);
    }

    #[test]
    fn propagation_sync_announce_settle_is_two_seconds() {
        assert_eq!(PROPAGATION_SYNC_ANNOUNCE_SETTLE, Duration::from_secs(2));
    }

    #[test]
    fn prepend_lxmf_dest_hash_skips_when_already_present() {
        let dest = [0x11; 16];
        let mut body = dest.to_vec();
        body.extend_from_slice(b"lxm-body");
        let out = prepend_lxmf_dest_hash_if_needed(dest, &body);
        assert_eq!(out, body);
    }

    #[test]
    fn prepend_lxmf_dest_hash_adds_when_python_stripped() {
        let dest = [0x22; 16];
        let body = b"stripped-lxm-body";
        let out = prepend_lxmf_dest_hash_if_needed(dest, body);
        assert_eq!(&out[..16], &dest);
        assert_eq!(&out[16..], body);
    }

    #[test]
    fn opportunistic_raw_decrypts_and_unpacks_python_stripped_payload() {
        let recipient = Identity::new();
        let sender = Identity::new();
        let lxmf_hash = Destination::hash_from_name_and_identity(LXMF_APP, Some(&recipient.hash));
        let sender_lxmf = Destination::hash_from_name_and_identity(LXMF_APP, Some(&sender.hash));

        let mut msg = LxMessage::new(
            lxmf_hash,
            sender_lxmf,
            "",
            "hello from sideband",
            DeliveryMethod::Opportunistic,
        );
        msg.sign(
            sender
                .get_signing_key()
                .as_ref()
                .expect("sender signing key"),
        )
        .unwrap();
        let packed = msg.pack().unwrap();
        // Python opportunistic delivery encrypts the LXM body *without* leading dest hash.
        assert!(packed.len() > 16 && packed[..16] == lxmf_hash);
        let stripped = &packed[16..];

        let ciphertext = recipient.encrypt(stripped, None).unwrap();
        let header = PacketHeader {
            flags: PacketFlags {
                header_type: HeaderType::Header1,
                context_flag: false,
                transport_type: TransportType::Broadcast,
                destination_type: DestinationType::Single,
                packet_type: PacketType::Data,
            },
            hops: 0,
            transport_id: None,
            destination_hash: lxmf_hash,
            context: PacketContext::None,
        };
        let mut raw = header.pack();
        raw.extend_from_slice(&ciphertext);

        let plaintext = decrypt_opportunistic_payload(&recipient, &raw).expect("decrypt");
        assert_eq!(plaintext, stripped);

        let unpack_data = prepend_lxmf_dest_hash_if_needed(lxmf_hash, &plaintext);
        let recovered = LxMessage::unpack(&unpack_data).expect("unpack");
        assert_eq!(recovered.content, "hello from sideband");
        assert_eq!(recovered.source_hash, sender_lxmf);
        assert_eq!(recovered.destination_hash, lxmf_hash);
    }

    #[test]
    fn inbound_receiver_source_wires_opportunistic_raw_channel() {
        // Guard against regressing to link-only inbound (drops Sideband/Columba opportunistic).
        let src = include_str!("lxmf_delivery.rs");
        assert!(
            src.contains("set_inbound_raw_channel"),
            "spawn_lxmf_inbound_receiver must wire set_inbound_raw_channel (lxmd parity)"
        );
        assert!(
            src.contains("handle_opportunistic_raw_packet"),
            "opportunistic raw packets must be delivered to the LXMF router"
        );
    }
}
