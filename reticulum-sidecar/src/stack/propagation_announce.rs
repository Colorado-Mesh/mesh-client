//! Periodic `lxmf.propagation` announces for local PN hosting.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use lxmf_core::handlers::{PropagationNodeAnnounceData, get_propagation_node_app_data};
use rns_identity::announce::AnnounceData;
use rns_identity::identity::Identity;
use rns_transport::messages::{OutboundRequest, TransportMessage};
use rns_wire::context::PacketContext;
use rns_wire::flags::{DestinationType, HeaderType, PacketFlags, PacketType, TransportType};
use rns_wire::header::PacketHeader;
use tokio::sync::mpsc;

use super::pn_hosting_policy::PnHostingPolicy;
use super::propagation_serve::LXMF_PROPAGATION_APP;

pub fn build_propagation_announce_packet(
    identity: &Identity,
    propagation_dest_hash: [u8; 16],
    policy: &PnHostingPolicy,
    node_state: bool,
) -> Result<Vec<u8>, String> {
    let mut pn_data = PropagationNodeAnnounceData::new(
        node_state && !policy.from_static_only,
        policy.propagation_limit_kb as u64,
        policy.sync_limit_kb as u64,
        policy.propagation_stamp_cost,
        policy.propagation_stamp_flex,
        policy.peering_cost,
    );
    if let Some(ref name) = policy.node_name {
        pn_data.set_name(name);
    }
    let app_data = get_propagation_node_app_data(&pn_data);
    let announce = AnnounceData::create(
        identity,
        LXMF_PROPAGATION_APP,
        Some(app_data.as_slice()),
        None,
    )
    .map_err(|e| format!("Failed to create propagation announce: {e}"))?;
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
        destination_hash: propagation_dest_hash,
        context: PacketContext::None,
    };
    let mut raw = header.pack();
    raw.extend_from_slice(&announce.pack());
    Ok(raw)
}

pub async fn send_propagation_announce(
    transport_tx: &mpsc::Sender<TransportMessage>,
    identity: &Identity,
    propagation_dest_hash: [u8; 16],
    policy: &PnHostingPolicy,
    node_state: bool,
) -> Result<(), String> {
    let raw =
        build_propagation_announce_packet(identity, propagation_dest_hash, policy, node_state)?;
    transport_tx
        .send(TransportMessage::Outbound(OutboundRequest {
            raw: Bytes::from(raw),
            destination_hash: propagation_dest_hash,
        }))
        .await
        .map_err(|e| format!("Failed to send propagation announce: {e}"))
}

pub struct PropagationAnnounceLoop {
    running: AtomicBool,
    stop_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl PropagationAnnounceLoop {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            stop_tx: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = self.stop_tx.lock()
            && let Some(tx) = slot.take()
        {
            let _ = tx.send(());
        }
    }

    pub fn start(
        &self,
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: Identity,
        propagation_dest_hash: [u8; 16],
        policy: Arc<Mutex<PnHostingPolicy>>,
        announce_at_start: bool,
    ) {
        self.stop();
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        if let Ok(mut slot) = self.stop_tx.lock() {
            *slot = Some(stop_tx);
        }
        self.running.store(true, Ordering::SeqCst);

        tokio::spawn(async move {
            if announce_at_start {
                let snap = policy.lock().ok().map(|p| p.clone()).unwrap_or_default();
                if let Err(e) = send_propagation_announce(
                    &transport_tx,
                    &identity,
                    propagation_dest_hash,
                    &snap,
                    true,
                )
                .await
                {
                    tracing::warn!(target: "propagation-announce", "startup announce failed: {e}");
                }
            }

            loop {
                let interval_sec = policy
                    .lock()
                    .ok()
                    .map(|p| p.pn_announce_interval_sec)
                    .unwrap_or(360);
                let wait = if interval_sec == 0 {
                    Duration::from_secs(360)
                } else {
                    Duration::from_secs(u64::from(interval_sec))
                };
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {
                        if interval_sec == 0 {
                            continue;
                        }
                        let snap = policy.lock().ok().map(|p| p.clone()).unwrap_or_default();
                        if let Err(e) = send_propagation_announce(
                            &transport_tx,
                            &identity,
                            propagation_dest_hash,
                            &snap,
                            true,
                        )
                        .await
                        {
                            tracing::warn!(target: "propagation-announce", "periodic announce failed: {e}");
                        }
                    }
                    _ = &mut stop_rx => {
                        let snap = policy.lock().ok().map(|p| p.clone()).unwrap_or_default();
                        let _ = send_propagation_announce(
                            &transport_tx,
                            &identity,
                            propagation_dest_hash,
                            &snap,
                            false,
                        )
                        .await;
                        break;
                    }
                }
            }
        });
    }
}

impl Default for PropagationAnnounceLoop {
    fn default() -> Self {
        Self::new()
    }
}
