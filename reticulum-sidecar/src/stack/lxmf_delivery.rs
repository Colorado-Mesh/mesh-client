//! LXMF delivery destination announce + inbound link receive (Ratspeak/lxmd parity).

use std::path::Path;
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

/// Skip re-announce for periodic/manual paths when a delivery announce was sent this recently.
/// Remote propagation Sync always announces (no debounce); see `LiveStack::ensure_lxmf_announce_for_propagation_sync`.
pub const LXMF_ANNOUNCE_DEBOUNCE: Duration = Duration::from_secs(30);

/// Brief pause after a successful pre-sync LXMF announce so hubs can flood the reverse path
/// before LinkRequest (matches the effective delay of “Announce now, then Sync”).
pub const PROPAGATION_SYNC_ANNOUNCE_SETTLE: Duration = Duration::from_secs(2);

/// Whether a fresh LXMF delivery announce should be sent given the last send time.
pub fn should_send_debounced_announce(
    last: Option<Instant>,
    now: Instant,
    window: Duration,
) -> bool {
    match last {
        None => true,
        Some(t) => now.saturating_duration_since(t) >= window,
    }
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

/// Register `lxmf.delivery` + LinkManager and feed decrypted link/resource data into the router callback.
pub fn spawn_lxmf_inbound_receiver(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: &Identity,
    lxmf_dest_hash: [u8; 16],
    router: Arc<TokioMutex<LxmRouter>>,
) {
    let delivery_rx = register_destination(&transport_tx, lxmf_dest_hash, LXMF_APP);
    let (link_packet_tx, mut link_packet_rx) = mpsc::channel::<(Vec<u8>, [u8; 16])>(256);
    let (resource_tx, mut resource_rx) = mpsc::channel::<(Vec<u8>, [u8; 16])>(256);

    let mut link_mgr = LinkManager::with_destination(
        transport_tx,
        delivery_rx,
        identity,
        LXMF_APP,
        identity.get_signing_key(),
    );
    link_mgr.set_link_packet_channel(link_packet_tx);
    link_mgr.set_resource_completed_channel(resource_tx);

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
                else => break,
            }
        }
    });
}

async fn handle_link_delivered_data(
    router: &Arc<TokioMutex<LxmRouter>>,
    lxmf_dest_hash: [u8; 16],
    data: &[u8],
) {
    if data.is_empty() {
        return;
    }
    let unpack_data = if data.len() >= 16 && data[..16] == lxmf_dest_hash {
        data.to_vec()
    } else {
        let mut full = lxmf_dest_hash.to_vec();
        full.extend_from_slice(data);
        full
    };
    let msg = match LxMessage::unpack(&unpack_data) {
        Ok(msg) => msg,
        Err(e) => {
            tracing::debug!("link data not an LXMF message: {e}");
            return;
        }
    };
    tracing::info!(
        from = %hex::encode(msg.source_hash),
        len = msg.content.len(),
        "inbound LXMF message via link"
    );
    let router = router.lock().await;
    if let Some(ref cb) = router.delivery_callback {
        cb(&msg);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rns_identity::destination::Destination;
    use rns_identity::identity::Identity;

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
    fn debounced_announce_skips_within_window() {
        let now = Instant::now();
        assert!(should_send_debounced_announce(
            None,
            now,
            LXMF_ANNOUNCE_DEBOUNCE
        ));
        assert!(!should_send_debounced_announce(
            Some(now),
            now + Duration::from_secs(10),
            LXMF_ANNOUNCE_DEBOUNCE
        ));
        assert!(should_send_debounced_announce(
            Some(now),
            now + Duration::from_secs(31),
            LXMF_ANNOUNCE_DEBOUNCE
        ));
    }

    #[test]
    fn propagation_sync_announce_settle_is_two_seconds() {
        assert_eq!(PROPAGATION_SYNC_ANNOUNCE_SETTLE, Duration::from_secs(2));
    }
}
