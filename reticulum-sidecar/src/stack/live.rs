//! Live rsReticulum bridge (optional runtime queries + LXMF send/receive).

#[path = "lxmf_outbound.rs"]
mod lxmf_outbound;
#[path = "pn_cascade.rs"]
mod pn_cascade;

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lxmf_core::constants::{
    AM_OPUS_OGG, DeliveryMethod, FIELD_FILE_ATTACHMENTS, FIELD_ICON_APPEARANCE, FIELD_REACTION,
    REACTION_CONTENT, REACTION_TO,
};
use lxmf_core::message::LxMessage;

/// Upstream LXMF 1.0.0 reply-to (`LXMF.py`); not yet named in rsLXMF constants.
const FIELD_REPLY_TO: u8 = 0x30;
/// Optional UTF-8 quoted parent text for clients that lack the parent message.
const FIELD_REPLY_QUOTE: u8 = 0x31;
/// Cap wire quote length (matches renderer `REPLY_PREVIEW_MAX_LEN` without ellipsis).
const REPLY_QUOTE_MAX_CHARS: usize = 50;
/// lxmf-core per-field unpack limit — audio above this cannot be received by peers.
const MAX_LXMF_AUDIO_FIELD_BYTES: usize = 256 * 1024;
use lxmf_core::peer::OutboundOfferPolicy;
use lxmf_core::router::LxmRouter;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_runtime::lifecycle::ShutdownSignal;
use rns_runtime::link_client::LinkClient;
use rns_runtime::reticulum;
use rns_transport::messages::{
    AnnounceHandlerEvent, PathTableRpcEntry, TransportMessage, TransportQuery,
    TransportQueryResponse,
};
use tokio::sync::{RwLock, broadcast};

use super::StackHandle;
use super::announce_ws_coalesce::{
    AnnounceWsCoalescer, AnnounceWsRow, build_announce_received_frame, resolve_announce_aspect,
};
use super::config;
use super::games_session::GamesSessionManager;
use super::local_rnode_primary;
use super::lxmf_delivery::{
    LXMF_APP, PROPAGATION_SYNC_ANNOUNCE_SETTLE, send_lxmf_delivery_announce,
    spawn_lxmf_announce_loop, spawn_lxmf_inbound_receiver, spawn_lxmf_outbound_backchannel,
};
use super::nomad_file::nomad_file_name_from_path;
use super::nomad_link_errors::map_nomad_link_error;
use super::nomad_request_payload::nomad_page_request_payload;
use super::nomad_server::NomadServerHandle;
use super::nomad_timeouts;
use super::packet_log::{
    PacketLogBuffer, collect_tx_interface_names_for_egress, wire_packet_from_tap,
};
use super::path_failover::{
    self, PathSlotCandidate, active_via_hash_from_slots, live_interface_names,
    record_path_failover_attempt, remaining_live_ifaces, select_unblocked_slot,
    should_attempt_nomad_via_failover, should_attempt_propagation_via_failover, via_prefix,
};
use super::path_medium::{self, PathMediumPreferenceSetting, PathMediumSetting};
use super::path_speed;
use super::persistence::PersistedState;
use super::pn_hosting_apply::{apply_pn_hosting_policy_to_node, apply_pn_hosting_policy_to_router};
use super::pn_hosting_policy::PnHostingPolicy;
use super::propagation_announce::PropagationAnnounceLoop;
use super::propagation_bridge::PropagationBridge;
use super::propagation_download::ClientDownloadPoll;
use super::propagation_serve::PropagationServeHandle;
use super::rncp_transfer::RncpTransferManager;
use super::rnsh_session::RnshSessionManager;
use super::rrc_defaults::RRC_HUB_ASPECT;
use super::rrc_session::RrcSessionManager;
use super::types::NomadServingStatus;
use super::types::{ContactRow, InterfaceRow, LxmfReactionRequest, LxmfSendRequest, PeerRow};
use super::via::{
    classify_path_interface_name, merge_live_interfaces_with_config, merge_observed_egress_vias,
    resolve_lxmf_sent_via,
};
use super::voice_session::VoiceSessionManager;
use lxmf_outbound::{LxmfOutboundDriver, PathTableRoute};

/// Settle window for PacketTap Tx correlation after LXMF enqueue.
const LXMF_EGRESS_TAP_SETTLE_MS: u64 = 1500;

/// Cap blocking transport control queries so HTTP handlers return cached state
/// before the Electron IPC proxy GET timeout (10s default).
const TRANSPORT_QUERY_TIMEOUT: Duration = Duration::from_secs(20);

/// lxmd `last_propagation_check` parity: Host-serving silent client `/get` when
/// the local store is quiet (inbox catch-up from peered remotes).
const HOST_PERIODIC_GET_INTERVAL: Duration = Duration::from_secs(90);

/// Aspect Nomad Network nodes announce and serve page/file requests under.
const NOMAD_NODE_ASPECT: &str = "nomadnetwork.node";

#[cfg(feature = "rns-ble")]
struct BlePeerRuntimeState {
    spawned: HashMap<String, u64>,
    foreground_wake: Arc<tokio::sync::Notify>,
}

/// Map GetInterfaceStats TX fill into API Option fields.
/// Offline interfaces and zero-capacity queues stay unset (unavailable).
pub(crate) fn live_interface_tx_queue_fields(
    online: bool,
    tx_queue_used: u64,
    tx_queue_max: u64,
) -> (Option<u64>, Option<u64>) {
    if !online || tx_queue_max == 0 {
        (None, None)
    } else {
        (Some(tx_queue_used), Some(tx_queue_max))
    }
}

/// Live `GetInterfaceStats.mode` is only meaningful while the interface is online.
pub(crate) fn live_interface_runtime_mode_if_online(online: bool, mode: &str) -> Option<String> {
    if online {
        config::live_interface_runtime_mode(mode)
    } else {
        None
    }
}

pub struct LiveBridge {
    config_dir: PathBuf,
    storage_dir: PathBuf,
    handle: reticulum::ReticulumHandle,
    _shutdown: ShutdownSignal,
    router: Arc<tokio::sync::Mutex<LxmRouter>>,
    identity: Identity,
    lxmf_hash_hex: String,
    display_name: String,
    peer_via_cache: Arc<Mutex<HashMap<String, String>>>,
    /// Maintained path-table snapshot from the 2s maintenance tick (or forced fetch).
    path_peer_cache: Arc<Mutex<Vec<PeerRow>>>,
    path_peer_cache_fetched_at: Arc<Mutex<Option<Instant>>>,
    display_name_cache: Arc<Mutex<HashMap<String, String>>>,
    outbound: Arc<Mutex<LxmfOutboundDriver>>,
    propagation: Arc<PropagationBridge>,
    prop_serve: Arc<PropagationServeHandle>,
    prop_announce: Arc<PropagationAnnounceLoop>,
    pn_hosting_policy: Arc<Mutex<PnHostingPolicy>>,
    /// Per-run cancel token; replaced on each new sync so stale emitters cannot reset it.
    sync_cancel: Mutex<Arc<AtomicBool>>,
    /// Generation for the active sync emitter; stale emitters must not cancel/clear pins.
    sync_run_id: Arc<AtomicU64>,
    /// In-memory heard `lxmf.propagation` announces (not auto-configured).
    discovered_propagation: Arc<Mutex<HashMap<String, super::DiscoveredPropagationRow>>>,
    /// Last successful LXMF delivery announce (startup / periodic / manual / sync debounce).
    last_lxmf_announce_at: Arc<Mutex<Option<Instant>>>,
    event_tx: broadcast::Sender<String>,
    packet_log: Arc<PacketLogBuffer>,
    /// Recent inbound LXMF for WS catch-up (shared with StackHandle). Held so the
    /// delivery callback Arc stays alive for the lifetime of the bridge.
    #[allow(dead_code)]
    inbound_lxmf: Arc<super::lxmf_inbound_log::LxmfInboundBuffer>,
    /// Serialize Nomad Link queries — transport actor is single-threaded and
    /// overlapping page/file fetches contend with path/pubkey discovery.
    nomad_link_lock: Arc<tokio::sync::Mutex<()>>,
    /// Cancel in-flight Nomad Link when a newer page selection arrives (renderer
    /// debounce coalesces clicks; leaving the Nomad tab does not cancel).
    nomad_link_cancel: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
    nomad_link_generation: Arc<AtomicU64>,
    rrc_session: Arc<RrcSessionManager>,
    rnsh_session: Arc<RnshSessionManager>,
    rncp_transfer: Arc<RncpTransferManager>,
    voice_session: Arc<VoiceSessionManager>,
    games_session: Arc<GamesSessionManager>,
    /// Local Nomad page/file host (rsNomad / nomad-core).
    nomad_server: Arc<NomadServerHandle>,
    /// Shared persisted stack state (Nomad node list, prefs).
    persisted: Arc<RwLock<PersistedState>>,
    #[cfg(feature = "rns-ble")]
    ble_peer_state: Arc<tokio::sync::Mutex<BlePeerRuntimeState>>,
}

impl LiveBridge {
    /// Orderly RNS drain so BLE RNode tasks detach (radio-off) before process kill.
    pub async fn prepare_stop(&self) {
        tracing::info!("prepare_stop: shutting down RNS runtime for graceful BLE detach");
        self.handle.shutdown_and_wait().await;
    }

    fn primary_local_serial_id(&self) -> Option<String> {
        let state = PersistedState::load(&self.config_dir, &self.storage_dir);
        let config_ifaces =
            config::interfaces_from_config_dir(&self.config_dir).unwrap_or_default();
        local_rnode_primary::resolve_effective_primary_local_serial_interface_id(
            &config_ifaces,
            state.primary_local_serial_interface_id.as_deref(),
        )
    }

    fn path_interface_for_hash(&self, destination_hash: &str) -> Option<String> {
        self.peer_via_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(destination_hash).cloned())
            .filter(|name| !name.is_empty())
    }

    fn resolve_lxmf_egress_via(
        &self,
        ifaces: &[InterfaceRow],
        path_hash: &str,
        delivery_method: DeliveryMethod,
        preferred_pn_hash: Option<&str>,
    ) -> String {
        let path_iface = match delivery_method {
            DeliveryMethod::Propagated => preferred_pn_hash
                .and_then(|pn| self.path_interface_for_hash(pn))
                .or_else(|| self.path_interface_for_hash(path_hash)),
            _ => self.path_interface_for_hash(path_hash),
        };
        resolve_lxmf_sent_via(
            path_iface.as_deref(),
            ifaces,
            self.primary_local_serial_id().as_deref(),
        )
    }

    fn schedule_egress_tap_upgrade(
        &self,
        message_hash: String,
        to_hash: String,
        preferred_pn_hash: Option<String>,
        initial_via: String,
        interfaces: Vec<InterfaceRow>,
        since_ts_ms: u64,
    ) {
        let packet_log = self.packet_log.clone();
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(LXMF_EGRESS_TAP_SETTLE_MS)).await;
            let rows = packet_log.snapshot(256);
            let mut dests: Vec<&str> = vec![to_hash.as_str()];
            if let Some(ref pn) = preferred_pn_hash {
                dests.push(pn.as_str());
            }
            let iface_names = collect_tx_interface_names_for_egress(&rows, since_ts_ms, &dests);
            if iface_names.is_empty() {
                return;
            }
            let observed: Vec<&str> = iface_names
                .iter()
                .map(|name| classify_path_interface_name(name, &interfaces))
                .collect();
            let mut atoms: Vec<&str> = initial_via.split('+').filter(|p| !p.is_empty()).collect();
            atoms.extend(observed.iter().copied());
            let merged = merge_observed_egress_vias(atoms);
            if merged == initial_via {
                return;
            }
            lxmf_outbound::emit_outbound_egress_via(
                &event_tx,
                &message_hash,
                Some(&to_hash),
                &merged,
            );
        });
    }
}

impl LiveBridge {
    pub async fn spawn(
        config_dir: PathBuf,
        storage_dir: PathBuf,
        event_tx: broadcast::Sender<String>,
        packet_log: Arc<PacketLogBuffer>,
        inbound_lxmf: Arc<super::lxmf_inbound_log::LxmfInboundBuffer>,
        inner: Arc<RwLock<PersistedState>>,
    ) -> Result<Self, String> {
        let config_str = config_dir
            .to_str()
            .ok_or("invalid config dir path")?
            .to_string();
        let shutdown = ShutdownSignal::new();
        let is_foreground = Arc::new(AtomicBool::new(true));
        let handle = reticulum::init(Some(&config_str), None, shutdown.clone(), is_foreground)
            .await
            .map_err(|e| format!("RNS init failed: {e:?}"))?;

        handle
            .enable_on_network_discovery(Arc::new(
                lxmf_core::discovery_stamper::LxmfDiscoveryStamper::default(),
            ))
            .await;

        let (tap_tx, mut tap_rx) = broadcast::channel(256);
        handle.register_packet_tap(tap_tx).await;
        let packet_log_tap = packet_log.clone();
        // Keep PacketLogBuffer for GET /api/v1/packets + egress evidence, but do NOT emit
        // wire_packet on the shared event bus — that starves lxmf_message under large meshes.
        tokio::spawn(async move {
            loop {
                match tap_rx.recv().await {
                    Ok(evt) => {
                        let row = wire_packet_from_tap(&evt);
                        packet_log_tap.push(row);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        let identity_path = crate::stack::identity_apply::identity_file_path(&config_dir);
        let identity_configured = inner.read().await.identity.configured;
        let identity = if identity_path.exists() {
            rns_identity::identity::Identity::from_file(&identity_path)
                .map_err(|e| format!("load identity: {e}"))?
        } else if identity_configured {
            return Err("identity file missing; re-import or generate identity".into());
        } else {
            return Err("identity not configured for live stack".into());
        };

        let lxmf_dest_hash =
            Destination::hash_from_name_and_identity(LXMF_APP, Some(&identity.hash));
        // Offline inbox / PN identity is lxmf.propagation — not the delivery destination.
        let lxmf_propagation_dest_hash =
            Destination::hash_from_name_and_identity("lxmf.propagation", Some(&identity.hash));
        let lxmf_hash_hex = hex::encode(lxmf_dest_hash);
        let display_name = inner
            .read()
            .await
            .identity
            .display_name
            .clone()
            .unwrap_or_else(|| "Self".into());

        let peer_via_cache: Arc<Mutex<HashMap<String, String>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let path_peer_cache: Arc<Mutex<Vec<PeerRow>>> = Arc::new(Mutex::new(Vec::new()));
        let path_peer_cache_fetched_at: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let display_name_cache: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new({
            let state = inner.read().await;
            contacts_to_name_map(&state.contacts)
        }));

        let pn_hosting_policy = {
            let state = inner.read().await;
            state.pn_hosting_policy.clone()
        };
        let mut router = LxmRouter::new(lxmf_core::router::RouterConfig::default());
        apply_pn_hosting_policy_to_router(&mut router, &pn_hosting_policy);
        router.set_transport(handle.transport_tx.clone());

        let games_session = Arc::new(GamesSessionManager::spawn(
            &storage_dir,
            lxmf_hash_hex.clone(),
            event_tx.clone(),
        ));
        spawn_games_lxmf_outbound_bridge(games_session.clone(), event_tx.subscribe());

        let cache_for_cb = peer_via_cache.clone();
        let name_cache_for_cb = display_name_cache.clone();
        let event_tx_cb = event_tx.clone();
        let inbound_lxmf_cb = inbound_lxmf.clone();
        let self_hash_cb = lxmf_hash_hex.clone();
        let self_name_cb = display_name.clone();
        let config_dir_for_cb = config_dir.clone();
        let games_session_cb = games_session.clone();
        router.register_delivery_callback(move |msg| {
            if !msg.incoming {
                return;
            }
            let sender_hex = hex::encode(msg.source_hash);
            if games_session_cb.handle_inbound_lxmf(&msg.fields, &sender_hex, &msg.content) {
                return;
            }
            // Match path-table iface name to local config (same as outbound) so
            // TCP hubs named e.g. "RNS Testnet" classify as tcp, not network.
            let received_via = if msg.method == DeliveryMethod::Paper {
                "paper".to_string()
            } else {
                cache_for_cb
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(&sender_hex).cloned())
                    .map(|iface_name| {
                        let config_rows = config::interfaces_from_config_dir(&config_dir_for_cb)
                            .unwrap_or_default();
                        classify_path_interface_name(&iface_name, &config_rows).to_string()
                    })
                    .unwrap_or_else(|| "network".into())
            };
            let inbound_sender_name = name_cache_for_cb
                .lock()
                .ok()
                .map(|cache| resolve_inbound_sender_name_map(&cache, &sender_hex))
                .unwrap_or_else(|| sender_hex.get(..12).unwrap_or(&sender_hex).to_string());
            let payload = lxmf_payload_from_message(
                msg,
                &self_hash_cb,
                &self_name_cb,
                Some(&received_via),
                None,
                "inbound",
                Some(&inbound_sender_name),
            );
            // Buffer before WS emit so lag/reconnect can catch up via GET /api/v1/lxmf/recent.
            // Stamp `ring_seq` on accepted rows so live watermark and catch-up share a cursor.
            // Deduped / lock-failed pushes return None — still emit the original payload.
            let payload = inbound_lxmf_cb.push(payload.clone()).unwrap_or(payload);
            let message_hash = payload
                .get("message_hash")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let transient_id_hex = msg
                .transient_id
                .as_ref()
                .map(hex::encode)
                .unwrap_or_default();
            if msg.method == DeliveryMethod::Propagated {
                let from_prefix = sender_hex.get(..12).unwrap_or(&sender_hex);
                tracing::debug!(
                    target: "propagation-retrieve",
                    message_hash = %message_hash,
                    transient_id = %transient_id_hex,
                    from_prefix = %from_prefix,
                    "inbound LXMF delivered via propagation"
                );
            }
            // Rate-limited warn so developer bundles can prove sidecar receipt without spam.
            rate_limited_inbound_lxmf_warn(&sender_hex, message_hash);
            // Contacts are manual-only in mesh-client; do not upsert on inbound LXMF.
            emit_lxmf_event(&event_tx_cb, payload);
        });

        let router = Arc::new(tokio::sync::Mutex::new(router));
        spawn_lxmf_inbound_receiver(
            handle.transport_tx.clone(),
            &identity,
            lxmf_dest_hash,
            router.clone(),
        );
        let last_lxmf_announce_at = Arc::new(Mutex::new(None));
        spawn_lxmf_announce_loop(
            handle.transport_tx.clone(),
            identity.clone(),
            lxmf_dest_hash,
            config_dir.clone(),
            inner.clone(),
            Arc::clone(&last_lxmf_announce_at),
        );

        #[cfg(feature = "rns-ble")]
        let foreground_wake = Arc::new(tokio::sync::Notify::new());
        #[cfg(feature = "rns-ble")]
        {
            let event_tx_ble = event_tx.clone();
            let (ble_evt_tx, mut ble_evt_rx) = tokio::sync::mpsc::channel(64);
            rns_interface::ble_peer::install_event_dispatcher(ble_evt_tx);
            tokio::spawn(async move {
                while let Some(evt) = ble_evt_rx.recv().await {
                    let payload = serde_json::to_value(&evt).unwrap_or(serde_json::json!({}));
                    let msg = serde_json::json!({ "type": "ble_peer", "payload": payload });
                    let _ = event_tx_ble.send(msg.to_string());
                }
            });
        }

        // Outbound Direct reusable links ACK peer replies via LinkProof even when the
        // plaintext is not forwarded — wire set_inbound_packet_sender so backchannel
        // DATA reaches the same unpack path as peer-initiated lxmf.delivery links.
        let mut outbound_driver = LxmfOutboundDriver::new(
            handle.transport_tx.clone(),
            &identity,
            lxmf_hash_hex.clone(),
            display_name.clone(),
        );
        outbound_driver.set_inbound_packet_sender(spawn_lxmf_outbound_backchannel(
            lxmf_dest_hash,
            router.clone(),
        ));
        outbound_driver.set_propagation_max_message_size(
            pn_hosting_policy.propagation_limit_kb.saturating_mul(1024),
        );
        let outbound = Arc::new(Mutex::new(outbound_driver));

        let bridge = Self {
            config_dir: config_dir.clone(),
            storage_dir: storage_dir.clone(),
            handle: handle.clone(),
            _shutdown: shutdown,
            router,
            identity: identity.clone(),
            lxmf_hash_hex: lxmf_hash_hex.clone(),
            display_name: display_name.clone(),
            peer_via_cache,
            path_peer_cache,
            path_peer_cache_fetched_at,
            display_name_cache,
            outbound,
            propagation: {
                let prop = Arc::new(PropagationBridge::new(
                    handle.transport_tx.clone(),
                    lxmf_propagation_dest_hash,
                    storage_dir.join("propagation"),
                    &identity,
                    &pn_hosting_policy,
                )?);
                prop.spawn_messagestore_load();
                prop
            },
            prop_serve: Arc::new(PropagationServeHandle::new()),
            prop_announce: Arc::new(PropagationAnnounceLoop::new()),
            pn_hosting_policy: Arc::new(Mutex::new(pn_hosting_policy)),
            sync_cancel: Mutex::new(Arc::new(AtomicBool::new(false))),
            sync_run_id: Arc::new(AtomicU64::new(0)),
            discovered_propagation: Arc::new(Mutex::new(HashMap::new())),
            last_lxmf_announce_at,
            event_tx: event_tx.clone(),
            packet_log,
            inbound_lxmf,
            nomad_link_lock: Arc::new(tokio::sync::Mutex::new(())),
            nomad_link_cancel: Arc::new(tokio::sync::Mutex::new(None)),
            nomad_link_generation: Arc::new(AtomicU64::new(0)),
            rrc_session: Arc::new(RrcSessionManager::spawn(
                handle.transport_tx.clone(),
                identity.clone(),
                event_tx.clone(),
            )),
            rnsh_session: Arc::new(RnshSessionManager::spawn(
                handle.transport_tx.clone(),
                identity.clone(),
                event_tx.clone(),
            )),
            rncp_transfer: Arc::new(RncpTransferManager::spawn(
                handle.transport_tx.clone(),
                identity.clone(),
                event_tx.clone(),
                storage_dir.clone(),
                config_dir.clone(),
            )),
            voice_session: Arc::new(VoiceSessionManager::spawn(
                handle.transport_tx.clone(),
                &identity,
                event_tx.clone(),
            )),
            games_session,
            nomad_server: Arc::new(NomadServerHandle::new()),
            persisted: inner.clone(),
            #[cfg(feature = "rns-ble")]
            ble_peer_state: Arc::new(tokio::sync::Mutex::new(BlePeerRuntimeState {
                spawned: HashMap::new(),
                foreground_wake: foreground_wake.clone(),
            })),
        };

        // Mode Off keeps Preferred on disk but must not arm an outbound PN at stack start.
        let propagation_mode_off = inner.read().await.propagation_mode.is_off();
        let preferred_prop_hash = {
            let state = inner.read().await;
            if propagation_mode_off {
                None
            } else {
                state.preferred_propagation_id.as_ref().and_then(|id| {
                    state
                        .propagation
                        .iter()
                        .find(|p| p.id == *id)
                        .and_then(|p| p.destination_hash.clone())
                })
            }
        };

        bridge.spawn_maintenance(event_tx);

        // Local-prop serve/announce is deferred until messagestore load finishes
        // (see StackHandle::attach_live) so we do not advertise an empty PN.
        bridge.rehydrate_propagation_identities_from_persisted();
        // Keep persisted local-prop hash on lxmf.propagation (legacy rows stored delivery).
        {
            let mut state = inner.write().await;
            if let Some(node) = state.propagation.iter_mut().find(|p| p.id == "local-prop") {
                node.destination_hash = Some(bridge.propagation_local_hash());
            }
            let _ = state.save(&config_dir, &storage_dir);
        }

        if let Some(hash_hex) = preferred_prop_hash {
            bridge.set_outbound_propagation_node(Some(&hash_hex)).await;
        } else if propagation_mode_off {
            tracing::info!(
                target: "lxmf-outbound",
                "propagation mode off — no outbound propagation node armed at stack start"
            );
        } else {
            tracing::warn!(
                target: "lxmf-outbound",
                "no preferred propagation destination_hash at stack start — Direct→PN cascade remotes may be empty"
            );
        }
        bridge.refresh_pn_cascade_candidates().await;

        // BLE Peer sync is started from StackHandle::attach_live after HTTP is up.

        {
            let mut state = inner.write().await;
            state.rns_ready = true;
            state.lxmf_ready = true;
        }

        let (nomad_enabled, nomad_name, nomad_content_source) = {
            let state = inner.read().await;
            let name = state
                .nomad_serving_display_name
                .clone()
                .filter(|n| !n.trim().is_empty())
                .or_else(|| {
                    state
                        .identity
                        .display_name
                        .clone()
                        .filter(|n| !n.trim().is_empty() && n != "Self")
                })
                .unwrap_or_else(|| "Nomad node".into());
            (
                state.nomad_serving_enabled,
                name,
                state.nomad_serving_content_source.clone(),
            )
        };
        // Load remembered content folder before auto-restore so start uses it.
        match &nomad_content_source {
            Some(path) => {
                bridge
                    .nomad_server
                    .load_content_source_path(Some(std::path::PathBuf::from(path)))
                    .await;
            }
            None if nomad_enabled => {
                tracing::warn!(
                    "[nomad-serving] failed to restore Nomad serving: content_source_required"
                );
                bridge
                    .nomad_server
                    .set_last_error(Some("content_source_required".into()))
                    .await;
            }
            None => {}
        }
        if nomad_enabled && nomad_content_source.is_some() {
            if let Err(e) = bridge.start_nomad_serving(nomad_name).await {
                tracing::warn!("[nomad-serving] failed to restore Nomad serving: {e}");
                bridge.nomad_server.set_last_error(Some(e.clone())).await;
            }
        }

        // Restore the inbound rncp listener the user enabled in a previous
        // session (Remote → Settings → Inbound file offers). Failure point:
        // save dir missing or listener spawn error — log and stay disabled;
        // the UI shows Off and the user can re-enable manually.
        let rncp_restore = {
            let state = inner.read().await;
            state.rncp_listener_enabled.then(|| {
                (
                    state.rncp_listener_save_dir.clone(),
                    state.rncp_listener_allow_fetch,
                    state.rncp_listener_fetch_jail.clone(),
                    state.rncp_listener_overwrite,
                    state.rncp_listener_allowed.clone(),
                    state.rncp_listener_blocked.clone(),
                )
            })
        };
        if let Some((save_dir, allow_fetch, fetch_jail, overwrite, allowed, blocked)) = rncp_restore
        {
            let mode = if allowed.is_empty() {
                "ask"
            } else {
                "allow_all_listed"
            };
            if let Err(e) = bridge.rncp_configure_policy(mode, allowed, blocked).await {
                tracing::warn!("[rncp] failed to restore inbound policy: {e}");
            } else {
                let save_dir = save_dir
                    .map(PathBuf::from)
                    .unwrap_or_else(|| storage_dir.join("rncp_inbox"));
                let result = bridge
                    .rncp_start_listener(
                        save_dir,
                        allow_fetch,
                        fetch_jail.map(PathBuf::from),
                        overwrite,
                    )
                    .await;
                if result.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
                    tracing::warn!("[rncp] failed to restore inbound listener: {result}");
                }
            }
        }

        // Re-apply the persisted routing preference and per-destination pins to
        // the fresh transport. Failure point: control query timeout — log and
        // continue on the transport default (`lowest`); the user can re-apply
        // from Settings, and the stored values survive for the next start.
        let (path_preference, peer_pins) = {
            let state = inner.read().await;
            (state.path_medium_preference, state.peer_medium_pins.clone())
        };
        if path_preference != PathMediumPreferenceSetting::default() {
            if let Err(e) = bridge.apply_path_medium_preference(path_preference).await {
                tracing::warn!(
                    "[path-medium] failed to restore preference {}: {e}",
                    path_preference.as_str()
                );
            }
        }
        if !peer_pins.is_empty() {
            for (hash, pin) in peer_pins.iter() {
                if let Err(e) = bridge.apply_peer_medium_pin(hash, Some(pin)).await {
                    tracing::warn!("[path-medium] failed to restore pin for {hash}: {e}");
                }
            }
        }

        Ok(bridge)
    }

    pub async fn nomad_serving_status(&self) -> NomadServingStatus {
        let state = PersistedState::load(&self.config_dir, &self.storage_dir);
        let name = state
            .nomad_serving_display_name
            .as_deref()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or("Nomad node");
        self.nomad_server
            .status(state.nomad_serving_enabled, name)
            .await
    }

    pub async fn start_nomad_serving(
        &self,
        display_name: String,
    ) -> Result<NomadServingStatus, String> {
        let status = self
            .nomad_server
            .start(
                self.handle.transport_tx.clone(),
                self.identity.clone(),
                display_name,
            )
            .await?;
        // Register ourselves in the Nomad node list so page fetch has identity_hash
        // and the UI can open self-preview without waiting for announce echo.
        if let (Some(dest), Some(id_hash)) = (&status.destination_hash, &status.identity_hash) {
            let mut state = self.persisted.write().await;
            state.upsert_nomad_node(
                dest,
                Some(id_hash.clone()),
                Some(status.display_name.clone()),
                Some(0),
            );
            if let Err(e) = state.save(&self.config_dir, &self.storage_dir) {
                tracing::warn!("nomad local host persist failed: {e}");
            }
        }
        let msg = serde_json::json!({
            "type": "nomad.serving_start",
            "payload": {
                "destination_hash": status.destination_hash,
                "display_name": status.display_name,
            }
        });
        let _ = self.event_tx.send(msg.to_string());
        Ok(status)
    }

    pub async fn stop_nomad_serving(&self) -> Result<(), String> {
        self.nomad_server.stop().await?;
        let msg = serde_json::json!({
            "type": "nomad.serving_stop",
            "payload": {}
        });
        let _ = self.event_tx.send(msg.to_string());
        Ok(())
    }

    pub fn nomad_server(&self) -> Arc<NomadServerHandle> {
        self.nomad_server.clone()
    }

    /// Emit an LXMF delivery announce now (Network → Announce now / POST /api/v1/announces).
    pub async fn announce_lxmf_now(&self) -> Result<(), String> {
        let display_name = {
            let state = PersistedState::load(&self.config_dir, &self.storage_dir);
            state
                .identity
                .display_name
                .as_ref()
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty() && n != "Self")
        };
        let dest = parse_hash16(&self.lxmf_hash_hex)?;
        send_lxmf_delivery_announce(
            &self.handle.transport_tx,
            &self.identity,
            dest,
            display_name.as_deref(),
        )
        .await?;
        if let Ok(mut slot) = self.last_lxmf_announce_at.lock() {
            *slot = Some(Instant::now());
        }
        Ok(())
    }

    /// Always send an LXMF delivery announce so remote PNs have a reverse path for LRPROOF.
    /// Returns true when the announce was sent successfully (caller may settle before Linking).
    async fn ensure_lxmf_announce_for_propagation_sync(&self, dest_hex: &str) -> bool {
        match self.announce_lxmf_now().await {
            Ok(()) => {
                tracing::info!(
                    target: "propagation-sync",
                    dest = %dest_hex,
                    "LXMF delivery announce sent before propagation sync"
                );
                true
            }
            Err(e) => {
                tracing::warn!(
                    target: "propagation-sync",
                    dest = %dest_hex,
                    error = %e,
                    "LXMF announce before propagation sync failed"
                );
                false
            }
        }
    }

    /// Rehydrate persisted PN public keys into known_identities (survives announce-flood eviction).
    pub fn rehydrate_propagation_identities_from_persisted(&self) {
        let state = PersistedState::load(&self.config_dir, &self.storage_dir);
        let Ok(mut driver) = self.outbound.lock() else {
            return;
        };
        for row in &state.propagation {
            let Some(dest) = row.destination_hash.as_deref() else {
                continue;
            };
            let Some(pk_hex) = row.public_key.as_deref() else {
                continue;
            };
            let Ok(bytes) = hex::decode(pk_hex) else {
                continue;
            };
            if bytes.len() != 64 {
                continue;
            }
            let mut key = [0u8; 64];
            key.copy_from_slice(&bytes);
            driver.register_identity_key(dest, key);
            tracing::debug!(
                target: "propagation-sync",
                dest = %dest.to_lowercase(),
                "rehydrated persisted PN public key"
            );
        }
    }

    /// Register (and optionally pin) a PN pubkey from outbound / recent announces / discovery.
    pub fn register_propagation_node_identity(
        &self,
        destination_hash: &str,
        public_key_hex: Option<&str>,
        identity_hash: Option<&str>,
        pin: bool,
    ) -> Option<[u8; 64]> {
        let dest = destination_hash.to_lowercase();
        let mut key = public_key_hex.and_then(|hex_str| {
            let bytes = hex::decode(hex_str).ok()?;
            if bytes.len() != 64 {
                return None;
            }
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&bytes);
            Some(arr)
        });
        if key.is_none() {
            key = self
                .outbound
                .lock()
                .ok()
                .and_then(|d| d.public_key_for(&dest));
        }
        if key.is_none() {
            key = self.discovered_propagation.lock().ok().and_then(|cache| {
                let hex_str = cache.get(&dest)?.public_key.as_deref()?;
                let bytes = hex::decode(hex_str).ok()?;
                if bytes.len() != 64 {
                    return None;
                }
                let mut arr = [0u8; 64];
                arr.copy_from_slice(&bytes);
                Some(arr)
            });
        }
        let Some(pub_key) = key else {
            let _ = identity_hash;
            return None;
        };
        if let Ok(mut driver) = self.outbound.lock() {
            if pin {
                driver.pin_identity_for_propagation(&dest, pub_key);
            } else {
                driver.register_identity_key(&dest, pub_key);
            }
        }
        Some(pub_key)
    }

    /// `hash_hex` is the announced Nomad node destination hash (used for the
    /// path-table hops lookup); `identity_hash_hex` is the node's identity
    /// hash recovered from its announce (`AnnounceHandlerEvent::identity_hash`),
    /// required by `LinkClient::query` to rebuild the `nomadnetwork.node`
    /// destination on our side.
    /// Returns page/file bytes plus the egress atom and overall timeout used for the Link.
    /// Remote errors after egress is known include that atom so the UI countdown can update.
    #[allow(clippy::too_many_arguments, clippy::result_large_err)] // path ensure + Nomad Link Err diagnostics
    async fn query_nomad_node(
        &self,
        hash_hex: &str,
        identity_hash_hex: &str,
        path: &str,
        payload: Vec<u8>,
        interfaces: &[InterfaceRow],
        force_path_refresh: bool,
        progress_request_id: Option<&str>,
    ) -> Result<(Vec<u8>, NomadRemoteQueryOk), NomadRemoteQueryError> {
        let query_started = tokio::time::Instant::now();
        let remote_hash = parse_hash16(identity_hash_hex).map_err(|e| NomadRemoteQueryError {
            code: e,
            egress: None,
            path_hops: None,
            link_hops: None,
            timeout_secs: None,
            force_path_ok: None,
            path_ensure_kind: None,
            raw_error: None,
            elapsed_ms: None,
            tried_interfaces: None,
            failover_rounds: None,
            last_iface: None,
        })?;
        // Prefer path-peer cache (maintenance refreshes every ~2s). Avoid a synchronous
        // GetPathTable here — that control query alone can stall TCP page loads for seconds.
        let key = hash_hex.to_lowercase();
        let read_path_cache = || -> (Option<u8>, Option<String>) {
            let mut hops = None;
            let mut iface = None;
            if let Ok(cache) = self.path_peer_cache.lock() {
                if let Some(peer) = cache.iter().find(|p| p.destination_hash == key) {
                    hops = peer.hops;
                    iface = peer.interface.clone().filter(|n| !n.is_empty());
                }
            }
            if iface.is_none() {
                iface = self.path_interface_for_hash(&key);
            }
            (hops, iface)
        };
        let (mut cached_hops, mut path_iface) = read_path_cache();
        // Release-like: do not DropPath on every first TCP load (causes storms and
        // did not predict LRPROOF). Force refresh only on retry; on first attempt
        // only RequestPath when the path table has no row yet.
        let mut force_path_ok: Option<bool>;
        let mut path_ensure_kind: Option<&'static str>;
        if force_path_refresh {
            let report = self
                .ensure_path_for_direct_with_opts(
                    hash_hex,
                    true,
                    NOMAD_FORCE_PATH_REFRESH_WAIT,
                    true,
                )
                .await;
            let kind = report.kind.as_str();
            // Honest signal: true only for rediscovered-after-absence.
            let path_ok = matches!(report.kind, PathEnsureKind::Rediscovered);
            force_path_ok = Some(path_ok);
            path_ensure_kind = Some(kind);
            tracing::debug!(
                target: "nomad",
                dest = %hash_hex,
                kind,
                ok = report.ok,
                force_path_ok = path_ok,
                had_cached = report.had_cached,
                saw_path_absent = report.saw_path_absent,
                "Nomad path ensure (retry)"
            );
            let refreshed = read_path_cache();
            cached_hops = refreshed.0;
            path_iface = refreshed.1;
        } else {
            let had_cached = self
                .outbound
                .lock()
                .map(|d| d.has_path_to(hash_hex))
                .unwrap_or(false);
            if had_cached {
                force_path_ok = Some(false);
                path_ensure_kind = Some(PathEnsureKind::CachedHit.as_str());
            } else {
                let report = self
                    .ensure_path_for_direct_with_opts(
                        hash_hex,
                        false,
                        NOMAD_TCP_PATH_PROBE_WAIT,
                        false,
                    )
                    .await;
                let kind = report.kind.as_str();
                let path_ok = matches!(report.kind, PathEnsureKind::Rediscovered);
                force_path_ok = Some(path_ok);
                path_ensure_kind = Some(kind);
                tracing::debug!(
                    target: "nomad",
                    dest = %hash_hex,
                    kind,
                    ok = report.ok,
                    "Nomad path ensure (first, missing)"
                );
                let refreshed = read_path_cache();
                cached_hops = refreshed.0;
                path_iface = refreshed.1;
                if !report.ok {
                    let hops = cached_hops.unwrap_or(8);
                    let (timeout_secs, egress) = nomad_timeouts::resolve_nomad_page_timeout_secs(
                        interfaces,
                        hops,
                        path_iface.as_deref(),
                        self.primary_local_serial_id().as_deref(),
                    );
                    return Err(NomadRemoteQueryError {
                        code: "path_timeout".into(),
                        egress: Some(egress),
                        path_hops: Some(hops),
                        link_hops: None,
                        timeout_secs: Some(timeout_secs),
                        force_path_ok,
                        path_ensure_kind,
                        raw_error: Some(format!("path ensure kind={kind} (no cached path)")),
                        elapsed_ms: Some(elapsed_ms_since(query_started)),
                        tried_interfaces: None,
                        failover_rounds: None,
                        last_iface: None,
                    });
                }
            }
        }
        let mut hops = match cached_hops {
            Some(h) => h,
            None => self.hops_to_destination(hash_hex).await.unwrap_or(8),
        };
        let (mut timeout_secs, mut egress) = nomad_timeouts::resolve_nomad_page_timeout_secs(
            interfaces,
            hops,
            path_iface.as_deref(),
            self.primary_local_serial_id().as_deref(),
        );
        if !nomad_timeouts::nomad_remote_network_ready(interfaces, path_iface.as_deref()) {
            return Err(NomadRemoteQueryError {
                code: "network_not_ready".into(),
                egress: Some(egress),
                path_hops: Some(hops),
                link_hops: None,
                timeout_secs: Some(timeout_secs),
                force_path_ok,
                path_ensure_kind,
                raw_error: None,
                elapsed_ms: Some(elapsed_ms_since(query_started)),
                tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
            });
        }
        let mut link_hops = nomad_timeouts::nomad_link_initiator_hops(egress, hops);
        let mut proof_budget_secs = nomad_timeouts::nomad_link_proof_budget_secs(timeout_secs);
        // Announce destination (URL/path-table) vs LinkClient dest from identity+aspect.
        let link_dest_hex = hex::encode(Destination::hash_from_name_and_identity(
            NOMAD_NODE_ASPECT,
            Some(&remote_hash),
        ));
        let announce_dest_matches_link_dest = link_dest_hex.eq_ignore_ascii_case(&key);
        tracing::debug!(
            target: "nomad",
            dest = %hash_hex,
            identity = %identity_hash_hex,
            link_dest = %link_dest_hex,
            announce_dest_matches_link_dest,
            path = %path,
            path_hops = hops,
            link_hops,
            proof_budget_secs,
            timeout_secs,
            egress,
            path_iface = ?path_iface,
            force_path_refresh,
            force_path_ok = ?force_path_ok,
            path_ensure_kind = ?path_ensure_kind,
            "Nomad Link query start"
        );
        let path_slots_snapshot = self
            .path_slots(hash_hex)
            .await
            .map(|(slots, _)| slots)
            .unwrap_or_default();

        let mut current_iface = path_iface.clone();
        let mut current_via = active_via_hash_from_slots(&path_slots_snapshot);
        // Private LAN hubs before public when selecting failover prefer targets.
        let live_ifaces = super::auto_path_policy::order_live_ifaces_private_first(
            &live_interface_names(interfaces),
            interfaces,
        );
        // One generation for this page request + all via failovers. Bumping per
        // Link attempt would cancel a newer request when the older one retries.
        let link_gen = self
            .nomad_link_generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        self.emit_nomad_page_progress(
            hash_hex,
            path,
            "link_attempt",
            progress_request_id,
            serde_json::json!({
                "round": 0,
                "iface": current_iface,
                "via_prefix": via_prefix(current_via.as_deref()),
                "hops": hops,
                "timeout_secs": timeout_secs,
            }),
        );

        let mut result = self
            .nomad_link_client_query(
                remote_hash,
                path,
                payload.clone(),
                hops,
                link_hops,
                timeout_secs,
                egress,
                force_path_ok,
                path_ensure_kind,
                link_gen,
            )
            .await;

        // Dead next-hops often reappear on another local iface (same via_hash).
        // Suppress the failed iface, DropAllVia that hop, promote ranked backups
        // / other live hubs, and retry — up to MAX_VIA_FAILOVERS inside one fetch.
        let mut failover_round: u8 = 0;
        let mut tried_interfaces: Vec<String> = Vec::new();
        let mut blocked_ifaces: Vec<String> = Vec::new();
        let mut blocked_vias: Vec<String> = Vec::new();
        record_path_failover_attempt(
            &mut tried_interfaces,
            &mut blocked_ifaces,
            &mut blocked_vias,
            current_iface.as_deref(),
            current_via.as_deref(),
        );
        while result
            .as_ref()
            .err()
            .is_some_and(|e| should_attempt_nomad_via_failover(&e.code, failover_round))
        {
            if self.nomad_link_generation.load(Ordering::SeqCst) != link_gen {
                break;
            }
            failover_round = failover_round.saturating_add(1);
            self.emit_nomad_page_progress(
                hash_hex,
                path,
                "link_timeout",
                progress_request_id,
                serde_json::json!({
                    "round": failover_round,
                    "iface": current_iface,
                    "via_prefix": via_prefix(current_via.as_deref()),
                    "hops": hops,
                }),
            );
            self.emit_nomad_page_progress(
                hash_hex,
                path,
                "searching_route",
                progress_request_id,
                serde_json::json!({
                    "round": failover_round,
                    "iface": current_iface,
                    "via_prefix": via_prefix(current_via.as_deref()),
                }),
            );
            let Some(PathSlotCandidate {
                hops: failover_hops,
                iface: failover_iface,
                via: failover_via,
            }) = self
                .suppress_via_and_rediscover(hash_hex, &blocked_ifaces, &blocked_vias, &live_ifaces)
                .await
            else {
                self.emit_nomad_page_progress(
                    hash_hex,
                    path,
                    "no_alternate_route",
                    progress_request_id,
                    serde_json::json!({
                        "round": failover_round,
                        "iface": current_iface,
                        "via_prefix": via_prefix(current_via.as_deref()),
                    }),
                );
                break;
            };
            if self.nomad_link_generation.load(Ordering::SeqCst) != link_gen {
                break;
            }
            record_path_failover_attempt(
                &mut tried_interfaces,
                &mut blocked_ifaces,
                &mut blocked_vias,
                failover_iface.as_deref(),
                failover_via.as_deref(),
            );
            let (failover_timeout, failover_egress) =
                nomad_timeouts::resolve_nomad_page_timeout_secs(
                    interfaces,
                    failover_hops,
                    failover_iface.as_deref(),
                    self.primary_local_serial_id().as_deref(),
                );
            let failover_link_hops =
                nomad_timeouts::nomad_link_initiator_hops(failover_egress, failover_hops);
            let failover_proof = nomad_timeouts::nomad_link_proof_budget_secs(failover_timeout);
            current_iface = failover_iface.clone();
            current_via = failover_via.clone();
            self.emit_nomad_page_progress(
                hash_hex,
                path,
                "failover",
                progress_request_id,
                serde_json::json!({
                    "round": failover_round,
                    "iface": current_iface,
                    "via_prefix": via_prefix(current_via.as_deref()),
                    "hops": failover_hops,
                    "timeout_secs": failover_timeout,
                }),
            );
            let rediscovered = PathEnsureKind::Rediscovered.as_str();
            result = self
                .nomad_link_client_query(
                    remote_hash,
                    path,
                    payload.clone(),
                    failover_hops,
                    failover_link_hops,
                    failover_timeout,
                    failover_egress,
                    Some(true),
                    Some(rediscovered),
                    link_gen,
                )
                .await;
            hops = failover_hops;
            link_hops = failover_link_hops;
            timeout_secs = failover_timeout;
            egress = failover_egress;
            force_path_ok = Some(true);
            path_ensure_kind = Some(rediscovered);
            proof_budget_secs = failover_proof;
        }

        if let Err(ref mut err) = result {
            if !tried_interfaces.is_empty() {
                err.tried_interfaces = Some(tried_interfaces);
            }
            if failover_round > 0 {
                err.failover_rounds = Some(failover_round);
            }
            err.last_iface = current_iface.clone();
        }

        let elapsed_ms = elapsed_ms_since(query_started);
        finish_nomad_link_result(
            result,
            hash_hex,
            identity_hash_hex,
            hops,
            link_hops,
            proof_budget_secs,
            timeout_secs,
            egress,
            force_path_ok,
            path_ensure_kind,
            elapsed_ms,
        )
    }

    /// One LinkClient Nomad query under the shared Nomad link lock / cancel slot.
    ///
    /// `my_gen` is owned by the outer page request (see [`Self::query_nomad_node`]) so
    /// via-failover retries do not bump generation or cancel a newer page load.
    #[allow(clippy::too_many_arguments, clippy::result_large_err)] // hops / budgets / Nomad Link Err diagnostics
    async fn nomad_link_client_query(
        &self,
        remote_hash: [u8; 16],
        path: &str,
        payload: Vec<u8>,
        hops: u8,
        link_hops: u8,
        timeout_secs: u64,
        egress: &'static str,
        force_path_ok: Option<bool>,
        path_ensure_kind: Option<&'static str>,
        my_gen: u64,
    ) -> Result<Vec<u8>, NomadRemoteQueryError> {
        // Abort before touching the cancel slot so a superseded failover cannot
        // cancel the newer request that already owns last-request-wins.
        if self.nomad_link_generation.load(Ordering::SeqCst) != my_gen {
            return Err(NomadRemoteQueryError {
                code: "nomad_busy".into(),
                egress: Some(egress),
                path_hops: Some(hops),
                link_hops: Some(link_hops),
                timeout_secs: Some(timeout_secs),
                force_path_ok,
                path_ensure_kind,
                raw_error: None,
                elapsed_ms: None,
                tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
            });
        }
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        {
            let mut slot = self.nomad_link_cancel.lock().await;
            if self.nomad_link_generation.load(Ordering::SeqCst) != my_gen {
                return Err(NomadRemoteQueryError {
                    code: "nomad_busy".into(),
                    egress: Some(egress),
                    path_hops: Some(hops),
                    link_hops: Some(link_hops),
                    timeout_secs: Some(timeout_secs),
                    force_path_ok,
                    path_ensure_kind,
                    raw_error: None,
                    elapsed_ms: None,
                    tried_interfaces: None,
                    failover_rounds: None,
                    last_iface: None,
                });
            }
            if let Some(prev) = slot.take() {
                let _ = prev.send(());
            }
            *slot = Some(cancel_tx);
        }
        let Ok(guard) =
            tokio::time::timeout(NOMAD_LINK_LOCK_WAIT, self.nomad_link_lock.lock()).await
        else {
            if self.nomad_link_generation.load(Ordering::SeqCst) == my_gen {
                *self.nomad_link_cancel.lock().await = None;
            }
            return Err(NomadRemoteQueryError {
                code: "nomad_busy".into(),
                egress: Some(egress),
                path_hops: Some(hops),
                link_hops: Some(link_hops),
                timeout_secs: Some(timeout_secs),
                force_path_ok,
                path_ensure_kind,
                raw_error: None,
                elapsed_ms: None,
                tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
            });
        };
        if self.nomad_link_generation.load(Ordering::SeqCst) != my_gen {
            return Err(NomadRemoteQueryError {
                code: "nomad_busy".into(),
                egress: Some(egress),
                path_hops: Some(hops),
                link_hops: Some(link_hops),
                timeout_secs: Some(timeout_secs),
                force_path_ok,
                path_ensure_kind,
                raw_error: None,
                elapsed_ms: None,
                tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
            });
        }
        let client = LinkClient::new(self.handle.transport_tx.clone(), self.identity.clone());
        let query_fut = client.query(
            remote_hash,
            NOMAD_NODE_ASPECT,
            path,
            payload,
            link_hops,
            Duration::from_secs(timeout_secs),
        );
        let result = tokio::select! {
            biased;
            _ = cancel_rx => Err(NomadRemoteQueryError {
                code: "nomad_busy".into(),
                egress: Some(egress),
                path_hops: Some(hops),
                link_hops: Some(link_hops),
                timeout_secs: Some(timeout_secs),
                force_path_ok,
                path_ensure_kind,
                raw_error: None,
                elapsed_ms: None,
                tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
            }),
            query_result = query_fut => {
                query_result.map_err(|e| {
                    let raw = format!("{e}");
                    let code = map_nomad_link_error(&raw);
                    NomadRemoteQueryError {
                        code,
                        egress: Some(egress),
                        path_hops: Some(hops),
                        link_hops: Some(link_hops),
                        timeout_secs: Some(timeout_secs),
                        force_path_ok,
                        path_ensure_kind,
                        raw_error: Some(raw),
                        elapsed_ms: None,
                        tried_interfaces: None,
                failover_rounds: None,
                last_iface: None,
                    }
                })
            }
        };
        if self.nomad_link_generation.load(Ordering::SeqCst) == my_gen {
            *self.nomad_link_cancel.lock().await = None;
        }
        drop(guard);
        result
    }

    /// After a link failure, suppress the dead iface, drop failed vias, promote
    /// ranked backups / other live hubs, and RequestPath until an unblocked slot
    /// appears (or the probe budget expires).
    async fn suppress_via_and_rediscover(
        &self,
        hash_hex: &str,
        blocked_ifaces: &[String],
        blocked_vias: &[String],
        live_ifaces: &[String],
    ) -> Option<PathSlotCandidate> {
        let dest = parse_hash16(hash_hex).ok()?;
        let slots_before = self
            .path_slots(hash_hex)
            .await
            .map(|(slots, _)| slots)
            .unwrap_or_default();
        let failed_via = active_via_hash_from_slots(&slots_before);
        let prefer = remaining_live_ifaces(live_ifaces, blocked_ifaces);
        let failover_ops = path_failover::build_path_failover_control_ops(
            dest,
            blocked_vias,
            failed_via.as_deref(),
            &prefer,
        );

        // Promote an already-known unblocked backup before waiting on rediscovery.
        let known_backup = select_unblocked_slot(
            &slots_before,
            blocked_ifaces,
            blocked_vias,
            failed_via.as_deref(),
            &prefer,
        );

        if self
            .query_control_timed(TransportQuery::SuppressCurrentPathInterface {
                dest: failover_ops.dest,
                duration: failover_ops.suppress_secs,
            })
            .await
            .is_none()
        {
            tracing::debug!(
                target: "nomad",
                dest = %hash_hex,
                "path failover: SuppressCurrentPathInterface timed out or failed"
            );
        }
        // Drop every known-bad next hop (not only the currently active slot —
        // after a timeout the table may flip to another iface sharing an older via).
        for via_hex in &failover_ops.vias_to_drop {
            if let Ok(next_hop) = parse_hash16(via_hex) {
                if self
                    .query_control_timed(TransportQuery::DropAllVia { next_hop })
                    .await
                    .is_none()
                {
                    tracing::debug!(
                        target: "nomad",
                        dest = %hash_hex,
                        via = %via_hex,
                        "path failover: DropAllVia timed out or failed"
                    );
                }
            }
        }
        if let Ok(mut driver) = self.outbound.lock() {
            driver.clear_path_to(hash_hex);
        }
        if let Ok(mut cache) = self.peer_via_cache.lock() {
            cache.remove(&hash_hex.to_lowercase());
        }

        if let Some(backup) = known_backup {
            // Brief settle so transport can activate the promoted backup slot.
            let _ = self
                .handle
                .transport_tx
                .send(TransportMessage::RequestPath {
                    destination_hash: dest,
                })
                .await;
            let settle_deadline =
                tokio::time::Instant::now() + path_failover::VIA_FAILOVER_POLL_INTERVAL * 10;
            while tokio::time::Instant::now() < settle_deadline {
                let slots = self
                    .path_slots(hash_hex)
                    .await
                    .map(|(slots, _)| slots)
                    .unwrap_or_default();
                if let Some(found) = select_unblocked_slot(
                    &slots,
                    blocked_ifaces,
                    blocked_vias,
                    failed_via.as_deref(),
                    &prefer,
                ) {
                    let _ = self.refresh_outbound_path_table().await;
                    return Some(found);
                }
                tokio::time::sleep(path_failover::VIA_FAILOVER_POLL_INTERVAL).await;
            }
            // Backup was known before suppress; return it even if the table is slow.
            let _ = self.refresh_outbound_path_table().await;
            return Some(backup);
        }

        let _ = self
            .handle
            .transport_tx
            .send(TransportMessage::RequestPath {
                destination_hash: dest,
            })
            .await;

        let mut found = self
            .poll_unblocked_path_slot(
                hash_hex,
                blocked_ifaces,
                blocked_vias,
                failed_via.as_deref(),
                &prefer,
                path_failover::VIA_FAILOVER_PROBE_WAIT,
            )
            .await;

        // When other live hubs remain, issue a second RequestPath + wait instead of
        // giving up after a single short probe (TTP-only cache vs Local Pi up).
        if found.is_none() && !prefer.is_empty() {
            tracing::debug!(
                target: "nomad",
                dest = %hash_hex,
                remaining = ?prefer,
                "Nomad path failover: extra RequestPath toward remaining live interfaces"
            );
            let _ = self
                .handle
                .transport_tx
                .send(TransportMessage::RequestPath {
                    destination_hash: dest,
                })
                .await;
            found = self
                .poll_unblocked_path_slot(
                    hash_hex,
                    blocked_ifaces,
                    blocked_vias,
                    failed_via.as_deref(),
                    &prefer,
                    path_failover::VIA_FAILOVER_EXTRA_PROBE_WAIT,
                )
                .await;
        }
        found
    }

    async fn poll_unblocked_path_slot(
        &self,
        hash_hex: &str,
        blocked_ifaces: &[String],
        blocked_vias: &[String],
        failed_via: Option<&str>,
        prefer_ifaces: &[String],
        wait: Duration,
    ) -> Option<PathSlotCandidate> {
        let deadline = tokio::time::Instant::now() + wait;
        while tokio::time::Instant::now() < deadline {
            let slots = self
                .path_slots(hash_hex)
                .await
                .map(|(slots, _)| slots)
                .unwrap_or_default();
            if let Some(found) = select_unblocked_slot(
                &slots,
                blocked_ifaces,
                blocked_vias,
                failed_via,
                prefer_ifaces,
            ) {
                // Keep LXMF outbound / peer-via caches aligned after path_slots finds a route.
                let _ = self.refresh_outbound_path_table().await;
                return Some(found);
            }
            tokio::time::sleep(path_failover::VIA_FAILOVER_POLL_INTERVAL).await;
        }
        None
    }

    pub async fn fetch_nomad_file(
        &self,
        hash_hex: &str,
        identity_hash_hex: Option<&str>,
        path: &str,
        interfaces: &[InterfaceRow],
        force_path_refresh: bool,
    ) -> serde_json::Value {
        if let Some(local) = self.nomad_server.try_read_local_route(hash_hex, path).await {
            return match local {
                Ok(bytes) => {
                    if bytes.len() > NOMAD_FILE_MAX_BYTES {
                        return serde_json::json!({ "ok": false, "error": "response_too_large" });
                    }
                    let file_name = nomad_file_name_from_path(path);
                    let content_base64 =
                        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                    serde_json::json!({
                        "ok": true,
                        "file_name": file_name,
                        "content_base64": content_base64,
                    })
                }
                Err(e) => serde_json::json!({ "ok": false, "error": e }),
            };
        }
        let Some(identity_hash_hex) = identity_hash_hex.filter(|s| !s.is_empty()) else {
            return serde_json::json!({ "ok": false, "error": "missing_identity_hash" });
        };
        if self.is_own_identity_hash(identity_hash_hex) {
            return serde_json::json!({ "ok": false, "error": "nomad_not_serving" });
        }
        match self
            .query_nomad_node(
                hash_hex,
                identity_hash_hex,
                path,
                Vec::new(),
                interfaces,
                force_path_refresh,
                None,
            )
            .await
        {
            Ok((bytes, meta)) => {
                if bytes.len() > NOMAD_FILE_MAX_BYTES {
                    return nomad_response_too_large_json(&meta);
                }
                let file_name = nomad_file_name_from_path(path);
                let content_base64 =
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                let mut out = serde_json::json!({
                    "ok": true,
                    "file_name": file_name,
                    "content_base64": content_base64,
                });
                merge_nomad_remote_ok_fields(&mut out, &meta);
                out
            }
            Err(e) => nomad_remote_error_json(&e),
        }
    }

    /// See `fetch_nomad_file` for `hash_hex` / `identity_hash_hex` semantics.
    #[allow(clippy::too_many_arguments)] // page fetch + progress correlation id
    pub async fn fetch_nomad_page(
        &self,
        hash_hex: &str,
        identity_hash_hex: Option<&str>,
        path: &str,
        data_b64: Option<&str>,
        interfaces: &[InterfaceRow],
        force_path_refresh: bool,
        progress_request_id: Option<&str>,
    ) -> serde_json::Value {
        // Self-preview: read hosted content without a Link query to ourselves.
        if let Some(local) = self.nomad_server.try_read_local_route(hash_hex, path).await {
            return match local {
                Ok(bytes) => {
                    if bytes.len() > NOMAD_PAGE_MAX_BYTES {
                        return serde_json::json!({ "ok": false, "error": "response_too_large" });
                    }
                    let content = String::from_utf8_lossy(&bytes).into_owned();
                    let content_type = if path.split('`').next().is_some_and(|p| p.ends_with(".mu"))
                    {
                        "micron"
                    } else {
                        "text"
                    };
                    serde_json::json!({
                        "ok": true,
                        "content": content,
                        "content_type": content_type,
                        "egress": "local",
                        "timeout_secs": 0,
                    })
                }
                Err(e) => serde_json::json!({ "ok": false, "error": e }),
            };
        }
        let Some(identity_hash_hex) = identity_hash_hex.filter(|s| !s.is_empty()) else {
            return serde_json::json!({ "ok": false, "error": "missing_identity_hash" });
        };
        // Own Nomad announce can echo back via the mesh (multi-hop). Never open a
        // Link to ourselves — require My Pages hosting for local preview.
        if self.is_own_identity_hash(identity_hash_hex) {
            return serde_json::json!({ "ok": false, "error": "nomad_not_serving" });
        }
        let payload = nomad_page_request_payload(data_b64);
        match self
            .query_nomad_node(
                hash_hex,
                identity_hash_hex,
                path,
                payload,
                interfaces,
                force_path_refresh,
                progress_request_id,
            )
            .await
        {
            Ok((bytes, meta)) => {
                if bytes.len() > NOMAD_PAGE_MAX_BYTES {
                    return nomad_response_too_large_json(&meta);
                }
                let content = String::from_utf8_lossy(&bytes).into_owned();
                let content_type = if path.split('`').next().is_some_and(|p| p.ends_with(".mu")) {
                    "micron"
                } else {
                    "text"
                };
                let mut out = serde_json::json!({
                    "ok": true,
                    "content": content,
                    "content_type": content_type,
                });
                merge_nomad_remote_ok_fields(&mut out, &meta);
                out
            }
            Err(e) => nomad_remote_error_json(&e),
        }
    }

    fn is_own_identity_hash(&self, identity_hash_hex: &str) -> bool {
        identity_hash_hex.eq_ignore_ascii_case(&self.identity_hash_hex())
    }

    async fn query_control_timed(&self, query: TransportQuery) -> Option<TransportQueryResponse> {
        if let Ok(resp) =
            tokio::time::timeout(TRANSPORT_QUERY_TIMEOUT, self.handle.query_control(query)).await
        {
            resp
        } else {
            tracing::debug!(
                "transport control query timed out after {:?}",
                TRANSPORT_QUERY_TIMEOUT
            );
            None
        }
    }

    async fn hops_to_destination(&self, hash_hex: &str) -> Option<u8> {
        let resp = self
            .query_control_timed(TransportQuery::GetPathTable)
            .await?;
        let TransportQueryResponse::PathTable(entries) = resp else {
            return None;
        };
        let key = hash_hex.to_lowercase();
        entries
            .iter()
            .filter(|e| hex::encode(e.hash).to_lowercase() == key)
            .map(|e| e.hops)
            .min()
    }

    /// Lowest-hop live path slot within RRC link limits (default 8).
    async fn best_rrc_path_route(&self, hash_hex: &str) -> Option<(u8, Option<String>)> {
        const RRC_MAX_CONNECT_HOPS: u8 = 8;

        let Ok(dest) = parse_hash16(hash_hex) else {
            return None;
        };
        if let Some(TransportQueryResponse::PathSlots(entry)) = self
            .query_control_timed(TransportQuery::GetPathSlots { dest })
            .await
        {
            let best = entry
                .slots
                .iter()
                .filter(|s| !s.expired && s.hops <= RRC_MAX_CONNECT_HOPS)
                .min_by_key(|s| s.hops);
            if let Some(slot) = best {
                let iface = (!slot.interface.is_empty()).then(|| slot.interface.clone());
                return Some((slot.hops, iface));
            }
        }
        self.hops_to_destination(hash_hex)
            .await
            .filter(|&h| h <= RRC_MAX_CONNECT_HOPS)
            .map(|h| (h, None))
    }

    /// Register handler for Nomad Network node announces (`nomadnetwork.node`).
    pub fn register_nomad_announce_handler(
        &self,
        inner: Arc<RwLock<PersistedState>>,
        config_dir: PathBuf,
        storage_dir: PathBuf,
    ) {
        let transport_tx = self.handle.transport_tx.clone();
        let event_tx = self.event_tx.clone();
        let our_identity_hash = self.identity_hash_hex();
        tokio::spawn(async move {
            let (callback_tx, mut callback_rx) =
                tokio::sync::mpsc::channel::<AnnounceHandlerEvent>(64);
            if transport_tx
                .send(TransportMessage::RegisterAnnounceHandler {
                    aspect_filter: Some(NOMAD_NODE_ASPECT.to_string()),
                    receive_path_responses: false,
                    callback_tx,
                })
                .await
                .is_err()
            {
                tracing::warn!("nomad announce handler registration failed: transport closed");
                return;
            }

            while let Some(evt) = callback_rx.recv().await {
                let hash_hex = hex::encode(evt.destination_hash);
                let identity_hash_hex = evt.identity_hash.map(hex::encode);
                let display_name = parse_announce_display_name(evt.app_data.as_deref());
                // Own Nomad announces often reappear via multi-hop path-table echoes.
                let hops = if identity_hash_hex
                    .as_ref()
                    .is_some_and(|id| id.eq_ignore_ascii_case(&our_identity_hash))
                {
                    Some(0)
                } else {
                    Some(evt.hops)
                };
                let payload = {
                    let mut state = inner.write().await;
                    state.upsert_nomad_node(
                        &hash_hex,
                        identity_hash_hex.clone(),
                        display_name.clone(),
                        hops,
                    );
                    if let Err(e) = state.save(&config_dir, &storage_dir) {
                        tracing::warn!("nomad node persist failed: {e}");
                    }
                    serde_json::json!({
                        "destination_hash": hash_hex,
                        "display_name": display_name,
                        "hops": hops.unwrap_or(0),
                    })
                };
                let frame = serde_json::json!({ "type": "nomadnetwork.node", "payload": payload });
                let _ = event_tx.send(frame.to_string());
            }
        });
    }

    pub fn register_rrc_announce_handler(
        &self,
        inner: Arc<RwLock<PersistedState>>,
        config_dir: PathBuf,
        storage_dir: PathBuf,
    ) {
        let transport_tx = self.handle.transport_tx.clone();
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            let (callback_tx, mut callback_rx) =
                tokio::sync::mpsc::channel::<AnnounceHandlerEvent>(64);
            if transport_tx
                .send(TransportMessage::RegisterAnnounceHandler {
                    aspect_filter: Some(RRC_HUB_ASPECT.to_string()),
                    receive_path_responses: false,
                    callback_tx,
                })
                .await
                .is_err()
            {
                tracing::warn!("rrc announce handler registration failed: transport closed");
                return;
            }

            while let Some(evt) = callback_rx.recv().await {
                let hash_hex = hex::encode(evt.destination_hash);
                let identity_hash_hex = evt.identity_hash.map(hex::encode);
                let display_name = parse_rrc_hub_announce_name(evt.app_data.as_deref());
                let hops = Some(evt.hops);
                let payload = {
                    let mut state = inner.write().await;
                    state.upsert_rrc_hub(
                        &hash_hex,
                        identity_hash_hex.clone(),
                        display_name.clone(),
                        hops,
                        "discovered",
                    );
                    if let Err(e) = state.save(&config_dir, &storage_dir) {
                        tracing::warn!("rrc hub persist failed: {e}");
                    }
                    serde_json::json!({
                        "destination_hash": hash_hex,
                        "identity_hash": identity_hash_hex,
                        "display_name": display_name,
                        "hops": evt.hops,
                        "source": "discovered",
                    })
                };
                let frame = serde_json::json!({ "type": "rrc.hub", "payload": payload });
                let _ = event_tx.send(frame.to_string());
            }
        });
    }

    /// Register handler for LXMF propagation-node announces (`lxmf.propagation`).
    ///
    /// Upserts an in-memory discovered list (not auto-added to configured PNs).
    /// When local hosting + autopeer are on, also feeds `LxmRouter::autopeer`.
    pub fn register_propagation_announce_handler(&self) {
        const LXMF_PROPAGATION_ASPECT: &str = "lxmf.propagation";
        const MAX_DISCOVERED_PROPAGATION: usize = 200;
        let transport_tx = self.handle.transport_tx.clone();
        let event_tx = self.event_tx.clone();
        let discovered = Arc::clone(&self.discovered_propagation);
        let outbound = Arc::clone(&self.outbound);
        let router = Arc::clone(&self.router);
        let propagation = Arc::clone(&self.propagation);
        let pn_hosting_policy = Arc::clone(&self.pn_hosting_policy);
        let persisted = Arc::clone(&self.persisted);
        tokio::spawn(async move {
            let (callback_tx, mut callback_rx) =
                tokio::sync::mpsc::channel::<AnnounceHandlerEvent>(64);
            if transport_tx
                .send(TransportMessage::RegisterAnnounceHandler {
                    aspect_filter: Some(LXMF_PROPAGATION_ASPECT.to_string()),
                    receive_path_responses: false,
                    callback_tx,
                })
                .await
                .is_err()
            {
                tracing::warn!(
                    "propagation announce handler registration failed: transport closed"
                );
                return;
            }

            while let Some(evt) = callback_rx.recv().await {
                let Some(app_data) = evt.app_data.as_deref() else {
                    continue;
                };
                let Some(parsed) = lxmf_core::handlers::parse_pn_announce_data(app_data) else {
                    continue;
                };
                // lxmd parity: cache PN stamp cost for outbound Propagated packing.
                {
                    let mut router = router.lock().await;
                    router.set_stamp_cost(evt.destination_hash, parsed.stamp_cost);
                    tracing::debug!(
                        target: "propagation-discovered",
                        dest = %hex::encode(evt.destination_hash),
                        stamp_cost = parsed.stamp_cost,
                        "learned propagation-node stamp cost from announce"
                    );
                }
                let hash_hex = hex::encode(evt.destination_hash);
                let identity_hash_hex = evt.identity_hash.map(hex::encode);
                let display_name = lxmf_core::handlers::pn_name_from_app_data(app_data);
                let last_seen = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let public_key_hex = evt.public_key.map(|pub_key| {
                    if let Ok(mut driver) = outbound.lock() {
                        driver.register_identity_key(&hash_hex, pub_key);
                    }
                    hex::encode(pub_key)
                });
                let row = super::DiscoveredPropagationRow {
                    destination_hash: hash_hex.clone(),
                    identity_hash: identity_hash_hex.clone(),
                    public_key: public_key_hex.clone(),
                    display_name: display_name.clone(),
                    hops: Some(evt.hops),
                    last_seen: Some(last_seen),
                    node_state: parsed.node_state,
                    peering_cost: parsed.peering_cost,
                };
                let (payload, cascade_fields_changed) = {
                    let Ok(mut cache) = discovered.lock() else {
                        continue;
                    };
                    let previous = cache.insert(hash_hex.clone(), row.clone());
                    // Only rebuild when this announce can change the Auto cascade shortlist.
                    let changed = previous.is_none_or(|prev| {
                        prev.node_state != row.node_state
                            || prev.hops != row.hops
                            || prev.peering_cost != row.peering_cost
                    });
                    while cache.len() > MAX_DISCOVERED_PROPAGATION {
                        // Evict oldest last_seen.
                        let oldest = cache
                            .iter()
                            .min_by_key(|(_, r)| r.last_seen.unwrap_or(0))
                            .map(|(k, _)| k.clone());
                        if let Some(k) = oldest {
                            cache.remove(&k);
                        } else {
                            break;
                        }
                    }
                    let payload = serde_json::json!({
                        "destination_hash": hash_hex,
                        "identity_hash": identity_hash_hex,
                        "public_key": public_key_hex,
                        "display_name": display_name,
                        "hops": evt.hops,
                        "last_seen": last_seen,
                        "node_state": parsed.node_state,
                        "peering_cost": parsed.peering_cost,
                    });
                    (payload, changed)
                };
                let frame =
                    serde_json::json!({ "type": "propagation.discovered", "payload": payload });
                let _ = event_tx.send(frame.to_string());

                if cascade_fields_changed {
                    rebuild_pn_cascade_candidates(
                        &persisted,
                        &discovered,
                        &outbound,
                        &pn_hosting_policy,
                    )
                    .await;
                }

                // Autopeer only while hosting a local PN (lxmd parity).
                if propagation.is_local_serving() {
                    let autopeer_on = pn_hosting_policy
                        .lock()
                        .ok()
                        .map(|p| p.autopeer)
                        .unwrap_or(true);
                    if autopeer_on && parsed.node_state {
                        let mut router = router.lock().await;
                        // AutopeerCandidate uses f64; announce wire fields are i64/u64.
                        // Precision loss is fine for timebase/limits (KB-scale / unix seconds).
                        #[allow(clippy::cast_precision_loss)]
                        let peered = router.autopeer(lxmf_core::router::AutopeerCandidate {
                            destination_hash: evt.destination_hash,
                            timebase: parsed.timebase as f64,
                            transfer_limit: Some(parsed.transfer_limit as f64),
                            sync_limit: Some(parsed.sync_limit as f64),
                            stamp_cost: Some(parsed.stamp_cost),
                            stamp_flexibility: Some(parsed.stamp_flex),
                            peering_cost: Some(parsed.peering_cost),
                            metadata: Some(parsed.metadata.clone()),
                            hops: Some(evt.hops),
                        });
                        if !peered {
                            tracing::debug!(
                                target: "propagation-discovered",
                                dest = %hash_hex,
                                hops = evt.hops,
                                peering_cost = parsed.peering_cost,
                                "autopeer declined candidate"
                            );
                        }
                    }
                }
            }
        });
    }

    pub fn list_discovered_propagation(&self) -> Vec<super::DiscoveredPropagationRow> {
        self.discovered_propagation
            .lock()
            .map(|cache| {
                let mut rows: Vec<_> = cache.values().cloned().collect();
                rows.sort_by(|a, b| {
                    let hops_a = a.hops.unwrap_or(u8::MAX);
                    let hops_b = b.hops.unwrap_or(u8::MAX);
                    hops_a
                        .cmp(&hops_b)
                        .then_with(|| b.last_seen.unwrap_or(0).cmp(&a.last_seen.unwrap_or(0)))
                });
                rows
            })
            .unwrap_or_default()
    }

    pub async fn rrc_connect(
        &self,
        dest_hash: [u8; 16],
        dest_hash_hex: String,
        hops: u8,
        nickname: String,
    ) -> serde_json::Value {
        let _ = self.refresh_outbound_path_table().await;
        let Some((path_hops, path_iface)) = self.best_rrc_path_route(&dest_hash_hex).await else {
            tracing::debug!(
                target: "rrc",
                hub = %dest_hash_hex,
                stored_hops = hops,
                "rrc connect rejected — no viable network path (≤8 hops)"
            );
            return serde_json::json!({ "ok": false, "error": "path not ready" });
        };
        let ifaces = self.fetch_interfaces().await.unwrap_or_default();
        let egress = resolve_lxmf_sent_via(path_iface.as_deref(), &ifaces, None);
        let egress_atom = match egress.as_str() {
            "ble" => "ble",
            "rf" => "rf",
            "tcp" => "tcp",
            _ => "network",
        };
        let link_hops = nomad_timeouts::nomad_link_initiator_hops(egress_atom, path_hops);
        if path_hops != hops || link_hops != path_hops {
            tracing::debug!(
                target: "rrc",
                hub = %dest_hash_hex,
                stored_hops = hops,
                path_hops,
                link_hops,
                egress = %egress,
                path_iface = ?path_iface,
                "rrc connect using scaled link hops"
            );
        }
        match self
            .rrc_session
            .connect(dest_hash, dest_hash_hex, link_hops, nickname)
            .await
        {
            Ok(()) => serde_json::json!({
                "ok": true,
                "hops": path_hops,
                "link_hops": link_hops,
                "path_iface": path_iface,
                "egress": egress,
            }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rrc_disconnect(&self, dest_hash_hex: Option<&str>) -> serde_json::Value {
        self.rrc_session.disconnect(dest_hash_hex).await;
        serde_json::json!({ "ok": true })
    }

    pub async fn rrc_status(&self) -> serde_json::Value {
        self.rrc_session.status_snapshot().await
    }

    pub async fn rrc_join(
        &self,
        hub_dest_hash: &str,
        room: &str,
        key: Option<&str>,
    ) -> serde_json::Value {
        let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        match self
            .rrc_session
            .join(hub_dest_hash, room.to_string(), key)
            .await
        {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rrc_part(&self, hub_dest_hash: &str, room: &str) -> serde_json::Value {
        match self.rrc_session.part(hub_dest_hash, room.to_string()).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rrc_send(
        &self,
        hub_dest_hash: &str,
        room: Option<&str>,
        body: &str,
        kind: &str,
        dst_hash: Option<&str>,
    ) -> serde_json::Value {
        let room = room.map(|r| r.trim().to_string()).filter(|r| !r.is_empty());
        match self
            .rrc_session
            .send_chat(hub_dest_hash, room, body.to_string(), kind, dst_hash)
            .await
        {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rrc_set_nick(
        &self,
        hub_dest_hash: Option<&str>,
        nickname: &str,
    ) -> serde_json::Value {
        match self
            .rrc_session
            .set_nickname(hub_dest_hash, nickname.to_string())
            .await
        {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rrc_rooms(&self, hub_dest_hash: Option<&str>) -> serde_json::Value {
        self.rrc_session.rooms_snapshot(hub_dest_hash).await
    }

    pub async fn rnsh_connect(&self, destination_hash_hex: &str) -> serde_json::Value {
        match self.rnsh_session.connect(destination_hash_hex).await {
            Ok(mut payload) => {
                if let Some(map) = payload.as_object_mut() {
                    map.insert("ok".into(), serde_json::Value::Bool(true));
                }
                payload
            }
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rnsh_input(&self, session_id: &str, data: Vec<u8>) -> serde_json::Value {
        match self.rnsh_session.input(session_id, data).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rnsh_resize(
        &self,
        session_id: &str,
        rows: Option<u32>,
        cols: Option<u32>,
    ) -> serde_json::Value {
        match self.rnsh_session.resize(session_id, rows, cols).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rnsh_disconnect(&self, session_id: &str) -> serde_json::Value {
        match self.rnsh_session.disconnect(session_id).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rnsh_status(&self) -> serde_json::Value {
        self.rnsh_session.status_snapshot().await
    }

    pub async fn voice_status(&self) -> serde_json::Value {
        self.voice_session.status().await
    }

    pub fn subscribe_voice_audio(&self) -> broadcast::Receiver<String> {
        self.voice_session.subscribe_voice_audio()
    }

    pub async fn voice_call(&self, identity_hash: &str) -> serde_json::Value {
        self.voice_session.call(identity_hash).await
    }

    pub async fn voice_answer(&self) -> serde_json::Value {
        self.voice_session.answer().await
    }

    pub async fn voice_reject(&self) -> serde_json::Value {
        self.voice_session.reject().await
    }

    pub async fn voice_hangup(&self) -> serde_json::Value {
        self.voice_session.hangup().await
    }

    pub async fn voice_mute(&self, muted: bool) -> serde_json::Value {
        self.voice_session.set_mute(muted).await
    }

    pub async fn voice_audio(
        &self,
        profile: Option<u32>,
        channels: u8,
        samples_b64: &str,
    ) -> serde_json::Value {
        self.voice_session
            .send_audio(profile, channels, samples_b64)
            .await
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_status(&self) -> serde_json::Value {
        self.games_session.status()
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_apps(&self) -> serde_json::Value {
        self.games_session.list_apps()
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_sessions(&self, peer: Option<&str>) -> serde_json::Value {
        self.games_session.list_sessions(peer)
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_session_detail(&self, session_id: &str) -> serde_json::Value {
        self.games_session.session_detail(session_id)
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_mark_read(&self, session_id: &str) -> Result<(), String> {
        self.games_session.mark_read(session_id)
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // sync GamesSessionManager call awaited by StackHandle API
    pub async fn games_delete_session(&self, session_id: &str) -> Result<(), String> {
        self.games_session.delete_session(session_id)
    }

    pub async fn rncp_send(&self, destination_hash_hex: &str, path: &str) -> serde_json::Value {
        match self.rncp_transfer.send(destination_hash_hex, path).await {
            Ok(transfer_id) => serde_json::json!({ "ok": true, "transfer_id": transfer_id }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_fetch(
        &self,
        destination_hash_hex: &str,
        remote_path: &str,
        save_dir: PathBuf,
    ) -> serde_json::Value {
        match self
            .rncp_transfer
            .fetch(destination_hash_hex, remote_path, save_dir)
            .await
        {
            Ok(transfer_id) => serde_json::json!({ "ok": true, "transfer_id": transfer_id }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_cancel(&self, transfer_id: &str) -> serde_json::Value {
        match self.rncp_transfer.cancel(transfer_id).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_accept(&self, transfer_id: &str) -> serde_json::Value {
        match self.rncp_transfer.accept(transfer_id).await {
            Ok(mut payload) => {
                if let Some(map) = payload.as_object_mut() {
                    map.insert("ok".into(), serde_json::Value::Bool(true));
                }
                payload
            }
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_reject(&self, transfer_id: &str) -> serde_json::Value {
        match self.rncp_transfer.reject(transfer_id).await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_status(&self) -> serde_json::Value {
        self.rncp_transfer.status().await
    }

    pub async fn rncp_configure_policy(
        &self,
        mode: &str,
        allowed: Vec<String>,
        blocked: Vec<String>,
    ) -> Result<(), String> {
        self.rncp_transfer
            .configure_policy(mode, allowed, blocked)
            .await
    }

    pub async fn rncp_start_listener(
        &self,
        save_dir: PathBuf,
        allow_fetch: bool,
        fetch_jail: Option<PathBuf>,
        overwrite: bool,
    ) -> serde_json::Value {
        match self
            .rncp_transfer
            .start_listener(save_dir, allow_fetch, fetch_jail, overwrite)
            .await
        {
            Ok(mut payload) => {
                if let Some(map) = payload.as_object_mut() {
                    map.insert("ok".into(), serde_json::Value::Bool(true));
                }
                payload
            }
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub async fn rncp_stop_listener(&self) {
        self.rncp_transfer.stop_listener().await;
    }

    pub async fn rncp_listener_status(&self) -> serde_json::Value {
        self.rncp_transfer.listener_status().await
    }

    pub async fn rncp_receive_destination_hash(&self) -> Option<String> {
        self.rncp_transfer.receive_destination_hash().await
    }

    pub async fn rncp_announce_now(&self) -> serde_json::Value {
        match self.rncp_transfer.announce_now().await {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        }
    }

    pub fn identity_hash_hex(&self) -> String {
        hex::encode(self.identity.hash)
    }

    /// Live path-table hops + interface name for a destination (propagation list enrichment).
    pub fn live_path_fields_for_destination(
        &self,
        destination_hash_hex: &str,
    ) -> (Option<u8>, Option<String>) {
        let clean = destination_hash_hex.trim().to_lowercase();
        self.path_peer_cache
            .lock()
            .ok()
            .and_then(|cache| {
                cache
                    .iter()
                    .find(|p| p.destination_hash == clean)
                    .map(|p| (p.hops, p.interface.clone().filter(|name| !name.is_empty())))
            })
            .unwrap_or((None, None))
    }

    /// rnsh/rncp gating decision for `destination_hash_hex`: resolves the
    /// path-table egress interface (if known) to a transport atom via
    /// [`super::via::classify_path_interface_name`] and buckets it with
    /// [`path_speed::path_capability_from_atoms`]. Uses config interface
    /// rows (cheap, no transport round-trip) rather than [`Self::fetch_interfaces`].
    pub fn path_capability(&self, destination_hash_hex: &str) -> serde_json::Value {
        let clean = destination_hash_hex.trim().to_lowercase();
        let peer = self
            .path_peer_cache
            .lock()
            .ok()
            .and_then(|cache| cache.iter().find(|p| p.destination_hash == clean).cloned());
        let config_rows = config::interfaces_from_config_dir(&self.config_dir).unwrap_or_default();
        let atoms: Vec<&'static str> = peer
            .as_ref()
            .and_then(|p| p.interface.as_deref())
            .map(|name| vec![classify_path_interface_name(name, &config_rows)])
            .unwrap_or_default();
        let hops = peer.as_ref().and_then(|p| p.hops).map(u32::from);
        let cap = path_speed::path_capability_from_atoms(&clean, &atoms, hops);
        serde_json::json!({
            "destination_hash": cap.destination_hash,
            "speed": cap.speed.as_str(),
            "via_atoms": cap.via_atoms,
            "hops": cap.hops,
            "transfer_allowed": cap.transfer_allowed,
            "shell_allowed": cap.shell_allowed,
            "reason_key": cap.reason_key,
        })
    }

    fn spawn_maintenance(&self, _event_tx: broadcast::Sender<String>) {
        let handle = self.handle.clone();
        let router = self.router.clone();
        let peer_via_cache = self.peer_via_cache.clone();
        let path_peer_cache = self.path_peer_cache.clone();
        let path_peer_cache_fetched_at = self.path_peer_cache_fetched_at.clone();
        let display_name_cache = self.display_name_cache.clone();
        let outbound = self.outbound.clone();
        let event_tx = self.event_tx.clone();
        let propagation = self.propagation.clone();
        let config_dir = self.config_dir.clone();
        let local_identity_hash = self.identity.hash;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(2));
            let mut known_path_hashes: HashSet<String> = HashSet::new();
            let mut prev_peer_by_hash: HashMap<String, PeerRow> = HashMap::new();
            let mut last_host_periodic_get_at: Option<Instant> = None;
            let mut host_periodic_get_rr: usize = 0;
            loop {
                interval.tick().await;
                // Keep Auto / private-LAN policy inputs fresh (host from config, online from stats).
                {
                    let config_rows =
                        config::interfaces_from_config_dir(&config_dir).unwrap_or_default();
                    let merged = if let Ok(Some(TransportQueryResponse::InterfaceStats(stats))) =
                        tokio::time::timeout(
                            TRANSPORT_QUERY_TIMEOUT,
                            handle.query_control(TransportQuery::GetInterfaceStats),
                        )
                        .await
                    {
                        let live_rows: Vec<InterfaceRow> = stats
                            .iter()
                            .enumerate()
                            .map(|(i, s)| {
                                let (tx_queue_used, tx_queue_max) = live_interface_tx_queue_fields(
                                    s.online,
                                    s.tx_queue_used,
                                    s.tx_queue_max,
                                );
                                InterfaceRow {
                                    id: format!("rns-{i}"),
                                    name: s.name.clone(),
                                    iface_type: s.mode.clone(),
                                    enabled: s.online,
                                    status: if s.online { "up" } else { "down" }.into(),
                                    host: None,
                                    port: None,
                                    preset: None,
                                    serial_port: None,
                                    frequency: None,
                                    bandwidth: None,
                                    txpower: None,
                                    spreading_factor: None,
                                    coding_rate: None,
                                    callsign: None,
                                    id_interval: None,
                                    mode: None,
                                    runtime_mode: live_interface_runtime_mode_if_online(
                                        s.online, &s.mode,
                                    ),
                                    seed_addresses: Vec::new(),
                                    discoverable: None,
                                    latitude: None,
                                    longitude: None,
                                    height: None,
                                    discovery_name: None,
                                    announce_interval_min: None,
                                    connectable: None,
                                    reachable_on: None,
                                    network_name: None,
                                    passphrase: None,
                                    flow_control: None,
                                    ignore_config_warnings: None,
                                    tx_queue_used,
                                    tx_queue_max,
                                    extra_config: std::collections::HashMap::new(),
                                }
                            })
                            .collect();
                        merge_live_interfaces_with_config(&config_rows, live_rows)
                    } else {
                        config_rows
                    };
                    if let Ok(mut driver) = outbound.lock() {
                        driver.update_interfaces(merged);
                    }
                }
                // Only replace the outbound path table on a successful GetPathTable.
                // Timeout/empty fallback must NOT wipe known routes (that forced every
                // LXMF send onto the propagation node with hasPath:false).
                let path_entries = if let Ok(Some(TransportQueryResponse::PathTable(entries))) =
                    tokio::time::timeout(
                        TRANSPORT_QUERY_TIMEOUT,
                        handle.query_control(TransportQuery::GetPathTable),
                    )
                    .await
                {
                    if let Ok(mut cache) = peer_via_cache.lock() {
                        cache.clear();
                        for entry in &entries {
                            let key = hex::encode(entry.hash);
                            cache.insert(key, entry.interface.clone());
                        }
                    }
                    let name_lookup = display_name_cache
                        .lock()
                        .ok()
                        .map(|c| c.clone())
                        .unwrap_or_default();
                    let pubkey_lookup = outbound
                        .lock()
                        .ok()
                        .map(|d| {
                            entries
                                .iter()
                                .filter_map(|e| {
                                    let destination_hash = hex::encode(e.hash);
                                    d.public_key_for(&destination_hash)
                                        .map(|pk| (destination_hash, hex::encode(pk)))
                                })
                                .collect::<HashMap<_, _>>()
                        })
                        .unwrap_or_default();
                    let peer_rows: Vec<PeerRow> = entries
                        .iter()
                        .map(|e| {
                            let destination_hash = hex::encode(e.hash);
                            let display_name = name_lookup.get(&destination_hash).cloned();
                            let public_key = pubkey_lookup.get(&destination_hash).cloned();
                            PeerRow {
                                destination_hash,
                                display_name,
                                hops: Some(e.hops),
                                last_seen: Some(e.timestamp as u64),
                                interface: Some(e.interface.clone()),
                                path_hash: e.via.map(hex::encode),
                                via_hash: e.via.map(hex::encode),
                                public_key,
                            }
                        })
                        .collect();
                    if let Ok(mut cache) = path_peer_cache.lock() {
                        *cache = peer_rows.clone();
                    }
                    if let Ok(mut at) = path_peer_cache_fetched_at.lock() {
                        *at = Some(Instant::now());
                    }
                    let next_hashes: HashSet<String> = peer_rows
                        .iter()
                        .map(|p| p.destination_hash.clone())
                        .collect();
                    let added = path_table_added_hashes_capped(&known_path_hashes, &next_hashes);
                    let mut patch_peers: Vec<&PeerRow> = Vec::new();
                    for peer in &peer_rows {
                        if added.iter().any(|h| h == &peer.destination_hash) {
                            patch_peers.push(peer);
                            continue;
                        }
                        match prev_peer_by_hash.get(&peer.destination_hash) {
                            Some(prev) if peer_route_fields_equal(prev, peer) => {}
                            _ if known_path_hashes.contains(&peer.destination_hash) => {
                                patch_peers.push(peer);
                            }
                            _ => {}
                        }
                    }
                    if patch_peers.len() > MAX_PEERS_UPDATED_ADDED {
                        patch_peers.truncate(MAX_PEERS_UPDATED_ADDED);
                    }
                    if !patch_peers.is_empty() {
                        let patches: Vec<serde_json::Value> = patch_peers
                            .iter()
                            .map(|p| {
                                serde_json::json!({
                                    "destination_hash": p.destination_hash,
                                    "display_name": p.display_name,
                                    "hops": p.hops,
                                    "last_seen": p.last_seen,
                                    "interface": p.interface,
                                    "path_hash": p.path_hash,
                                    "via_hash": p.via_hash,
                                    "public_key": p.public_key,
                                })
                            })
                            .collect();
                        let frame = serde_json::json!({
                            "type": "peers_updated",
                            "payload": {
                                "added": added,
                                "patches": patches,
                                "count": next_hashes.len(),
                            }
                        });
                        let _ = event_tx.send(frame.to_string());
                    }
                    known_path_hashes = next_hashes;
                    prev_peer_by_hash = peer_rows
                        .into_iter()
                        .map(|p| (p.destination_hash.clone(), p))
                        .collect();
                    Some(
                        entries
                            .iter()
                            .map(path_table_route_from_entry)
                            .collect::<Vec<_>>(),
                    )
                } else {
                    tracing::debug!(
                        "maintenance path table query timed out after {:?}; keeping prior routes",
                        TRANSPORT_QUERY_TIMEOUT
                    );
                    None
                };
                let need_inbox_drain = propagation.take_inbox_drain_request();
                let mut start_silent_get: Option<([u8; 16], &'static str)> = None;
                {
                    let mut router = router.lock().await;
                    if let Ok(mut driver) = outbound.lock() {
                        if let Some(ref entries) = path_entries {
                            driver.update_path_table(entries);
                        }
                        driver.process_tick(&mut router, &event_tx);
                        let known_identities = driver.known_identities_for_propagation();
                        let terminal = propagation.tick(&known_identities, &mut router);
                        if let Some((ok, peer_hash)) = terminal {
                            driver.set_propagation_sync_target(None);
                            // After host peer `/offer` Completes, pull our inbox from that
                            // peer via silent client `/get` (sequenced; no dual Link race).
                            if ok
                                && propagation.is_local_serving()
                                && !driver.has_inflight_delivery_to(&peer_hash)
                            {
                                propagation.queue_post_peer_get(peer_hash);
                            }
                        }
                        if let Some(peer_hash) = propagation.take_pending_post_peer_get() {
                            if propagation.is_local_serving()
                                && !propagation.sync_active()
                                && !driver.has_inflight_delivery_to(&peer_hash)
                                && driver.propagation_sync_target().is_none()
                            {
                                driver.set_propagation_sync_target(Some(peer_hash));
                                start_silent_get = Some((peer_hash, "get_post_peer"));
                            } else {
                                propagation.queue_post_peer_get(peer_hash);
                            }
                        }
                        // Host quiet-store inbox refresh (lxmd ~90s outbound /get parity).
                        let due_periodic = last_host_periodic_get_at
                            .is_none_or(|at| at.elapsed() >= HOST_PERIODIC_GET_INTERVAL);
                        if due_periodic
                            && start_silent_get.is_none()
                            && propagation.is_local_serving()
                            && !propagation.sync_active()
                            && !propagation.client_download_active()
                            && driver.propagation_sync_target().is_none()
                        {
                            if let Some(peer_hash) = next_host_periodic_get_target(
                                &router,
                                driver.preferred_pn_hash(),
                                &driver,
                                &mut host_periodic_get_rr,
                            ) {
                                if !driver.has_inflight_delivery_to(&peer_hash) {
                                    driver.set_propagation_sync_target(Some(peer_hash));
                                    start_silent_get = Some((peer_hash, "get_periodic"));
                                    last_host_periodic_get_at = Some(Instant::now());
                                }
                            } else {
                                // No eligible peer yet — still advance the timer so we do
                                // not spin every 2s while peers are missing identity.
                                last_host_periodic_get_at = Some(Instant::now());
                            }
                        }
                        // Local Host: push inventory to peered PNs when the sync task is idle
                        // and no user Sync / deposit / silent /get owns the PN Link.
                        if propagation.is_local_serving()
                            && !propagation.sync_active()
                            && !propagation.client_download_active()
                            && driver.propagation_sync_target().is_none()
                        {
                            drive_local_host_peer_sync(
                                &propagation,
                                &mut router,
                                &mut driver,
                                local_identity_hash,
                            );
                        }
                    }
                }
                // Peer Resource accept → drain our lxmf.delivery mail into Chat.
                if need_inbox_drain && propagation.is_local_serving() {
                    let bridge = Arc::clone(&propagation);
                    let router_for_drain = Arc::clone(&router);
                    tokio::spawn(async move {
                        let (messages, listed) =
                            match tokio::task::spawn_blocking(move || bridge.drain_local_inbox())
                                .await
                            {
                                Ok(result) => result,
                                Err(error) => {
                                    tracing::error!(
                                        target: "propagation-retrieve",
                                        error = %error,
                                        "local-prop inbox auto-drain join failed"
                                    );
                                    (Vec::new(), 0)
                                }
                            };
                        let delivered = messages.len();
                        if delivered > 0 {
                            let router = router_for_drain.lock().await;
                            if let Some(ref cb) = router.delivery_callback {
                                for msg in &messages {
                                    cb(msg);
                                }
                            }
                        }
                        tracing::info!(
                            target: "propagation-retrieve",
                            listed,
                            delivered,
                            retrieve_mode = "local",
                            "local-prop inbox auto-drain Completes"
                        );
                    });
                }
                if let Some((peer_hash, retrieve_mode)) = start_silent_get {
                    let pn_hex = hex::encode(peer_hash);
                    let outbound_for_clear = Arc::clone(&outbound);
                    // Only clear the sync latch when we still own this peer — a newer
                    // user Sync may have claimed the target after cancel_client_download.
                    let on_terminal: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                        if let Ok(mut driver) = outbound_for_clear.lock() {
                            if driver.propagation_sync_target() == Some(peer_hash) {
                                driver.clear_propagation_identity_pins();
                                driver.set_propagation_sync_target(None);
                            }
                        }
                    });
                    // Dedicated cancel; user Sync cancel_propagation_sync still
                    // cancel_client_download()s so this poll loop exits on Idle/Failed.
                    let cancel = Arc::new(AtomicBool::new(false));
                    let started = spawn_client_download_driver_task(
                        None,
                        Arc::clone(&propagation),
                        Arc::clone(&router),
                        Arc::clone(&outbound),
                        Arc::new(AtomicU64::new(0)),
                        peer_hash,
                        pn_hex.clone(),
                        cancel,
                        0,
                        event_tx.clone(),
                        Some(on_terminal),
                        false,
                        retrieve_mode,
                    );
                    if started {
                        tracing::info!(
                            target: "propagation-retrieve",
                            pn_hash = %pn_hex,
                            retrieve_mode,
                            "silent client /get queued"
                        );
                    } else if let Ok(mut driver) = outbound.lock() {
                        if driver.propagation_sync_target() == Some(peer_hash) {
                            driver.set_propagation_sync_target(None);
                        }
                        if retrieve_mode == "get_post_peer" {
                            propagation.queue_post_peer_get(peer_hash);
                        }
                    }
                }
                // Skip tick when outbound is locked — never drain LRPROOF against an empty map.
            }
        });
    }

    /// Register handler for announces carrying identity public keys (LXMF path proofs).
    ///
    /// `receive_path_responses: true` matches lxmd — path responses often carry the
    /// destination public key needed for Direct LRPROOF while already filling the path table.
    pub fn register_lxmf_identity_announce_handler(&self) {
        let transport_tx = self.handle.transport_tx.clone();
        let outbound = self.outbound.clone();
        let event_tx = self.event_tx.clone();
        let display_name_cache = self.display_name_cache.clone();
        let voice_session = self.voice_session.clone();
        tokio::spawn(async move {
            let (callback_tx, mut callback_rx) =
                tokio::sync::mpsc::channel::<AnnounceHandlerEvent>(256);
            if transport_tx
                .send(TransportMessage::RegisterAnnounceHandler {
                    aspect_filter: None,
                    receive_path_responses: true,
                    callback_tx,
                })
                .await
                .is_err()
            {
                tracing::warn!(
                    "LXMF identity announce handler registration failed: transport closed"
                );
                return;
            }

            // Coalesce WS emits: ≤1 frame per flush window (O(1) bus), even under
            // 100k-scale announce storms. Side effects (keys / name cache) stay immediate.
            let mut coalescer = AnnounceWsCoalescer::new();
            let mut window_start: Option<tokio::time::Instant> = None;
            loop {
                let flush_deadline =
                    window_start.map(|start| start + coalescer.coalesce_duration());
                tokio::select! {
                    evt = callback_rx.recv() => {
                        let Some(evt) = evt else { break; };
                        let dest_hex = hex::encode(evt.destination_hash);
                        if let Some(pub_key) = evt.public_key {
                            if let Ok(mut driver) = outbound.lock() {
                                driver.register_identity_key(&dest_hex, pub_key);
                            }
                        }
                        // Named announces update the display-name cache for peer labels only —
                        // do not upsert LXMF contacts (contacts are messaged / explicitly saved).
                        let display_name = parse_announce_display_name(evt.app_data.as_deref());
                        if let Some(ref name) = display_name {
                            if let Ok(mut cache) = display_name_cache.lock() {
                                insert_display_name_bounded(&mut cache, dest_hex.clone(), name.clone());
                            }
                        }
                        if coalescer.is_empty() {
                            window_start = Some(tokio::time::Instant::now());
                        }
                        let identity_hash_hex = evt.identity_hash.map(hex::encode);
                        if let Some(ref id_hex) = identity_hash_hex {
                            voice_session
                                .remember_identity_for_dest(&dest_hex, id_hex)
                                .await;
                        }
                        coalescer.push(AnnounceWsRow {
                            destination_hash: dest_hex,
                            display_name,
                            hops: evt.hops,
                            aspect: resolve_announce_aspect(&evt.name_hash).map(str::to_string),
                            identity_hash: identity_hash_hex,
                        });
                    }
                    () = async {
                        match flush_deadline {
                            Some(deadline) => tokio::time::sleep_until(deadline).await,
                            None => std::future::pending::<()>().await,
                        }
                    }, if flush_deadline.is_some() => {
                        let rows = coalescer.take_flush_rows();
                        window_start = None;
                        if let Some(frame) = build_announce_received_frame(&rows) {
                            let _ = event_tx.send(frame);
                        }
                    }
                }
            }
            // Drain any leftover pending on handler exit.
            let rows = coalescer.take_flush_rows();
            if let Some(frame) = build_announce_received_frame(&rows) {
                let _ = event_tx.send(frame);
            }
        });
    }

    /// Backfill `known_identities` from transport recent-announce cache (includes path responses).
    async fn hydrate_identity_from_recent_announces(&self, destination_hex: &str) -> bool {
        let already = self
            .outbound
            .lock()
            .map(|d| d.identity_known_for(destination_hex))
            .unwrap_or(false);
        if already {
            return true;
        }
        let resp = self
            .query_control_timed(TransportQuery::GetRecentAnnounces)
            .await;
        let Some(TransportQueryResponse::Announces(entries)) = resp else {
            return false;
        };
        let key = destination_hex.to_lowercase();
        let mut hydrated = false;
        for entry in &entries {
            let dest = hex::encode(entry.dest_hash);
            if dest.to_lowercase() != key {
                continue;
            }
            if let Some(pub_key) = entry.public_key {
                if let Ok(mut driver) = self.outbound.lock() {
                    driver.register_identity_key(&dest, pub_key);
                }
                hydrated = true;
                break;
            }
        }
        hydrated
    }

    /// Refresh outbound path table from transport when GetPathTable succeeds.
    async fn refresh_outbound_path_table(&self) -> bool {
        let Some(TransportQueryResponse::PathTable(entries)) =
            self.query_control_timed(TransportQuery::GetPathTable).await
        else {
            return false;
        };
        if let Ok(mut cache) = self.peer_via_cache.lock() {
            cache.clear();
            for entry in &entries {
                cache.insert(hex::encode(entry.hash), entry.interface.clone());
            }
        }
        let path_entries: Vec<PathTableRoute> =
            entries.iter().map(path_table_route_from_entry).collect();
        if let Ok(mut driver) = self.outbound.lock() {
            driver.update_path_table(&path_entries);
        }
        true
    }

    /// Discover a path to the destination before falling back to the propagation node.
    /// When `force` is true, drop any cached path and RequestPath so we wait for a
    /// fresh route response instead of returning on the stale `has_path_to` entry.
    async fn ensure_path_for_direct(&self, destination_hex: &str, force: bool) -> bool {
        self.ensure_path_for_direct_with_opts(destination_hex, force, Duration::from_secs(8), false)
            .await
            .ok
    }

    /// Shared path gate for offer probe + Sync (`PROPAGATION_PATH_UNKNOWN`).
    async fn ensure_propagation_path_or_unknown(
        &self,
        dest_hex: &str,
        force: bool,
    ) -> Result<(), String> {
        if self.ensure_path_for_direct(dest_hex, force).await {
            Ok(())
        } else {
            Err("PROPAGATION_PATH_UNKNOWN".into())
        }
    }

    /// Like [`Self::ensure_path_for_direct`], with a custom wait and optional
    /// fall-through when a forced DropPath never observes path absence (common
    /// on TCP hub routes that reinstall immediately).
    ///
    /// `ok` alone is not enough for Nomad TCP: `kind` distinguishes a cache hit,
    /// a real DropPath→RequestPath rediscovery, and stale accept fall-through.
    async fn ensure_path_for_direct_with_opts(
        &self,
        destination_hex: &str,
        force: bool,
        max_wait: Duration,
        accept_existing_on_timeout: bool,
    ) -> PathEnsureReport {
        let already = self
            .outbound
            .lock()
            .map(|d| d.has_path_to(destination_hex))
            .unwrap_or(false);
        if already && !force {
            return PathEnsureReport {
                ok: true,
                kind: PathEnsureKind::CachedHit,
                had_cached: true,
                saw_path_absent: false,
            };
        }
        let hops_before = self.hops_to_destination(destination_hex).await;
        let Ok(dest) = parse_hash16(destination_hex) else {
            return PathEnsureReport {
                ok: false,
                kind: PathEnsureKind::Missing,
                had_cached: already,
                saw_path_absent: false,
            };
        };

        // Drop the installed route first so the wait loop cannot succeed on the
        // same stale path-table entry (mirrors LXMF `drop_existing` path requests).
        let mut saw_path_absent = !(force && already);
        if force && already {
            let _ = self
                .query_control_timed(TransportQuery::DropPath { dest })
                .await;
            if let Ok(mut driver) = self.outbound.lock() {
                driver.clear_path_to(destination_hex);
            }
            if let Ok(mut cache) = self.peer_via_cache.lock() {
                cache.remove(&destination_hex.to_lowercase());
            }
            let _ = self.refresh_outbound_path_table().await;
            let still_present = self
                .outbound
                .lock()
                .map(|d| d.has_path_to(destination_hex))
                .unwrap_or(false);
            if !still_present {
                saw_path_absent = true;
            }
        }

        let _ = self
            .handle
            .transport_tx
            .send(TransportMessage::RequestPath {
                destination_hash: dest,
            })
            .await;
        let deadline = tokio::time::Instant::now() + max_wait;
        while tokio::time::Instant::now() < deadline {
            let _ = self.refresh_outbound_path_table().await;
            let has_path = self
                .outbound
                .lock()
                .map(|d| d.has_path_to(destination_hex))
                .unwrap_or(false);
            if !has_path {
                saw_path_absent = true;
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            if !force_path_refresh_accepts_current_path(force, already, saw_path_absent) {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            let hops_after = self.hops_to_destination(destination_hex).await;
            if force && hops_before != hops_after {
                tracing::info!(
                    target: "propagation-sync",
                    dest = %destination_hex,
                    hops_before = ?hops_before,
                    hops_after = ?hops_after,
                    "refreshed path hops before propagation sync"
                );
            }
            return PathEnsureReport {
                ok: true,
                kind: PathEnsureKind::Rediscovered,
                had_cached: already,
                saw_path_absent,
            };
        }
        // Forced refresh: only accept a path that passed the same absence gate as
        // the wait loop — never the never-invalidated stale route (unless Nomad
        // fall-through via accept_existing_on_timeout).
        let _ = self.refresh_outbound_path_table().await;
        let has_path = self
            .outbound
            .lock()
            .map(|d| d.has_path_to(destination_hex))
            .unwrap_or(false);
        let accept = force_path_refresh_timeout_accepts(
            force,
            already,
            has_path,
            saw_path_absent,
            accept_existing_on_timeout,
        );
        if force && already {
            tracing::info!(
                target: "propagation-sync",
                dest = %destination_hex,
                hops = ?hops_before,
                has_path,
                saw_path_absent,
                accept,
                accept_existing_on_timeout,
                "path refresh timed out after dropping cached route"
            );
        }
        PathEnsureReport {
            ok: accept,
            kind: path_ensure_kind_after_timeout(
                accept,
                force,
                already,
                saw_path_absent,
                accept_existing_on_timeout,
            ),
            had_cached: already,
            saw_path_absent,
        }
    }

    /// Ensure destination public key is known before choosing Direct delivery.
    async fn ensure_identity_for_direct(&self, destination_hex: &str) -> bool {
        if self
            .hydrate_identity_from_recent_announces(destination_hex)
            .await
        {
            return true;
        }
        let Ok(dest) = parse_hash16(destination_hex) else {
            return false;
        };
        let _ = self
            .handle
            .transport_tx
            .send(TransportMessage::RequestPath {
                destination_hash: dest,
            })
            .await;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            if self
                .outbound
                .lock()
                .map(|d| d.identity_known_for(destination_hex))
                .unwrap_or(false)
            {
                return true;
            }
            let _ = self
                .hydrate_identity_from_recent_announces(destination_hex)
                .await;
            if self
                .outbound
                .lock()
                .map(|d| d.identity_known_for(destination_hex))
                .unwrap_or(false)
            {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        false
    }

    /// Snapshot of RMAP v4 discovered interfaces from rsReticulum DiscoveryStore.
    pub async fn fetch_rmap_discovered(&self) -> Vec<super::rmap_discovery::RmapDiscoveredWireRow> {
        let rows = self.handle.discovered_interfaces().await;
        super::rmap_discovery::list_discovered_wire_rows_from_store(&rows)
    }

    /// Poll DiscoveryStore and emit `rmap.discovery` WebSocket events when the set changes.
    pub fn register_rmap_discovery_watcher(&self, event_tx: broadcast::Sender<String>) {
        let handle = self.handle.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(10));
            let mut last_fingerprint = String::new();
            loop {
                interval.tick().await;
                let rows = handle.discovered_interfaces().await;
                let wire = super::rmap_discovery::list_discovered_wire_rows_from_store(&rows);
                let fingerprint = serde_json::to_string(&wire).unwrap_or_default();
                if fingerprint == last_fingerprint {
                    continue;
                }
                last_fingerprint = fingerprint;
                let frame = serde_json::json!({
                    "type": "rmap.discovery",
                    "payload": { "discovered": wire },
                });
                let _ = event_tx.send(frame.to_string());
            }
        });
    }

    /// Build a signed outbound LXMF message whose [`LxMessage::hash`] matches
    /// Direct link-delivery completion events (Unsigned packs fail with `NotSigned`
    /// and leave the session stuck in `Transferring`).
    ///
    /// Reply fields (`FIELD_REPLY_TO` / optional `FIELD_REPLY_QUOTE`) are set
    /// before `sign()` so they are covered by the message hash.
    fn prepare_signed_outbound_lxmf(
        &self,
        dest: [u8; 16],
        title: &str,
        content: &str,
        method: DeliveryMethod,
        reply_to: Option<[u8; 32]>,
        reply_quote: Option<&str>,
    ) -> Result<(LxMessage, String), String> {
        self.prepare_signed_outbound_lxmf_with_audio(
            dest,
            title,
            content,
            method,
            reply_to,
            reply_quote,
            None,
        )
    }

    /// Like [`prepare_signed_outbound_lxmf`], optionally stamping native
    /// `FIELD_AUDIO` (voice memo) before `sign()` so it is covered by the hash.
    #[allow(clippy::too_many_arguments)] // mirrors prepare_signed_outbound_lxmf + optional audio bytes
    fn prepare_signed_outbound_lxmf_with_audio(
        &self,
        dest: [u8; 16],
        title: &str,
        content: &str,
        method: DeliveryMethod,
        reply_to: Option<[u8; 32]>,
        reply_quote: Option<&str>,
        audio: Option<&[u8]>,
    ) -> Result<(LxMessage, String), String> {
        let mut msg = LxMessage::new(
            dest,
            parse_hash16(&self.lxmf_hash_hex)?,
            title,
            content,
            method,
        );
        apply_reply_fields(&mut msg, reply_to, reply_quote);
        if let Some(bytes) = audio {
            if bytes.len() > MAX_LXMF_AUDIO_FIELD_BYTES {
                return Err(format!(
                    "audio_too_large: {} > {}",
                    bytes.len(),
                    MAX_LXMF_AUDIO_FIELD_BYTES
                ));
            }
            msg.set_audio_field(AM_OPUS_OGG, bytes)
                .map_err(|e| format!("lxmf set_audio_field: {e:?}"))?;
        }
        let signing_key = self
            .identity
            .get_signing_key()
            .ok_or_else(|| "lxmf sign: identity has no signing key".to_string())?;
        msg.sign(&signing_key)
            .map_err(|e| format!("lxmf sign: {e:?}"))?;
        let hash_hex = msg
            .hash
            .map(hex::encode)
            .ok_or_else(|| "lxmf hash missing after sign".to_string())?;
        Ok((msg, hash_hex))
    }

    /// Like [`prepare_signed_outbound_lxmf`](Self::prepare_signed_outbound_lxmf), but
    /// stamps arbitrary custom fields (e.g. LRGP's `FIELD_CUSTOM_TYPE` / `FIELD_CUSTOM_META`
    /// envelope bytes) before signing so they are covered by the message hash.
    fn prepare_signed_outbound_lxmf_with_fields(
        &self,
        dest: [u8; 16],
        title: &str,
        content: &str,
        method: DeliveryMethod,
        fields: &HashMap<u8, Vec<u8>>,
    ) -> Result<(LxMessage, String), String> {
        let mut msg = LxMessage::new(
            dest,
            parse_hash16(&self.lxmf_hash_hex)?,
            title,
            content,
            method,
        );
        for (&field_id, bytes) in fields {
            // LRGP packs native MessagePack field values (0xFB string / 0xFD map).
            // `set_field` would wrap those in BIN and break Python/Ratspeak peers.
            msg.set_msgpack_field(field_id, bytes.clone())
                .map_err(|e| format!("lxmf set_msgpack_field {field_id:#x}: {e}"))?;
        }
        let signing_key = self
            .identity
            .get_signing_key()
            .ok_or_else(|| "lxmf sign: identity has no signing key".to_string())?;
        msg.sign(&signing_key)
            .map_err(|e| format!("lxmf sign: {e:?}"))?;
        let hash_hex = msg
            .hash
            .map(hex::encode)
            .ok_or_else(|| "lxmf hash missing after sign".to_string())?;
        Ok((msg, hash_hex))
    }

    /// Resolve a Direct-vs-Propagated delivery method for an LRGP action, mirroring
    /// [`send_lxmf`](Self::send_lxmf)'s fallback chain. On `Err`, the caller must
    /// roll back the prepared action and return the JSON payload as-is.
    async fn resolve_game_delivery_method(
        &self,
        dest_hash: &str,
    ) -> Result<DeliveryMethod, serde_json::Value> {
        let (mut has_path, mut identity_known) = self
            .outbound
            .lock()
            .map(|d| (d.has_path_to(dest_hash), d.identity_known_for(dest_hash)))
            .unwrap_or((false, false));

        let preferred_pn_hash = {
            let router = self.router.lock().await;
            router.outbound_propagation_node.map(hex::encode)
        };
        let preferred_pn_set = preferred_pn_hash.is_some();
        if let Some(ref pn_hex) = preferred_pn_hash {
            let _ = self.refresh_pn_announce_costs(pn_hex).await;
        }

        if !has_path {
            has_path = self.ensure_path_for_direct(dest_hash, false).await;
        }
        if has_path && !identity_known {
            identity_known = self.ensure_identity_for_direct(dest_hash).await;
        }

        match lxmf_outbound::choose_lxmf_send_route(has_path, identity_known, preferred_pn_set) {
            lxmf_outbound::LxmfSendRoute::Direct => Ok(DeliveryMethod::Direct),
            lxmf_outbound::LxmfSendRoute::Propagated => Ok(DeliveryMethod::Propagated),
            lxmf_outbound::LxmfSendRoute::NoPropagationNode => Err(serde_json::json!({
                "ok": false,
                "error": "no_propagation_node",
                "destination_hash": dest_hash,
            })),
        }
    }

    /// Dispatch an LRGP game action: validate/snapshot via [`GamesSessionManager`],
    /// send the resulting envelope over LXMF (Direct-preferred, Propagated fallback),
    /// then commit or roll back the session mutation based on send outcome.
    pub async fn send_game_action(
        &self,
        dest_hash: &str,
        app_id: &str,
        command: &str,
        session_id: Option<&str>,
        payload: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let action = match self
            .games_session
            .prepare_action(dest_hash, app_id, command, session_id, payload)
        {
            Ok(a) => a,
            Err(e) => return Ok(serde_json::json!({ "ok": false, "error": e })),
        };

        let dest = match parse_hash16(&action.dest_hash) {
            Ok(d) => d,
            Err(e) => {
                self.games_session
                    .rollback_action(action, Some("invalid_dest_hash"));
                return Err(e);
            }
        };

        let delivery_method = match self.resolve_game_delivery_method(&action.dest_hash).await {
            Ok(m) => m,
            Err(no_route_json) => {
                self.games_session
                    .rollback_action(action, Some("no_propagation_node"));
                return Ok(no_route_json);
            }
        };

        let (msg, message_hash_hex) = match self.prepare_signed_outbound_lxmf_with_fields(
            dest,
            "",
            &action.fallback_text,
            delivery_method,
            &action.fields,
        ) {
            Ok(v) => v,
            Err(e) => {
                self.games_session
                    .rollback_action(action, Some("sign_failed"));
                return Err(e);
            }
        };

        let send_result = {
            let mut router = self.router.lock().await;
            let res = router.try_send(msg);
            if res.is_ok() {
                if let Ok(mut driver) = self.outbound.lock() {
                    driver.process_tick(&mut router, &self.event_tx);
                }
            }
            res
        };
        if let Err(e) = send_result {
            self.games_session
                .rollback_action(action, Some("send_failed"));
            return Err(format!("lxmf game action send: {e:?}"));
        }

        self.games_session
            .commit_action(&action, Some(&message_hash_hex));

        Ok(serde_json::json!({
            "ok": true,
            "app_id": action.app_id,
            "session_id": action.session_id,
            "destination_hash": action.dest_hash,
            "message_hash": message_hash_hex,
        }))
    }

    /// Resend the last *successfully sent* envelope for a session verbatim
    /// (same nonce). Envelopes are only cached after a successful LXMF send
    /// (`commit_action`); failed sends are rolled back and leave no resend
    /// cache entry. Does not re-dispatch game logic.
    pub async fn resend_last_game_action(
        &self,
        session_id: &str,
    ) -> Result<serde_json::Value, String> {
        let resend = match self.games_session.prepare_resend(session_id) {
            Ok(r) => r,
            Err(e) => return Ok(serde_json::json!({ "ok": false, "error": e })),
        };

        let dest = parse_hash16(&resend.dest_hash)?;
        let delivery_method = match self.resolve_game_delivery_method(&resend.dest_hash).await {
            Ok(m) => m,
            Err(no_route_json) => return Ok(no_route_json),
        };

        let (msg, message_hash_hex) = self.prepare_signed_outbound_lxmf_with_fields(
            dest,
            "",
            &resend.fallback_text,
            delivery_method,
            &resend.fields,
        )?;

        {
            let mut router = self.router.lock().await;
            router
                .try_send(msg)
                .map_err(|e| format!("lxmf game resend: {e:?}"))?;
            if let Ok(mut driver) = self.outbound.lock() {
                driver.process_tick(&mut router, &self.event_tx);
            }
        }

        self.games_session
            .emit_action_result(&resend.app_id, session_id, true, None);
        self.games_session.note_resend_enqueued(
            session_id,
            &resend.app_id,
            Some(&message_hash_hex),
        );

        Ok(serde_json::json!({
            "ok": true,
            "app_id": resend.app_id,
            "session_id": session_id,
            "destination_hash": resend.dest_hash,
            "message_hash": message_hash_hex,
        }))
    }

    pub async fn send_reaction(
        &self,
        req: &LxmfReactionRequest,
    ) -> Result<serde_json::Value, String> {
        let dest = parse_hash16(&req.destination_hash)?;
        let has_path = self
            .outbound
            .lock()
            .map(|d| d.has_path_to(&req.destination_hash))
            .unwrap_or(false);

        let delivery_method = if has_path {
            DeliveryMethod::Direct
        } else {
            let router = self.router.lock().await;
            if router.outbound_propagation_node.is_some() {
                DeliveryMethod::Propagated
            } else {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "no_propagation_node",
                    "destination_hash": req.destination_hash,
                }));
            }
        };

        // Stamp the standard LXMF FIELD_REACTION (0x40) so Ratspeak / Sideband peers
        // render a structured tapback. The emoji is always kept as message content so
        // clients that ignore 0x40 still show something. An unparsable target_hash is
        // treated as absent (send content-only) rather than poisoning the message.
        let reaction_target = parse_optional_reply_to_hash(Some(&req.target_hash));
        // Only surface structured reaction metadata to the renderer when the target hash parsed
        // cleanly. The content-only fallback below must omit `reaction_target` so downstream
        // consumers do not treat a plain-emoji send as a structured tapback.
        let reaction_target_out: Option<String> =
            reaction_target.as_ref().map(|_| req.target_hash.clone());
        let (msg, message_hash_hex) = if let Some(target) = reaction_target {
            let mut fields = HashMap::new();
            fields.insert(FIELD_REACTION, encode_reaction_field(&target, &req.emoji));
            self.prepare_signed_outbound_lxmf_with_fields(
                dest,
                "",
                &req.emoji,
                delivery_method,
                &fields,
            )?
        } else {
            tracing::warn!(
                target: "lxmf",
                "send_reaction: target_hash is not a 32-byte hex, sending content-only",
            );
            self.prepare_signed_outbound_lxmf(dest, "", &req.emoji, delivery_method, None, None)?
        };
        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf reaction send: {e:?}"))?;

        let ts_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000) as i64;
        let payload = serde_json::json!({
            "sender_hash": self.lxmf_hash_hex,
            "sender_name": self.display_name,
            "text": req.emoji,
            "timestamp": ts_ms,
            "to_hash": req.destination_hash,
            "reaction_target": reaction_target_out,
            "direction": "outbound",
            "message_hash": message_hash_hex,
            "delivery_status": "sending"
        });

        if let Ok(mut driver) = self.outbound.lock() {
            driver.process_tick(&mut router, &self.event_tx);
        }

        Ok(payload)
    }

    pub async fn set_local_propagation_serving(&self, enabled: bool) {
        let mut router = self.router.lock().await;
        self.propagation.set_local_serving(enabled, &mut router);
        drop(router);

        if enabled {
            let policy = self
                .pn_hosting_policy
                .lock()
                .ok()
                .map(|p| p.clone())
                .unwrap_or_default();
            let drain_bridge = Arc::clone(&self.propagation);
            let on_inbound_accepted: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                drain_bridge.request_inbox_drain();
            });
            if let Err(e) = self.prop_serve.start(
                &self.handle.transport_tx,
                &self.identity,
                self.propagation.local_dest_hash_bytes(),
                &self.propagation.local_node(),
                &policy,
                Some(on_inbound_accepted),
            ) {
                tracing::error!(target: "propagation-serve", "failed to start serve: {e}");
                let mut router = self.router.lock().await;
                self.propagation.set_local_serving(false, &mut router);
                if let Ok(mut driver) = self.outbound.lock() {
                    driver.set_local_prop_node(None);
                }
                return;
            }
            // Cascade Completes deposit into this store in-process (no self-Link).
            // Pin the lxmf.propagation dest pubkey for any Link fallback path.
            if let Ok(mut driver) = self.outbound.lock() {
                let local_hex = self.propagation.local_dest_hash_hex();
                driver.pin_identity_for_propagation(&local_hex, self.identity.get_public_key());
                driver.set_local_prop_node(Some(self.propagation.local_node()));
            }
            self.prop_announce.start(
                self.handle.transport_tx.clone(),
                self.identity.clone(),
                self.propagation.local_dest_hash_bytes(),
                Arc::clone(&self.pn_hosting_policy),
                policy.announce_at_start,
            );
        } else {
            self.prop_announce.stop();
            self.prop_serve.stop();
            if let Ok(mut driver) = self.outbound.lock() {
                driver.set_local_prop_node(None);
            }
        }
    }

    pub async fn apply_pn_hosting_policy(&self, policy: &PnHostingPolicy) -> Result<(), String> {
        {
            let mut slot = self
                .pn_hosting_policy
                .lock()
                .map_err(|_| "pn_hosting_policy_mutex_poisoned".to_string())?;
            *slot = policy.clone();
        }
        {
            let mut router = self.router.lock().await;
            apply_pn_hosting_policy_to_router(&mut router, policy);
        }
        if let Ok(mut node) = self.propagation.local_node().lock() {
            apply_pn_hosting_policy_to_node(&mut node, policy);
        }
        if let Ok(mut driver) = self.outbound.lock() {
            driver
                .set_propagation_max_message_size(policy.propagation_limit_kb.saturating_mul(1024));
        }
        // Restart announce loop with updated interval / name when serving.
        if self.propagation.is_local_serving() {
            self.prop_announce.start(
                self.handle.transport_tx.clone(),
                self.identity.clone(),
                self.propagation.local_dest_hash_bytes(),
                Arc::clone(&self.pn_hosting_policy),
                false,
            );
        }
        Ok(())
    }

    /// Lightweight `/offer` capability probe before persisting a remote PN.
    ///
    /// Returns `Ok(())` when the remote answers `/offer` (including LXMF offer
    /// errors that prove the handler ran). Hard-fails with
    /// `PROPAGATION_OFFER_UNSUPPORTED` only when the offer response is
    /// unrecognized (`Unknown`).
    pub async fn probe_propagation_offer(&self, destination_hash: &str) -> Result<(), String> {
        let dest_hex = destination_hash.trim().to_lowercase();
        let hash = parse_hash16(&dest_hex)?;
        self.cancel_propagation_sync().await;
        self.rehydrate_propagation_identities_from_persisted();
        let identity_ok = self.ensure_identity_for_direct(&dest_hex).await;
        self.ensure_propagation_path_or_unknown(&dest_hex, true)
            .await?;
        let identity_known_after = self
            .outbound
            .lock()
            .map(|d| d.identity_known_for(&dest_hex))
            .unwrap_or(false);
        if !identity_ok || !identity_known_after {
            return Err("PROPAGATION_IDENTITY_UNKNOWN".into());
        }
        let target_class = self.classify_propagation_sync_target(&dest_hex).await;
        if target_class == "delivery" || target_class == "other" {
            return Err("PROPAGATION_TARGET_NOT_PN".into());
        }
        let peering = self.resolve_propagation_peering(&dest_hex).await?;
        // Claim outbound sync target so PN deposits defer during the offer probe
        // (same latch as start_propagation_sync). cancel_propagation_sync clears it
        // on every polling exit; release immediately if start_sync never begins.
        if let Ok(mut driver) = self.outbound.lock() {
            driver.set_propagation_sync_target(Some(hash));
        }
        if !self.propagation.start_sync(hash, Some(peering)) {
            if let Ok(mut driver) = self.outbound.lock() {
                driver.set_propagation_sync_target(None);
            }
            return Err("PROPAGATION_OFFER_PROBE_FAILED".into());
        }

        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            if Instant::now() >= deadline {
                self.cancel_propagation_sync().await;
                return Err("PROPAGATION_OFFER_PROBE_TIMEOUT".into());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(err) = self.propagation.last_offer_error() {
                self.cancel_propagation_sync().await;
                return if err == "Unknown" {
                    Err("PROPAGATION_OFFER_UNSUPPORTED".into())
                } else {
                    // Handler ran (NoIdentity / InvalidKey / …) — path exists.
                    Ok(())
                };
            }
            if let Some(err) = self.propagation.last_establish_error() {
                self.cancel_propagation_sync().await;
                return Err(format!("propagation establish failed: {err}"));
            }
            let progress = self.propagation.sync_progress();
            let peak = self.propagation.last_peak_progress();
            // Offering / later stages prove /offer was accepted enough to proceed.
            // Peak survives tip's Complete/Failed → Idle collapse (live progress drops to 0).
            if progress >= 25.0 || peak >= 25.0 {
                self.cancel_propagation_sync().await;
                return Ok(());
            }
            if !self.propagation.sync_active() && progress <= 0.0 {
                if let Some(ok) = self.propagation.last_finished_ok() {
                    self.cancel_propagation_sync().await;
                    return if ok {
                        Ok(())
                    } else if self.propagation.last_offer_error() == Some("Unknown") {
                        Err("PROPAGATION_OFFER_UNSUPPORTED".into())
                    } else {
                        Err("PROPAGATION_OFFER_PROBE_FAILED".into())
                    };
                }
            }
        }
    }

    pub fn propagation_local_stats(&self) -> (usize, usize) {
        self.propagation.local_stats()
    }

    pub fn propagation_local_hash(&self) -> String {
        self.propagation.local_dest_hash_hex()
    }

    /// Classify a destination announce as an LXMF propagation node (or not).
    ///
    /// Sync links to non-PN destinations (hubs, lxmf.delivery, etc.) can complete the
    /// RNS handshake then hang forever on `/offer` — fail before Establishing when the
    /// announce positively identifies a non-PN. Missing/aged announces (`unknown`) are
    /// allowed when identity is already known (caller gates identity).
    async fn classify_propagation_sync_target(&self, destination_hex: &str) -> &'static str {
        let prop_nh = rns_identity::name_hash::name_hash("lxmf.propagation");
        let delivery_nh = rns_identity::name_hash::name_hash("lxmf.delivery");
        let resp = self
            .query_control_timed(TransportQuery::GetRecentAnnounces)
            .await;
        let Some(TransportQueryResponse::Announces(entries)) = resp else {
            return "unknown";
        };
        classify_propagation_target_name_hashes(
            destination_hex,
            &entries
                .iter()
                .map(|e| (hex::encode(e.dest_hash), e.name_hash))
                .collect::<Vec<_>>(),
            &prop_nh,
            &delivery_nh,
        )
    }

    pub async fn start_propagation_sync(
        self: Arc<Self>,
        destination_hash: &str,
    ) -> Result<(), String> {
        let hash = parse_hash16(destination_hash)?;
        let dest_hex = destination_hash.to_lowercase();
        // Cancel any in-flight sync/emitter before starting a new one.
        self.cancel_propagation_sync().await;
        // Claim the PN Link early so outbound packed deposits defer instead of racing.
        if let Ok(mut driver) = self.outbound.lock() {
            if driver.has_inflight_delivery_to(&hash) {
                tracing::info!(
                    target: "propagation-sync",
                    dest = %dest_hex,
                    "deferring propagation sync — outbound PN deposit already in flight"
                );
                return Err("PROPAGATION_SYNC_OUTBOUND_BUSY".into());
            }
            driver.set_propagation_sync_target(Some(hash));
        }
        // Re-apply persisted PN pubkey before identity wait (announce flood may have evicted it).
        self.rehydrate_propagation_identities_from_persisted();
        // Link proofs are ignored unless the destination pubkey is in known_identities.
        // Resolve identity before Establishing; hard path gate comes after announce settle
        // and before peering PoW (never start Establishing / stamp work without a path).
        let identity_ok = self.ensure_identity_for_direct(&dest_hex).await;
        let identity_known_after = self
            .outbound
            .lock()
            .map(|d| d.identity_known_for(&dest_hex))
            .unwrap_or(false);
        let target_class = self.classify_propagation_sync_target(&dest_hex).await;
        if !identity_ok || !identity_known_after {
            if let Ok(mut driver) = self.outbound.lock() {
                driver.set_propagation_sync_target(None);
            }
            return Err("PROPAGATION_IDENTITY_UNKNOWN".into());
        }
        // Only hard-reject destinations positively classified as non-PN.
        if target_class == "delivery" || target_class == "other" {
            if let Ok(mut driver) = self.outbound.lock() {
                driver.set_propagation_sync_target(None);
            }
            return Err("PROPAGATION_TARGET_NOT_PN".into());
        }
        // Fresh LXMF delivery announce so the PN can return LRPROOF (reverse path).
        let announced = self
            .ensure_lxmf_announce_for_propagation_sync(&dest_hex)
            .await;
        if announced {
            tracing::info!(
                target: "propagation-sync",
                dest = %dest_hex,
                settle_ms = PROPAGATION_SYNC_ANNOUNCE_SETTLE.as_millis(),
                "settling after LXMF announce before propagation sync"
            );
            tokio::time::sleep(PROPAGATION_SYNC_ANNOUNCE_SETTLE).await;
        }
        // After settle: bail if an outbound deposit claimed the PN Link.
        let outbound_busy = self
            .outbound
            .lock()
            .map(|d| d.has_inflight_delivery_to(&hash))
            .unwrap_or(false);
        if outbound_busy {
            if let Ok(mut driver) = self.outbound.lock() {
                driver.set_propagation_sync_target(None);
            }
            tracing::info!(
                target: "propagation-sync",
                dest = %dest_hex,
                "deferring propagation sync — outbound PN deposit in flight"
            );
            return Err("PROPAGATION_SYNC_OUTBOUND_BUSY".into());
        }
        // Hard path gate after announce settle so RequestPath can benefit from the announce.
        // Do this before peering PoW — nonzero peering_cost stamps are expensive and useless
        // when there is no path (would previously burn CPU then stall into syncTimedOut).
        let hops = self.hops_to_destination(&dest_hex).await;
        if let Err(err) = self
            .ensure_propagation_path_or_unknown(&dest_hex, false)
            .await
        {
            // Path gate awaits; only clear if we still own this attempt's latch.
            if let Ok(mut driver) = self.outbound.lock() {
                if driver.propagation_sync_target() == Some(hash) {
                    driver.set_propagation_sync_target(None);
                }
            }
            tracing::info!(
                target: "propagation-sync",
                dest = %dest_hex,
                hops = ?hops,
                "propagation sync aborted — no path to PN"
            );
            return Err(err);
        }
        // Pin PN pubkey for the duration of the client `/get` link so announce-flood
        // eviction cannot drop it before LRPROOF validation (see known_identities cap).
        let pinned = if let Ok(mut driver) = self.outbound.lock() {
            if let Some(pub_key) = driver.public_key_for(&dest_hex) {
                driver.pin_identity_for_propagation(&dest_hex, pub_key);
                true
            } else {
                false
            }
        } else {
            false
        };
        let local_serving = self.propagation.is_local_serving();
        let (msg_count, msg_bytes) = self.propagation.local_stats();
        tracing::info!(
            target: "propagation-sync",
            dest = %dest_hex,
            path_ok = true,
            hops = ?hops,
            pinned,
            local_serving,
            msg_count,
            msg_bytes,
            "starting remote propagation sync (client /get; peer /offer deferred to host loop)"
        );
        // Fresh cancel token + generation so a prior emitter cannot cancel/clear this run.
        let (cancel, run_id) = {
            let Ok(_lifecycle) = self.propagation.lock_sync_lifecycle() else {
                if let Ok(mut driver) = self.outbound.lock() {
                    driver.set_propagation_sync_target(None);
                }
                return Err("propagation sync unavailable".into());
            };
            let Ok(mut slot) = self.sync_cancel.lock() else {
                if let Ok(mut driver) = self.outbound.lock() {
                    driver.set_propagation_sync_target(None);
                }
                return Err("propagation sync unavailable".into());
            };
            let cancel = Arc::new(AtomicBool::new(false));
            *slot = Arc::clone(&cancel);
            let run_id = self.sync_run_id.fetch_add(1, Ordering::SeqCst) + 1;
            (cancel, run_id)
        };
        // User Sync retrieves inbox mail via client `/get` (Python
        // `request_messages_from_propagation_node`). Peer `/offer` inventory push is
        // owned by the local-host peer loop when serving — running it here with a
        // nonempty messagestore hangs at AwaitingResponse against remotes that are
        // not our peers, and the UI progress bar never Completes.
        let outbound = Arc::clone(&self.outbound);
        let on_terminal: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Ok(mut driver) = outbound.lock() {
                // Guard against clearing a superseded Sync/silent owner.
                if driver.propagation_sync_target() == Some(hash) {
                    driver.clear_propagation_identity_pins();
                    driver.set_propagation_sync_target(None);
                }
            }
        });
        if !self.spawn_client_download_driver(
            Some(Arc::clone(&self)),
            hash,
            dest_hex.clone(),
            Arc::clone(&cancel),
            run_id,
            self.event_tx.clone(),
            Some(on_terminal),
            true,
        ) {
            // Download did not start — drop our claim only if we still own this hash.
            // Never wipe another owner's latch (overlapping silent `/get` / Sync).
            if let Ok(mut driver) = self.outbound.lock() {
                if driver.propagation_sync_target() == Some(hash) {
                    driver.clear_propagation_identity_pins();
                    driver.set_propagation_sync_target(None);
                }
            }
            // Client `/get` already in flight (host silent retrieve / prior Sync).
            return Err("PROPAGATION_RETRIEVE_BUSY".into());
        }
        Ok(())
    }

    /// Drive the client `/get` download to completion.
    ///
    /// When `emit_ui` is true, emits Sync UI progress over WS. Host-loop retrieves
    /// after peer `/offer` Completes use `emit_ui: false` so they do not stomp the
    /// user's Sync bar.
    ///
    /// Ticks [`PropagationBridge::poll_client_download`] on a short interval,
    /// feeding it the current known-identity map (for link-proof validation) and,
    /// on a terminal Complete, delivering each decoded message through the router
    /// delivery callback — the same path Direct/opportunistic inbound uses, so WS
    /// `lxmf_message`, the recent ring, and renderer catch-up all fire unchanged.
    ///
    /// Returns `false` when the client refuses to start (already active).
    #[allow(clippy::too_many_arguments)] // shared /get driver args mirror spawn_client_download_driver_task
    fn spawn_client_download_driver(
        &self,
        live: Option<Arc<LiveBridge>>,
        pn_hash: [u8; 16],
        pn_hex: String,
        cancel: Arc<AtomicBool>,
        run_id: u64,
        event_tx: broadcast::Sender<String>,
        on_terminal: Option<Arc<dyn Fn() + Send + Sync>>,
        emit_ui: bool,
    ) -> bool {
        spawn_client_download_driver_task(
            live,
            Arc::clone(&self.propagation),
            Arc::clone(&self.router),
            Arc::clone(&self.outbound),
            Arc::clone(&self.sync_run_id),
            pn_hash,
            pn_hex,
            cancel,
            run_id,
            event_tx,
            on_terminal,
            emit_ui,
            if emit_ui { "get" } else { "get_post_peer" },
        )
    }

    /// Drain the in-process (`local-prop`) PN store of our own mail into Chat.
    ///
    /// `local-prop` Sync has no remote link to `/get` against, so we replay the
    /// local node's own list → serve → purge and deliver each decoded message
    /// through the router callback (same ingest as remote retrieval). Returns the
    /// number of messages delivered.
    pub async fn drain_local_propagation_inbox(&self) -> usize {
        // The drain does blocking file I/O + per-message decryption; run it off
        // the async worker so it cannot stall the runtime.
        let bridge = Arc::clone(&self.propagation);
        let (messages, listed) = tokio::task::spawn_blocking(move || bridge.drain_local_inbox())
            .await
            .unwrap_or_else(|_| (Vec::new(), 0));
        let delivered = messages.len();
        if delivered > 0 {
            let router = self.router.lock().await;
            if let Some(ref cb) = router.delivery_callback {
                for msg in &messages {
                    cb(msg);
                }
            }
        }
        tracing::info!(
            target: "propagation-retrieve",
            listed,
            delivered,
            retrieve_mode = "local",
            "local-prop inbox drain Completes"
        );
        delivered
    }

    /// Resolve identity hashes + peering stamp for a remote LXMF PN `/offer`.
    ///
    /// PNs with peering_cost > 0 reject empty keys (`ErrorInvalidKey`). When cost is 0,
    /// an empty key is valid and we still pass identity hashes for completeness.
    async fn resolve_propagation_peering(
        &self,
        destination_hex: &str,
    ) -> Result<([u8; 16], [u8; 16], u8, Option<Vec<u8>>), String> {
        let pub_key = self
            .outbound
            .lock()
            .ok()
            .and_then(|d| d.public_key_for(destination_hex))
            .ok_or_else(|| "PROPAGATION_IDENTITY_UNKNOWN".to_string())?;
        let peer_identity = Identity::from_public_key(&pub_key)
            .map_err(|e| format!("PROPAGATION_IDENTITY_UNKNOWN: {e}"))?;
        let peer_id = peer_identity.hash;
        let local_id = self.identity.hash;
        let peering_cost = self
            .refresh_pn_announce_costs(destination_hex)
            .await
            .map(|(_, peering)| peering)
            .unwrap_or(lxmf_core::constants::PEERING_COST);
        let max_cost = self
            .pn_hosting_policy
            .lock()
            .ok()
            .map(|p| p.max_peering_cost)
            .unwrap_or(lxmf_core::constants::MAX_PEERING_COST);
        if peering_cost > max_cost {
            return Err("PROPAGATION_PEER_COST_EXCEEDS_MAX".into());
        }
        let precomputed = if peering_cost == 0 {
            Some(Vec::new())
        } else {
            let stamp = tokio::task::spawn_blocking(move || {
                let mut peering_id = Vec::with_capacity(32);
                peering_id.extend_from_slice(&peer_id);
                peering_id.extend_from_slice(&local_id);
                lxmf_core::stamper::generate_stamp(
                    &peering_id,
                    peering_cost,
                    lxmf_core::constants::STAMP_WORKBLOCK_EXPAND_ROUNDS_PEERING,
                )
                .map(|(stamp, _)| stamp.to_vec())
            })
            .await
            .map_err(|e| format!("PROPAGATION_PEERING_STAMP_FAILED: {e}"))?
            .ok_or_else(|| "PROPAGATION_PEERING_STAMP_FAILED".to_string())?;
            Some(stamp)
        };
        Ok((local_id, peer_id, peering_cost, precomputed))
    }

    /// Learn PN stamp/peering costs from a recent `lxmf.propagation` announce (lxmd parity).
    /// Returns `(stamp_cost, peering_cost)` when found.
    async fn refresh_pn_announce_costs(&self, destination_hex: &str) -> Option<(u8, u8)> {
        let resp = self
            .query_control_timed(TransportQuery::GetRecentAnnounces)
            .await;
        let TransportQueryResponse::Announces(entries) = resp? else {
            return None;
        };
        let key = destination_hex.to_lowercase();
        for entry in &entries {
            if hex::encode(entry.dest_hash).to_lowercase() != key {
                continue;
            }
            let parsed = entry
                .app_data
                .as_deref()
                .and_then(lxmf_core::handlers::parse_pn_announce_data)?;
            let mut router = self.router.lock().await;
            router.set_stamp_cost(entry.dest_hash, parsed.stamp_cost);
            tracing::info!(
                target: "propagation-sync",
                dest = %key,
                stamp_cost = parsed.stamp_cost,
                peering_cost = parsed.peering_cost,
                "cached PN announce stamp/peering costs"
            );
            return Some((parsed.stamp_cost, parsed.peering_cost));
        }
        None
    }

    pub fn propagation_is_local_serving(&self) -> bool {
        self.propagation.is_local_serving()
    }

    pub async fn wait_propagation_messagestore_loaded(&self) -> Result<(), String> {
        self.propagation.wait_messagestore_loaded().await
    }

    /// True while the local PN messagestore is still loading (serve is deferred until then).
    pub fn propagation_messagestore_load_pending(&self) -> bool {
        self.propagation.messagestore_load_pending()
    }

    #[allow(clippy::unused_async, clippy::unused_async_trait_impl)] // async matches StackHandle propagation cancel API
    pub async fn cancel_propagation_sync(&self) {
        // Invalidate in-flight emitters before flipping cancel / clearing pins.
        // Hold lifecycle so emitter check+effect cannot race this generation bump.
        let _lifecycle = self.propagation.lock_sync_lifecycle().ok();
        self.sync_run_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(slot) = self.sync_cancel.lock() {
            slot.store(true, Ordering::SeqCst);
        }
        self.propagation.cancel_sync();
        self.propagation.cancel_client_download();
        self.propagation.clear_pending_post_peer_get();
        if let Ok(mut driver) = self.outbound.lock() {
            driver.clear_propagation_identity_pins();
            driver.set_propagation_sync_target(None);
        }
    }

    pub async fn set_outbound_propagation_node(&self, destination_hash: Option<&str>) {
        let hash = destination_hash.and_then(lxmf_outbound::parse_propagation_hash);
        let mut router = self.router.lock().await;
        if let Ok(mut driver) = self.outbound.lock() {
            driver.set_propagation_node(&mut router, hash);
        }
        drop(router);
        if let Some(hex) = destination_hash {
            let _ = self.refresh_pn_announce_costs(hex).await;
        }
    }

    /// Rebuild Direct→PN cascade candidate list from persisted propagation rows.
    ///
    /// Propagation mode `Off` yields an empty list, so Direct failures never deposit on a
    /// remote PN or the local inbox.
    pub async fn refresh_pn_cascade_candidates(&self) {
        rebuild_pn_cascade_candidates(
            &self.persisted,
            &self.discovered_propagation,
            &self.outbound,
            &self.pn_hosting_policy,
        )
        .await;
    }

    pub async fn fetch_interfaces(&self) -> Result<Vec<InterfaceRow>, String> {
        let config_rows =
            super::config::interfaces_from_config_dir(&self.config_dir).unwrap_or_default();
        let resp = self
            .query_control_timed(TransportQuery::GetInterfaceStats)
            .await;
        let Some(TransportQueryResponse::InterfaceStats(stats)) = resp else {
            tracing::debug!("live fetch_interfaces unavailable, using config rows");
            return Ok(config_rows);
        };
        let live_rows: Vec<InterfaceRow> = stats
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let (tx_queue_used, tx_queue_max) =
                    live_interface_tx_queue_fields(s.online, s.tx_queue_used, s.tx_queue_max);
                InterfaceRow {
                    id: format!("rns-{i}"),
                    name: s.name.clone(),
                    iface_type: s.mode.clone(),
                    enabled: s.online,
                    status: if s.online { "up" } else { "down" }.into(),
                    host: None,
                    port: None,
                    preset: None,
                    serial_port: None,
                    frequency: None,
                    bandwidth: None,
                    txpower: None,
                    spreading_factor: None,
                    coding_rate: None,
                    callsign: None,
                    id_interval: None,
                    mode: None,
                    runtime_mode: live_interface_runtime_mode_if_online(s.online, &s.mode),
                    seed_addresses: Vec::new(),
                    discoverable: None,
                    latitude: None,
                    longitude: None,
                    height: None,
                    discovery_name: None,
                    announce_interval_min: None,
                    connectable: None,
                    reachable_on: None,
                    network_name: None,
                    passphrase: None,
                    flow_control: None,
                    ignore_config_warnings: None,
                    tx_queue_used,
                    tx_queue_max,
                    extra_config: std::collections::HashMap::new(),
                }
            })
            .collect();
        Ok(merge_live_interfaces_with_config(&config_rows, live_rows))
    }

    /// Snapshot of LXMF / Nomad announce display names (labels only — not contacts).
    pub fn display_name_snapshot(&self) -> HashMap<String, String> {
        self.display_name_cache
            .lock()
            .map(|cache| cache.clone())
            .unwrap_or_default()
    }

    /// Local identity public key as 128 lowercase hex (X25519 ∥ Ed25519).
    pub fn identity_public_key_hex(&self) -> String {
        hex::encode(self.identity.get_public_key())
    }

    /// Register a peer destination public key for Direct LXMF / Columba QR import.
    pub fn register_known_identity(
        &self,
        destination_hash: &str,
        public_key: [u8; 64],
    ) -> Result<(), String> {
        let mut driver = self
            .outbound
            .lock()
            .map_err(|_| "outbound driver lock poisoned".to_string())?;
        driver.register_identity_key(destination_hash, public_key);
        Ok(())
    }

    /// Fetch path-table peers. When `force` is false and the maintenance cache is
    /// fresher than [`PATH_PEER_CACHE_TTL`], return that snapshot (avoids a second
    /// GetPathTable on every automatic poll).
    pub async fn fetch_peers(&self, force: bool) -> Result<Vec<PeerRow>, String> {
        if !force {
            if let (Ok(cache), Ok(at)) = (
                self.path_peer_cache.lock(),
                self.path_peer_cache_fetched_at.lock(),
            ) {
                if let Some(fetched_at) = *at {
                    if fetched_at.elapsed() < PATH_PEER_CACHE_TTL && !cache.is_empty() {
                        return Ok(cache.clone());
                    }
                }
            }
        }
        let resp = self.query_control_timed(TransportQuery::GetPathTable).await;
        let Some(TransportQueryResponse::PathTable(entries)) = resp else {
            return Err("path table query timed out or unavailable".into());
        };
        if let Ok(mut cache) = self.peer_via_cache.lock() {
            cache.clear();
            for entry in &entries {
                let key = hex::encode(entry.hash);
                cache.insert(key, entry.interface.clone());
            }
        }
        let name_lookup = self
            .display_name_cache
            .lock()
            .ok()
            .map(|c| c.clone())
            .unwrap_or_default();
        let pubkey_lookup = self
            .outbound
            .lock()
            .ok()
            .map(|d| {
                // Collect known keys once per fetch to avoid locking per peer.
                entries
                    .iter()
                    .filter_map(|e| {
                        let destination_hash = hex::encode(e.hash);
                        d.public_key_for(&destination_hash)
                            .map(|pk| (destination_hash, hex::encode(pk)))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();
        let peers: Vec<PeerRow> = entries
            .iter()
            .map(|e| {
                let destination_hash = hex::encode(e.hash);
                let display_name = name_lookup.get(&destination_hash).cloned();
                let public_key = pubkey_lookup.get(&destination_hash).cloned();
                PeerRow {
                    destination_hash,
                    display_name,
                    hops: Some(e.hops),
                    last_seen: Some(e.timestamp as u64),
                    interface: Some(e.interface.clone()),
                    path_hash: e.via.map(hex::encode),
                    via_hash: e.via.map(hex::encode),
                    public_key,
                }
            })
            .collect();
        if let Ok(mut cache) = self.path_peer_cache.lock() {
            *cache = peers.clone();
        }
        if let Ok(mut at) = self.path_peer_cache_fetched_at.lock() {
            *at = Some(Instant::now());
        }
        Ok(peers)
    }

    pub async fn request_path(&self, hash: &str) -> Result<(), String> {
        let dest = parse_hash16(hash)?;
        self.handle
            .transport_tx
            .send(TransportMessage::RequestPath {
                destination_hash: dest,
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// Drop any cached route, then RequestPath so path ranking can move off stale TCP slots.
    pub async fn request_path_force(&self, hash: &str) -> Result<(), String> {
        let dest = parse_hash16(hash)?;
        let _ = self
            .query_control_timed(TransportQuery::DropPath { dest })
            .await;
        if let Ok(mut driver) = self.outbound.lock() {
            driver.clear_path_to(hash);
        }
        if let Ok(mut cache) = self.peer_via_cache.lock() {
            cache.remove(&hash.to_lowercase());
        }
        let _ = self.refresh_outbound_path_table().await;
        self.request_path(hash).await
    }

    pub async fn probe_peer(&self, hash: &str) -> Result<serde_json::Value, String> {
        let dest = parse_hash16(hash)?;
        match self
            .handle
            .await_path(dest, std::time::Duration::from_secs(8))
            .await
        {
            Ok(hops) => Ok(serde_json::json!({ "ok": true, "hops": hops })),
            Err(e) => Ok(serde_json::json!({ "ok": false, "error": format!("{e:?}") })),
        }
    }

    /// Apply the global path-medium preference; returns destinations rerouted.
    pub async fn apply_path_medium_preference(
        &self,
        preference: PathMediumPreferenceSetting,
    ) -> Result<i64, String> {
        let resp = self
            .query_control_timed(TransportQuery::SetPathMediumPreference {
                preference: path_medium::to_transport_preference(preference),
            })
            .await;
        match resp {
            Some(TransportQueryResponse::IntResult(rerouted)) => Ok(rerouted),
            _ => Err("path_medium_preference_apply_failed".into()),
        }
    }

    /// Pin (or unpin with `None`) one destination to a medium; returns whether the active route moved.
    pub async fn apply_peer_medium_pin(
        &self,
        hash: &str,
        pin: Option<PathMediumSetting>,
    ) -> Result<bool, String> {
        let dest = parse_hash16(hash)?;
        let resp = self
            .query_control_timed(TransportQuery::SetPeerMediumPin {
                dest,
                pin: pin.map(path_medium::to_transport_medium),
            })
            .await;
        match resp {
            Some(TransportQueryResponse::BoolResult(moved)) => Ok(moved),
            _ => Err("peer_medium_pin_apply_failed".into()),
        }
    }

    /// Ranked path slots for `hash` (active first) plus the preference the transport applies there.
    pub async fn path_slots(
        &self,
        hash: &str,
    ) -> Result<(Vec<serde_json::Value>, PathMediumPreferenceSetting), String> {
        let dest = parse_hash16(hash)?;
        let resp = self
            .query_control_timed(TransportQuery::GetPathSlots { dest })
            .await;
        let Some(TransportQueryResponse::PathSlots(entry)) = resp else {
            return Err("path_slots_query_failed".into());
        };
        let paths = entry
            .slots
            .iter()
            .map(|slot| {
                serde_json::json!({
                    "active": slot.active,
                    "hops": slot.hops,
                    "via_hash": slot.via.map(hex::encode),
                    "interface": slot.interface,
                    "interface_id": slot.interface_id,
                    "medium": slot.medium.as_str(),
                    "timestamp": slot.timestamp,
                    "expires": slot.expires,
                    "expired": slot.expired,
                })
            })
            .collect();
        Ok((
            paths,
            path_medium::from_transport_preference(entry.preference),
        ))
    }

    pub async fn send_lxmf(&self, req: &LxmfSendRequest) -> Result<serde_json::Value, String> {
        let dest = parse_hash16(&req.destination_hash)?;
        let (mut has_path, mut identity_known) = self
            .outbound
            .lock()
            .map(|d| {
                (
                    d.has_path_to(&req.destination_hash),
                    d.identity_known_for(&req.destination_hash),
                )
            })
            .unwrap_or((false, false));

        let preferred_pn_hash = {
            let router = self.router.lock().await;
            router.outbound_propagation_node.map(hex::encode)
        };
        let preferred_pn_set = preferred_pn_hash.is_some();
        // Ensure preferred PN stamp cost is cached before any Direct→Propagated fallback pack.
        if let Some(ref pn_hex) = preferred_pn_hash {
            let _ = self.refresh_pn_announce_costs(pn_hex).await;
        }

        // Prefer Direct when a path can be discovered — do not immediately park on
        // the preferred PN just because the local path table was empty at click time.
        if !has_path {
            has_path = self
                .ensure_path_for_direct(&req.destination_hash, false)
                .await;
        }
        // Path alone is not enough for Direct (LRPROOF needs pubkey). Learn it from
        // recent announces / path responses before deciding Propagated.
        if has_path && !identity_known {
            identity_known = self.ensure_identity_for_direct(&req.destination_hash).await;
        }

        let delivery_method =
            match lxmf_outbound::choose_lxmf_send_route(has_path, identity_known, preferred_pn_set)
            {
                lxmf_outbound::LxmfSendRoute::Direct => DeliveryMethod::Direct,
                lxmf_outbound::LxmfSendRoute::Propagated => DeliveryMethod::Propagated,
                lxmf_outbound::LxmfSendRoute::NoPropagationNode => {
                    return Ok(serde_json::json!({
                        "ok": false,
                        "error": "no_propagation_node",
                        "destination_hash": req.destination_hash,
                    }));
                }
            };
        let delivery_method_str = match delivery_method {
            DeliveryMethod::Direct => "direct",
            DeliveryMethod::Propagated => "propagated",
            DeliveryMethod::Opportunistic => "opportunistic",
            DeliveryMethod::Paper => "paper",
        };

        let ifaces = self.fetch_interfaces().await.unwrap_or_default();
        let egress_via = self.resolve_lxmf_egress_via(
            &ifaces,
            &req.destination_hash,
            delivery_method,
            preferred_pn_hash.as_deref(),
        );

        let send_started_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let reply_to = parse_optional_reply_to_hash(req.reply_to_hash.as_deref());
        let reply_quote = req
            .reply_preview_text
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty());
        let audio_bytes = decode_lxmf_audio_request(req.audio.as_ref())?;
        let content = if req.text.trim().is_empty() && audio_bytes.is_some() {
            "[voice:0]".to_string()
        } else {
            req.text.clone()
        };
        let (msg, message_hash_hex) = self.prepare_signed_outbound_lxmf_with_audio(
            dest,
            "",
            &content,
            delivery_method,
            reply_to,
            reply_quote,
            audio_bytes.as_deref(),
        )?;
        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf send: {e:?}"))?;

        let ts_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000) as i64;
        let reply_to_hash_echo = reply_to
            .map(hex::encode)
            .or_else(|| req.reply_to_hash.clone());
        let mut payload = serde_json::json!({
            "sender_hash": self.lxmf_hash_hex,
            "sender_name": self.display_name,
            "text": content,
            "timestamp": ts_ms,
            "to_hash": req.destination_hash,
            "reply_to_hash": reply_to_hash_echo,
            "reply_to_id": req.reply_to_id,
            "direction": "outbound",
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "received_via": egress_via,
            "delivery_status": "sending",
            "message_hash": message_hash_hex.clone(),
        });
        if let Some(quote) = reply_quote {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert(
                    "reply_preview_text".into(),
                    serde_json::Value::String(quote.to_string()),
                );
            }
        }
        if let Some(ref bytes) = audio_bytes {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("audio".into(), audio_json_from_bytes(AM_OPUS_OGG, bytes));
            }
        }

        if let Ok(mut driver) = self.outbound.lock() {
            driver.process_tick(&mut router, &self.event_tx);
        }

        self.schedule_egress_tap_upgrade(
            message_hash_hex.clone(),
            req.destination_hash.clone(),
            preferred_pn_hash,
            egress_via.clone(),
            ifaces,
            send_started_ms,
        );

        Ok(serde_json::json!({
            "ok": true,
            "destination_hash": req.destination_hash,
            "text": content,
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "delivery_status": "queued",
            "message": payload
        }))
    }

    /// Encode a signed LXMF message as an encrypted `lxm://` paper URI (no network send).
    pub async fn create_lxmf_paper(
        &self,
        req: &LxmfSendRequest,
    ) -> Result<serde_json::Value, String> {
        let dest = parse_hash16(&req.destination_hash)?;
        let mut identity_known = self
            .outbound
            .lock()
            .map(|d| d.identity_known_for(&req.destination_hash))
            .unwrap_or(false);
        if !identity_known {
            identity_known = self.ensure_identity_for_direct(&req.destination_hash).await;
        }
        if !identity_known {
            return Ok(serde_json::json!({
                "ok": false,
                "error": "identity_unknown",
                "destination_hash": req.destination_hash,
            }));
        }

        let reply_to = parse_optional_reply_to_hash(req.reply_to_hash.as_deref());
        let reply_quote = req
            .reply_preview_text
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty());
        let (msg, message_hash_hex) = self.prepare_signed_outbound_lxmf(
            dest,
            "",
            &req.text,
            DeliveryMethod::Paper,
            reply_to,
            reply_quote,
        )?;

        let dest_hex = req.destination_hash.to_lowercase();
        let uri_result = {
            let driver = self
                .outbound
                .lock()
                .map_err(|_| "outbound lock poisoned".to_string())?;
            msg.to_paper_uri(|plaintext| {
                driver
                    .encrypt_for_destination(&dest_hex, plaintext)
                    .ok_or_else(|| {
                        lxmf_core::message::MessageError::PackFailed(format!(
                            "no identity key for destination {dest_hex}"
                        ))
                    })
            })
        };
        let uri = match uri_result {
            Ok(uri) => uri,
            Err(lxmf_core::message::MessageError::PackFailed(ref s))
                if s.contains("exceeds maximum size") =>
            {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "paper_too_large",
                }));
            }
            Err(lxmf_core::message::MessageError::PackFailed(ref s))
                if s.contains("no identity key") =>
            {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "identity_unknown",
                    "destination_hash": req.destination_hash,
                }));
            }
            Err(_other) => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "internal_error",
                }));
            }
        };

        let ts_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000) as i64;
        let reply_to_hash_echo = reply_to
            .map(hex::encode)
            .or_else(|| req.reply_to_hash.clone());
        let mut payload = serde_json::json!({
            "sender_hash": self.lxmf_hash_hex,
            "sender_name": self.display_name,
            "text": req.text,
            "timestamp": ts_ms,
            "to_hash": req.destination_hash,
            "reply_to_hash": reply_to_hash_echo,
            "reply_to_id": req.reply_to_id,
            "direction": "outbound",
            "delivery_method": "paper",
            "sent_via": "paper",
            "received_via": "paper",
            "delivery_status": "delivered",
            "message_hash": message_hash_hex.clone(),
        });
        if let Some(quote) = reply_quote {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert(
                    "reply_preview_text".into(),
                    serde_json::Value::String(quote.to_string()),
                );
            }
        }

        Ok(serde_json::json!({
            "ok": true,
            "uri": uri,
            "message_hash": message_hash_hex,
            "delivery_method": "paper",
            "message": payload,
        }))
    }

    /// Decrypt an `lxm://` paper URI with the local identity and deliver as inbound LXMF.
    pub async fn ingest_lxmf_paper(&self, uri: &str) -> Result<serde_json::Value, String> {
        // PAPER_MDU ciphertext bound + dest hash + base64url overhead; reject before router lock.
        const MAX_PAPER_URI_CHARS: usize = 16_384;
        let trimmed = uri.trim();
        if trimmed.is_empty() {
            return Ok(serde_json::json!({
                "ok": false,
                "error": "invalid_uri",
            }));
        }
        if trimmed.len() > MAX_PAPER_URI_CHARS {
            return Ok(serde_json::json!({
                "ok": false,
                "error": "paper_too_large",
            }));
        }

        let identity = self.identity.clone();
        let mut router = self.router.lock().await;
        let message = match router.ingest_lxm_uri(trimmed, |ciphertext| {
            identity
                .decrypt(ciphertext, None, false)
                .map_err(|_| lxmf_core::message::MessageError::PackFailed("decrypt".into()))
        }) {
            Ok(message) => message,
            Err(
                lxmf_core::message::MessageError::InvalidUri(_)
                | lxmf_core::message::MessageError::TooShort(_),
            ) => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "invalid_uri",
                }));
            }
            Err(lxmf_core::message::MessageError::PackFailed(ref s)) if s == "decrypt" => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "decrypt_failed",
                }));
            }
            Err(_) => {
                return Ok(serde_json::json!({
                    "ok": false,
                    "error": "internal_error",
                }));
            }
        };

        let sender_hex = hex::encode(message.source_hash);
        let inbound_sender_name = self
            .display_name_cache
            .lock()
            .ok()
            .map(|cache| resolve_inbound_sender_name_map(&cache, &sender_hex))
            .unwrap_or_else(|| sender_hex.get(..12).unwrap_or(&sender_hex).to_string());
        let payload = lxmf_payload_from_message(
            &message,
            &self.lxmf_hash_hex,
            &self.display_name,
            Some("paper"),
            None,
            "inbound",
            Some(&inbound_sender_name),
        );
        Ok(serde_json::json!({
            "ok": true,
            "message": payload,
        }))
    }

    pub async fn apply_interfaces(&self, stack: &StackHandle) -> Result<(), String> {
        let interfaces = stack.list_interfaces().await;
        tracing::info!(
            count = interfaces.len(),
            "apply_interfaces: syncing {} interface(s) from config",
            interfaces.len()
        );
        if let Ok(mut driver) = self.outbound.lock() {
            driver.update_interfaces(interfaces.clone());
        }
        self.sync_ble_peer_interfaces(&interfaces).await
    }

    #[cfg(feature = "rns-ble")]
    pub(crate) async fn sync_ble_peer_interfaces(
        &self,
        interfaces: &[InterfaceRow],
    ) -> Result<(), String> {
        let desired: HashMap<String, &InterfaceRow> = interfaces
            .iter()
            .filter(|i| i.iface_type == "ble_peer" && i.enabled)
            .map(|i| (i.id.clone(), i))
            .collect();

        let to_remove: Vec<String> = {
            let state = self.ble_peer_state.lock().await;
            state
                .spawned
                .keys()
                .filter(|id| !desired.contains_key(*id))
                .cloned()
                .collect()
        };

        for id in to_remove {
            self.teardown_ble_peer_by_config_id(&id).await;
        }

        for (id, row) in desired {
            let already = self.ble_peer_state.lock().await.spawned.contains_key(&id);
            if already {
                continue;
            }
            match self.spawn_ble_peer_for_row(row).await {
                Ok(runtime_id) => {
                    self.ble_peer_state
                        .lock()
                        .await
                        .spawned
                        .insert(id.clone(), runtime_id);
                    self.emit_event(
                        "interface.state",
                        serde_json::json!({ "id": id, "action": "ble_peer_spawned" }),
                    );
                }
                Err(e) => {
                    tracing::warn!(interface_id = %id, error = %e, "BLE Peer spawn failed");
                    self.emit_event(
                        "interface.state",
                        serde_json::json!({ "id": id, "action": "ble_peer_failed", "error": e }),
                    );
                }
            }
        }

        Ok(())
    }

    #[cfg(not(feature = "rns-ble"))]
    async fn sync_ble_peer_interfaces(&self, _interfaces: &[InterfaceRow]) -> Result<(), String> {
        Ok(())
    }

    #[cfg(feature = "rns-ble")]
    async fn spawn_ble_peer_for_row(&self, row: &InterfaceRow) -> Result<u64, String> {
        let identity_hash = self.identity.hash.to_vec();
        let foreground_wake = { self.ble_peer_state.lock().await.foreground_wake.clone() };
        reticulum::spawn_ble_peer_runtime(
            &self.handle,
            &row.name,
            identity_hash,
            None,
            foreground_wake,
            row.seed_addresses.clone(),
        )
        .await
    }

    #[cfg(feature = "rns-ble")]
    async fn teardown_ble_peer_by_config_id(&self, config_id: &str) {
        let runtime_id = {
            let mut state = self.ble_peer_state.lock().await;
            state.spawned.remove(config_id)
        };
        if let Some(runtime_id) = runtime_id {
            reticulum::teardown_ble_peer_interface(&self.handle, runtime_id).await;
            self.emit_event(
                "interface.state",
                serde_json::json!({ "id": config_id, "action": "ble_peer_stopped" }),
            );
        }
    }

    #[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
    fn emit_event(&self, event_type: &str, payload: serde_json::Value) {
        let msg = serde_json::json!({ "type": event_type, "payload": payload });
        let _ = self.event_tx.send(msg.to_string());
    }

    /// Progress for Nomad page/file Link attempts (renderer loading status).
    fn emit_nomad_page_progress(
        &self,
        dest_hash: &str,
        path: &str,
        phase: &str,
        request_id: Option<&str>,
        mut payload: serde_json::Value,
    ) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "destination_hash".into(),
                serde_json::json!(dest_hash.to_lowercase()),
            );
            obj.insert("path".into(), serde_json::json!(path));
            obj.insert("phase".into(), serde_json::json!(phase));
            if let Some(id) = request_id.map(str::trim).filter(|s| !s.is_empty()) {
                obj.insert("request_id".into(), serde_json::json!(id));
            }
        }
        self.emit_event("nomad.page_progress", payload);
    }
}

pub(super) fn lxmf_payload_from_message(
    msg: &LxMessage,
    self_lxmf_hash: &str,
    self_name: &str,
    received_via: Option<&str>,
    sent_via: Option<&str>,
    direction: &str,
    inbound_sender_name: Option<&str>,
) -> serde_json::Value {
    let sender_hex = hex::encode(msg.source_hash);
    let to_hex = hex::encode(msg.destination_hash);
    let is_outbound = direction == "outbound";
    let sender_hash = if is_outbound {
        self_lxmf_hash
    } else {
        sender_hex.as_str()
    };
    let sender_name = if is_outbound {
        self_name.to_string()
    } else {
        inbound_sender_name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| sender_hex.get(..12).unwrap_or(&sender_hex).to_string())
    };
    let message_hash = msg
        .hash
        .map(hex::encode)
        .or_else(|| msg.message_id.map(hex::encode))
        .unwrap_or_default();
    let ts_ms = (msg.timestamp * 1000.0) as i64;
    let mut payload = serde_json::json!({
        "sender_hash": sender_hash,
        "sender_name": sender_name,
        "text": msg.content,
        "timestamp": ts_ms,
        "to_hash": to_hex,
        "direction": direction,
        "message_hash": message_hash,
        "delivery_method": match msg.method {
            DeliveryMethod::Direct => "direct",
            DeliveryMethod::Propagated => "propagated",
            DeliveryMethod::Opportunistic => "opportunistic",
            DeliveryMethod::Paper => "paper",
        },
    });
    if let Some(via) = received_via {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("received_via".into(), serde_json::Value::String(via.into()));
        }
    }
    if let Some(via) = sent_via {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("sent_via".into(), serde_json::Value::String(via.into()));
        }
    }
    if let Some(attachment) = attachment_json_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            if let Some(text) = attachment
                .get("file_name")
                .and_then(|n| n.as_str())
                .zip(attachment.get("mime_type").and_then(|m| m.as_str()))
            {
                obj.insert(
                    "text".into(),
                    serde_json::Value::String(format!("[file:{}:{}]", text.0, text.1)),
                );
            }
            obj.insert("attachment".into(), attachment);
        }
    }
    if let Some(audio) = audio_json_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            let text_empty = obj
                .get("text")
                .and_then(|t| t.as_str())
                .is_none_or(|t| t.trim().is_empty());
            if text_empty {
                obj.insert("text".into(), serde_json::Value::String("[voice:0]".into()));
            }
            obj.insert("audio".into(), audio);
        }
    }
    if let Some(icon) = icon_appearance_json_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("icon_appearance".into(), icon);
        }
    }
    // A structured reaction (0x40) wins over a reply (0x30) for tapback classification:
    // renderer ingest keys off `reaction_target`, so we must not also emit `reply_to_hash`
    // (which would render a reply bubble). When 0x40 is absent, reply/plain paths are
    // unchanged.
    if let Some(reaction) = reaction_fields_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "reaction_target".into(),
                serde_json::Value::String(reaction.reaction_target),
            );
            // Fall back to the field emoji only when the message content is empty,
            // so peers that carry the emoji solely in 0x40 still show it.
            let text_empty = obj
                .get("text")
                .and_then(|t| t.as_str())
                .map(|t| t.trim().is_empty())
                .unwrap_or(true);
            if text_empty {
                if let Some(emoji) = reaction.emoji {
                    obj.insert("text".into(), serde_json::Value::String(emoji));
                }
            }
        }
    } else if let Some(reply) = reply_fields_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "reply_to_hash".into(),
                serde_json::Value::String(reply.reply_to_hash),
            );
            if let Some(quote) = reply.reply_preview_text {
                obj.insert(
                    "reply_preview_text".into(),
                    serde_json::Value::String(quote),
                );
            }
        }
    }
    payload
}

struct LxmfReplyFields {
    reply_to_hash: String,
    reply_preview_text: Option<String>,
}

/// Truncate UTF-8 quote text for LXMF `FIELD_REPLY_QUOTE` (encoder + decoder).
fn truncate_reply_quote(quote: &str) -> Option<String> {
    let trimmed = quote.trim();
    if trimmed.is_empty() {
        return None;
    }
    let truncated: String = trimmed.chars().take(REPLY_QUOTE_MAX_CHARS).collect();
    if truncated.is_empty() {
        None
    } else {
        Some(truncated)
    }
}

/// Stamp reply fields before `sign()` so they are covered by the message hash.
fn apply_reply_fields(msg: &mut LxMessage, reply_to: Option<[u8; 32]>, reply_quote: Option<&str>) {
    let Some(parent_id) = reply_to else {
        return;
    };
    msg.set_field(FIELD_REPLY_TO, parent_id.to_vec());
    if let Some(quote) = reply_quote.and_then(truncate_reply_quote) {
        msg.set_field(FIELD_REPLY_QUOTE, quote.as_bytes().to_vec());
    }
}

/// Decode LXMF 1.0 `FIELD_REPLY_TO` (0x30) and optional `FIELD_REPLY_QUOTE` (0x31).
fn reply_fields_from_message(msg: &LxMessage) -> Option<LxmfReplyFields> {
    let raw = msg.get_field(FIELD_REPLY_TO)?;
    if raw.len() != 32 {
        return None;
    }
    let reply_to_hash = hex::encode(raw);
    let reply_preview_text = msg.get_field(FIELD_REPLY_QUOTE).and_then(|bytes| {
        let s = std::str::from_utf8(bytes).ok()?;
        truncate_reply_quote(s)
    });
    Some(LxmfReplyFields {
        reply_to_hash,
        reply_preview_text,
    })
}

struct LxmfReactionFields {
    /// Lowercase 64-hex parent message hash.
    reaction_target: String,
    /// Reaction content (emoji) when carried in the field; may be absent.
    emoji: Option<String>,
}

/// Encode a standard LXMF `FIELD_REACTION` (0x40) value as a msgpack map keyed by
/// `REACTION_TO` (0x00 = 32-byte parent hash, Binary) and `REACTION_CONTENT`
/// (0x01 = UTF-8 emoji). Returned bytes are a single complete msgpack value for
/// [`LxMessage::set_msgpack_field`].
fn encode_reaction_field(target: &[u8; 32], emoji: &str) -> Vec<u8> {
    let map = rmpv::Value::Map(vec![
        (
            rmpv::Value::Integer(rmpv::Integer::from(REACTION_TO)),
            rmpv::Value::Binary(target.to_vec()),
        ),
        (
            rmpv::Value::Integer(rmpv::Integer::from(REACTION_CONTENT)),
            rmpv::Value::String(emoji.into()),
        ),
    ]);
    let mut buf = Vec::new();
    // Encoding a well-formed rmpv value to a Vec is infallible.
    let _ = rmpv::encode::write_value(&mut buf, &map);
    buf
}

/// Normalize a `REACTION_TO` msgpack value to a lowercase 64-hex string.
/// Accepts raw 32-byte Binary (Python/Sideband) or a 64-char ASCII-hex string
/// (Ratspeak-compatible). Anything else is rejected.
fn reaction_target_hex(value: &rmpv::Value) -> Option<String> {
    match value {
        rmpv::Value::Binary(bin) if bin.len() == 32 => Some(hex::encode(bin)),
        rmpv::Value::String(s) => {
            let text = s.as_str()?.trim();
            if text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit()) {
                Some(text.to_ascii_lowercase())
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Extract reaction content (emoji) from a `REACTION_CONTENT` msgpack value.
fn reaction_content_text(value: &rmpv::Value) -> Option<String> {
    let text = match value {
        rmpv::Value::String(s) => s.as_str()?.to_string(),
        rmpv::Value::Binary(bin) => std::str::from_utf8(bin).ok()?.to_string(),
        _ => return None,
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Decode LXMF 1.0.1 `FIELD_REACTION` (0x40). Fail-open: any missing/malformed
/// field (not a msgpack map, missing/invalid `REACTION_TO`, wrong types) returns
/// `None` so the message ingests as normal text/reply.
fn reaction_fields_from_message(msg: &LxMessage) -> Option<LxmfReactionFields> {
    let raw = msg.get_field(FIELD_REACTION)?;
    let mut cursor = Cursor::new(raw.as_slice());
    let value = rmpv::decode::read_value(&mut cursor).ok()?;
    // A conformant FIELD_REACTION is exactly one msgpack map. Trailing bytes after the map mean
    // the field is malformed, so fail open (ingest as normal text/reply) rather than trust it.
    if cursor.position() as usize != raw.len() {
        return None;
    }
    let map = value.as_map()?;
    let mut reaction_target: Option<String> = None;
    let mut emoji: Option<String> = None;
    for (key, val) in map {
        match key.as_u64() {
            Some(k) if k == u64::from(REACTION_TO) => reaction_target = reaction_target_hex(val),
            Some(k) if k == u64::from(REACTION_CONTENT) => emoji = reaction_content_text(val),
            _ => {}
        }
    }
    Some(LxmfReactionFields {
        reaction_target: reaction_target?,
        emoji,
    })
}

fn mime_from_file_name(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".webm") {
        "audio/webm".into()
    } else if lower.ends_with(".ogg") {
        "audio/ogg".into()
    } else if lower.ends_with(".wav") {
        "audio/wav".into()
    } else if lower.ends_with(".mp3") {
        "audio/mpeg".into()
    } else if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".gif") {
        "image/gif".into()
    } else {
        "application/octet-stream".into()
    }
}

fn rgb_triplet_from_msgpack(value: &rmpv::Value) -> Option<[u8; 3]> {
    let bytes = match value {
        rmpv::Value::Binary(bin) if bin.len() >= 3 => bin.as_slice(),
        rmpv::Value::Array(arr) if arr.len() >= 3 => {
            let r = arr.first()?.as_u64()? as u8;
            let g = arr.get(1)?.as_u64()? as u8;
            let b = arr.get(2)?.as_u64()? as u8;
            return Some([r, g, b]);
        }
        _ => return None,
    };
    Some([bytes[0], bytes[1], bytes[2]])
}

fn icon_appearance_json_from_message(msg: &LxMessage) -> Option<serde_json::Value> {
    let field = msg.get_field(FIELD_ICON_APPEARANCE)?;
    let value = rmpv::decode::read_value(&mut Cursor::new(field.as_slice())).ok()?;
    let arr = value.as_array()?;
    let icon_name = arr.first()?.as_str()?.to_string();
    if icon_name.trim().is_empty() {
        return None;
    }
    let fg = rgb_triplet_from_msgpack(arr.get(1)?)?;
    let bg = rgb_triplet_from_msgpack(arr.get(2)?)?;
    Some(serde_json::json!({
        "icon_name": icon_name,
        "foreground_rgb": [fg[0], fg[1], fg[2]],
        "background_rgb": [bg[0], bg[1], bg[2]],
    }))
}

fn attachment_json_from_message(msg: &LxMessage) -> Option<serde_json::Value> {
    use base64::Engine as _;

    let field = msg.get_field(FIELD_FILE_ATTACHMENTS)?;
    let value = rmpv::decode::read_value(&mut Cursor::new(field.as_slice())).ok()?;
    let files = value.as_array()?;
    let first = files.first()?.as_array()?;
    let file_name = first.first()?.as_str()?.to_string();
    let bytes = match first.get(1)? {
        rmpv::Value::Binary(bin) => bin.clone(),
        _ => return None,
    };
    let mime_type = mime_from_file_name(&file_name);
    Some(serde_json::json!({
        "file_name": file_name,
        "mime_type": mime_type,
        "size_bytes": bytes.len(),
        "data_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

fn audio_json_from_bytes(mode: u8, bytes: &[u8]) -> serde_json::Value {
    use base64::Engine as _;
    serde_json::json!({
        "mode": mode,
        "size_bytes": bytes.len(),
        "data_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Decode native `FIELD_AUDIO` for WS/HTTP payloads. Malformed audio fails open
/// (returns `None`) without poisoning the rest of the message.
fn audio_json_from_message(msg: &LxMessage) -> Option<serde_json::Value> {
    let audio = msg.audio_field().ok()??;
    Some(audio_json_from_bytes(audio.mode, audio.bytes))
}

fn decode_lxmf_audio_request(
    audio: Option<&super::types::LxmfAudioRequest>,
) -> Result<Option<Vec<u8>>, String> {
    use base64::Engine as _;
    let Some(audio) = audio else {
        return Ok(None);
    };
    if audio.mode != AM_OPUS_OGG {
        return Err(format!(
            "unsupported_audio_mode: {} (expected {AM_OPUS_OGG})",
            audio.mode
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio.data_base64.as_bytes())
        .map_err(|e| format!("audio_base64_decode: {e}"))?;
    if bytes.len() > MAX_LXMF_AUDIO_FIELD_BYTES {
        return Err(format!(
            "audio_too_large: {} > {}",
            bytes.len(),
            MAX_LXMF_AUDIO_FIELD_BYTES
        ));
    }
    if bytes.is_empty() {
        return Err("audio_empty".into());
    }
    Ok(Some(bytes))
}

#[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
pub(super) fn emit_lxmf_event(event_tx: &broadcast::Sender<String>, payload: serde_json::Value) {
    let frame = serde_json::json!({
        "type": "lxmf_message",
        "payload": payload
    });
    let _ = event_tx.send(frame.to_string());
}

/// rrcd announces `app_data` as CBOR `{"proto":"rrc","v":1,"hub":"<name>"}`.
fn parse_rrc_hub_announce_name(app_data: Option<&[u8]>) -> Option<String> {
    let bytes = app_data?;
    if bytes.is_empty() {
        return None;
    }
    if let Ok(value) = ciborium::from_reader::<ciborium::Value, _>(std::io::Cursor::new(bytes)) {
        if let Some(name) = rrc_hub_name_from_cbor(&value) {
            return sanitize_rrc_hub_display_name(&name);
        }
    }
    // Fallback for non-rrcd hubs that use LXMF/Nomad-style announce payloads.
    parse_announce_display_name(app_data).and_then(|n| sanitize_rrc_hub_display_name(&n))
}

fn rrc_hub_name_from_cbor(value: &ciborium::Value) -> Option<String> {
    let ciborium::Value::Map(entries) = value else {
        return None;
    };
    for (k, v) in entries {
        let key = match k {
            ciborium::Value::Text(t) => t.as_str(),
            _ => continue,
        };
        if key != "hub" && key != "name" && key != "hub_name" {
            continue;
        }
        if let ciborium::Value::Text(name) = v {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn sanitize_rrc_hub_display_name(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if !is_plausible_display_name(trimmed) {
        return None;
    }
    // Reject protocol/aspect noise often mis-parsed from foreign announce payloads.
    match trimmed.to_ascii_lowercase().as_str() {
        "lxmf" | "rrc" | "proto" | "reticulum" | "rrc.hub" | "lxmf.delivery" => None,
        _ => Some(trimmed.to_string()),
    }
}

/// LXMF / Nomad announces encode display names in app_data as msgpack
/// `[display_name_bytes, ...]`, msgpack maps, JSON objects (`server_name`), or raw UTF-8.
fn parse_announce_display_name(app_data: Option<&[u8]>) -> Option<String> {
    let bytes = app_data?;
    if bytes.is_empty() {
        return None;
    }
    if let Ok(value) = rmpv::decode::read_value(&mut Cursor::new(bytes)) {
        match value {
            rmpv::Value::Array(arr) => {
                if let Some(name) = arr.first().and_then(nomad_name_from_msgpack_value) {
                    return sanitize_parsed_display_name(&name);
                }
            }
            rmpv::Value::Map(map) => {
                if let Some(name) = display_name_from_msgpack_map(&map) {
                    return sanitize_parsed_display_name(&name);
                }
            }
            _ => {}
        }
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        let trimmed = text.trim();
        if trimmed.starts_with('{') {
            if let Some(name) = display_name_from_json_str(trimmed) {
                return sanitize_parsed_display_name(&name);
            }
            return None;
        }
        return sanitize_parsed_display_name(trimmed);
    }
    None
}

fn sanitize_parsed_display_name(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if is_plausible_display_name(trimmed) {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn display_name_from_json_str(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    display_name_from_json_value(&value)
}

fn display_name_from_json_value(value: &serde_json::Value) -> Option<String> {
    let obj = value.as_object()?;
    for key in ["server_name", "name", "display_name", "title"] {
        if let Some(name) = obj
            .get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some(name.to_string());
        }
    }
    None
}

fn display_name_from_msgpack_map(map: &[(rmpv::Value, rmpv::Value)]) -> Option<String> {
    for key in ["server_name", "name", "display_name", "title"] {
        for (k, v) in map {
            if k.as_str() == Some(key) {
                if let Some(name) = nomad_name_from_msgpack_value(v) {
                    return Some(name);
                }
            }
        }
    }
    None
}

fn is_plausible_display_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 {
        return false;
    }
    s.chars().all(|c| !c.is_control() || c == ' ' || c == '\t')
}

fn nomad_name_from_msgpack_value(value: &rmpv::Value) -> Option<String> {
    match value {
        rmpv::Value::Binary(bin) => std::str::from_utf8(bin)
            .ok()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        rmpv::Value::String(s) => {
            let trimmed = s.as_str()?.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

fn contacts_to_name_map(contacts: &[ContactRow]) -> HashMap<String, String> {
    contacts
        .iter()
        .filter_map(|c| {
            let name = c.display_name.as_ref()?.trim();
            if name.is_empty() {
                return None;
            }
            Some((c.destination_hash.clone(), name.to_string()))
        })
        .collect()
}

#[cfg(test)]
fn resolve_inbound_sender_name(contacts: &[ContactRow], sender_hash: &str) -> String {
    resolve_inbound_sender_name_map(&contacts_to_name_map(contacts), sender_hash)
}

fn resolve_inbound_sender_name_map(names: &HashMap<String, String>, sender_hash: &str) -> String {
    let prefix = sender_hash.get(..12).unwrap_or(sender_hash);
    names
        .get(sender_hash)
        .map(|name| name.trim())
        .filter(|name| !name.is_empty() && *name != prefix)
        .map(str::to_string)
        .unwrap_or_else(|| prefix.to_string())
}

/// Success metadata for a remote Nomad Link query (page or file).
struct NomadRemoteQueryOk {
    egress: &'static str,
    timeout_secs: u64,
    path_hops: u8,
    link_hops: u8,
    force_path_ok: Option<bool>,
    path_ensure_kind: Option<&'static str>,
    elapsed_ms: u64,
}

/// Diagnostics for a failed remote Nomad Link query (page or file).
struct NomadRemoteQueryError {
    code: String,
    egress: Option<&'static str>,
    path_hops: Option<u8>,
    link_hops: Option<u8>,
    timeout_secs: Option<u64>,
    force_path_ok: Option<bool>,
    path_ensure_kind: Option<&'static str>,
    raw_error: Option<String>,
    elapsed_ms: Option<u64>,
    /// Local interface names attempted (including via-aware failovers).
    tried_interfaces: Option<Vec<String>>,
    /// In-request via/iface failover rounds completed (0 if none).
    failover_rounds: Option<u8>,
    /// Last local interface used for the Link attempt.
    last_iface: Option<String>,
}

fn elapsed_ms_since(started: tokio::time::Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn insert_nomad_link_budget_fields(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    path_hops: Option<u8>,
    link_hops: Option<u8>,
    timeout_secs: Option<u64>,
    force_path_ok: Option<bool>,
    path_ensure_kind: Option<&str>,
    elapsed_ms: Option<u64>,
) {
    if let Some(path_hops) = path_hops {
        obj.insert("path_hops".into(), serde_json::json!(path_hops));
    }
    if let Some(link_hops) = link_hops {
        obj.insert("link_hops".into(), serde_json::json!(link_hops));
    }
    if let Some(timeout_secs) = timeout_secs {
        obj.insert("timeout_secs".into(), serde_json::json!(timeout_secs));
        // Matches LinkClient proof-budget overlay: remaining overall deadline.
        obj.insert(
            "proof_budget_secs".into(),
            serde_json::json!(nomad_timeouts::nomad_link_proof_budget_secs(timeout_secs)),
        );
    }
    if let Some(force_path_ok) = force_path_ok {
        obj.insert("force_path_ok".into(), serde_json::json!(force_path_ok));
    }
    if let Some(kind) = path_ensure_kind.filter(|s| !s.is_empty()) {
        obj.insert("path_ensure_kind".into(), serde_json::json!(kind));
    }
    if let Some(elapsed_ms) = elapsed_ms {
        obj.insert("elapsed_ms".into(), serde_json::json!(elapsed_ms));
    }
}

fn merge_nomad_remote_ok_fields(out: &mut serde_json::Value, meta: &NomadRemoteQueryOk) {
    let obj = out.as_object_mut().expect("json object");
    obj.insert("egress".into(), serde_json::json!(meta.egress));
    insert_nomad_link_budget_fields(
        obj,
        Some(meta.path_hops),
        Some(meta.link_hops),
        Some(meta.timeout_secs),
        meta.force_path_ok,
        meta.path_ensure_kind,
        Some(meta.elapsed_ms),
    );
}

/// Oversized remote Nomad page/file response — keep Link-budget diagnostics.
fn nomad_response_too_large_json(meta: &NomadRemoteQueryOk) -> serde_json::Value {
    let mut out = serde_json::json!({ "ok": false, "error": "response_too_large" });
    merge_nomad_remote_ok_fields(&mut out, meta);
    out
}

/// Remote Nomad page/file error JSON; include path-aware egress and Link budgets when known.
fn nomad_remote_error_json(err: &NomadRemoteQueryError) -> serde_json::Value {
    let mut out = serde_json::json!({ "ok": false, "error": err.code });
    let obj = out.as_object_mut().expect("json object");
    if let Some(egress) = err.egress {
        obj.insert("egress".into(), serde_json::json!(egress));
    }
    insert_nomad_link_budget_fields(
        obj,
        err.path_hops,
        err.link_hops,
        err.timeout_secs,
        err.force_path_ok,
        err.path_ensure_kind,
        err.elapsed_ms,
    );
    if let Some(raw) = err.raw_error.as_deref().filter(|s| !s.is_empty()) {
        obj.insert("raw_error".into(), serde_json::json!(raw));
    }
    if let Some(ifaces) = err.tried_interfaces.as_ref().filter(|v| !v.is_empty()) {
        obj.insert("tried_interfaces".into(), serde_json::json!(ifaces));
    }
    if let Some(rounds) = err.failover_rounds {
        obj.insert("failover_rounds".into(), serde_json::json!(rounds));
    }
    if let Some(iface) = err
        .last_iface
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        obj.insert("iface".into(), serde_json::json!(iface));
    }
    out
}

/// After a forced DropPath, accept a path only once it has been observed absent
/// and then reinstalled — otherwise the first refresh succeeds on the stale route.
fn force_path_refresh_accepts_current_path(
    force: bool,
    had_path_at_start: bool,
    saw_path_absent: bool,
) -> bool {
    if !force || !had_path_at_start {
        return true;
    }
    saw_path_absent
}

/// Timeout decision for [`LiveStack::ensure_path_for_direct_with_opts`].
///
/// `accept_existing_on_timeout` is only for forced refresh of a path that was
/// already present (stale fall-through). Non-force probes accept any path that
/// appeared by timeout without that flag.
#[allow(clippy::fn_params_excessive_bools)] // mirrors ensure_path wait-loop flags
fn force_path_refresh_timeout_accepts(
    force: bool,
    had_path_at_start: bool,
    has_path: bool,
    saw_path_absent: bool,
    accept_existing_on_timeout: bool,
) -> bool {
    if !has_path {
        return false;
    }
    if force && had_path_at_start {
        // Reserve accept_existing_on_timeout for forced stale-path fall-through.
        return force_path_refresh_accepts_current_path(force, had_path_at_start, saw_path_absent)
            || accept_existing_on_timeout;
    }
    // Non-force probe (or force with no path at start): accept a path that appeared.
    true
}

/// Classify path-ensure outcome after the RequestPath wait times out.
#[allow(clippy::fn_params_excessive_bools)] // mirrors force_path_refresh_timeout_accepts flags
fn path_ensure_kind_after_timeout(
    accept: bool,
    force: bool,
    had_path_at_start: bool,
    saw_path_absent: bool,
    accept_existing_on_timeout: bool,
) -> PathEnsureKind {
    if !accept {
        PathEnsureKind::Missing
    } else if force && had_path_at_start && !saw_path_absent && accept_existing_on_timeout {
        PathEnsureKind::StaleAccept
    } else {
        PathEnsureKind::Rediscovered
    }
}

/// Hashes present in `next` but not in `prev` (path-table membership growth).
fn path_table_added_hashes(prev: &HashSet<String>, next: &HashSet<String>) -> Vec<String> {
    next.difference(prev).cloned().collect()
}

pub(super) fn parse_hash16(hex_str: &str) -> Result<[u8; 16], String> {
    let trimmed = hex_str.trim();
    if trimmed.len() != 32 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("hash must be exactly 32 hex characters".into());
    }
    let bytes = hex::decode(trimmed).map_err(|e| e.to_string())?;
    let mut out = [0u8; 16];
    out.copy_from_slice(&bytes[..16]);
    Ok(out)
}

/// LXMF message id / reply-to target is a full SHA-256 (64 hex chars → 32 bytes).
pub(super) fn parse_hash32(hex_str: &str) -> Result<[u8; 32], String> {
    let trimmed = hex_str.trim();
    if trimmed.len() != 64 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("message hash must be exactly 64 hex characters".into());
    }
    let bytes = hex::decode(trimmed).map_err(|e| e.to_string())?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes[..32]);
    Ok(out)
}

/// Parse optional reply parent hash; invalid lengths are omitted (plain DM) with a warning log.
fn parse_optional_reply_to_hash(hex_str: Option<&str>) -> Option<[u8; 32]> {
    let raw = hex_str.map(str::trim).filter(|s| !s.is_empty())?;
    match parse_hash32(raw) {
        Ok(bytes) => Some(bytes),
        Err(err) => {
            tracing::warn!(error = %err, "ignoring invalid reply_to_hash");
            None
        }
    }
}

/// Bridge `lxmf_outbound_status` WS frames into Games session `delivery_state`.
fn spawn_games_lxmf_outbound_bridge(
    games: Arc<GamesSessionManager>,
    mut rx: broadcast::Receiver<String>,
) {
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(frame) => {
                    // Skip non-status frames before JSON parse (hot receive path).
                    if !frame.contains("lxmf_outbound_status") {
                        continue;
                    }
                    let Ok(v) = serde_json::from_str::<serde_json::Value>(&frame) else {
                        continue;
                    };
                    if v.get("type").and_then(|t| t.as_str()) != Some("lxmf_outbound_status") {
                        continue;
                    }
                    let Some(payload) = v.get("payload") else {
                        continue;
                    };
                    let Some(hash) = payload.get("message_hash").and_then(|h| h.as_str()) else {
                        continue;
                    };
                    let Some(status) = payload.get("status").and_then(|s| s.as_str()) else {
                        continue;
                    };
                    let method = payload.get("delivery_method").and_then(|m| m.as_str());
                    games.apply_outbound_status(hash, status, method);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Min interval between inbound-LXMF receipt warns (developer-bundle visibility without spam).
const INBOUND_LXMF_WARN_INTERVAL: Duration = Duration::from_secs(5);
static LAST_INBOUND_LXMF_WARN_MS: AtomicU64 = AtomicU64::new(0);

fn rate_limited_inbound_lxmf_warn(from: &str, message_hash: &str) {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let prev = LAST_INBOUND_LXMF_WARN_MS.load(Ordering::Relaxed);
    if now_ms.saturating_sub(prev) < INBOUND_LXMF_WARN_INTERVAL.as_millis() as u64 {
        tracing::debug!(
            from = %from,
            message_hash = %message_hash,
            "inbound LXMF queued for clients"
        );
        return;
    }
    LAST_INBOUND_LXMF_WARN_MS.store(now_ms, Ordering::Relaxed);
    tracing::warn!(
        from = %from,
        message_hash = %message_hash,
        "inbound LXMF queued for clients"
    );
}

/// Cap membership growth event payloads under path-table floods.
const MAX_PEERS_UPDATED_ADDED: usize = 4096;
/// Bound announce / contact display-name labels independently of the live path table.
const MAX_DISPLAY_NAME_CACHE: usize = 100_000;
/// Serve HTTP peer list from the maintenance snapshot when newer than this.
const PATH_PEER_CACHE_TTL: Duration = Duration::from_secs(2);

/// Insert or refresh a destination label; evict an arbitrary oldest-ish entry when full.
fn insert_display_name_bounded(cache: &mut HashMap<String, String>, hash: String, name: String) {
    if cache.len() >= MAX_DISPLAY_NAME_CACHE && !cache.contains_key(&hash) {
        if let Some(evict) = cache.keys().next().cloned() {
            cache.remove(&evict);
        }
    }
    cache.insert(hash, name);
}
/// Cap Nomad page body before UTF-8 conversion (DoS bound).
const NOMAD_PAGE_MAX_BYTES: usize = 512 * 1024;
/// Cap Nomad file body before base64 (aligned with Axum 4 MiB body limit).
const NOMAD_FILE_MAX_BYTES: usize = 4 * 1024 * 1024;
/// After preempting the prior query, allow time for LinkClient to unwind and
/// release the lock before surfacing `nomad_busy` to a newer request.
/// Wait for a preempted Nomad Link query to unwind (not the full page budget).
const NOMAD_LINK_LOCK_WAIT: Duration = Duration::from_secs(8);

/// Cap DropPath + rediscover before a Nomad Link attempt (inside overall TCP budget).
const NOMAD_FORCE_PATH_REFRESH_WAIT: Duration = Duration::from_secs(4);

/// Strict TCP/network DropPath→RequestPath wait before Link (no stale-accept fall-through).
const NOMAD_TCP_PATH_PROBE_WAIT: Duration = Duration::from_secs(5);

fn path_table_route_from_entry(e: &PathTableRpcEntry) -> PathTableRoute {
    PathTableRoute {
        hash: e.hash,
        hops: e.hops,
        hex_key: hex::encode(e.hash),
        interface: Some(e.interface.clone()).filter(|s| !s.is_empty()),
        via: e.via.map(hex::encode),
    }
}

#[allow(clippy::too_many_arguments, clippy::result_large_err)] // Nomad Link diagnostics bundle
fn finish_nomad_link_result(
    result: Result<Vec<u8>, NomadRemoteQueryError>,
    hash_hex: &str,
    identity_hash_hex: &str,
    hops: u8,
    link_hops: u8,
    proof_budget_secs: u64,
    timeout_secs: u64,
    egress: &'static str,
    force_path_ok: Option<bool>,
    path_ensure_kind: Option<&'static str>,
    elapsed_ms: u64,
) -> Result<(Vec<u8>, NomadRemoteQueryOk), NomadRemoteQueryError> {
    match result {
        Ok(bytes) => {
            tracing::debug!(
                target: "nomad",
                dest = %hash_hex,
                identity = %identity_hash_hex,
                path_hops = hops,
                link_hops,
                proof_budget_secs,
                timeout_secs,
                egress,
                force_path_ok = ?force_path_ok,
                path_ensure_kind = ?path_ensure_kind,
                elapsed_ms,
                "Nomad Link query ok"
            );
            Ok((
                bytes,
                NomadRemoteQueryOk {
                    egress,
                    timeout_secs,
                    path_hops: hops,
                    link_hops,
                    force_path_ok,
                    path_ensure_kind,
                    elapsed_ms,
                },
            ))
        }
        Err(mut err) => {
            err.elapsed_ms = Some(elapsed_ms);
            tracing::warn!(
                target: "nomad",
                dest = %hash_hex,
                identity = %identity_hash_hex,
                path_hops = ?err.path_hops,
                link_hops = ?err.link_hops,
                proof_budget_secs,
                egress = ?err.egress,
                force_path_ok = ?err.force_path_ok,
                path_ensure_kind = ?err.path_ensure_kind,
                timeout_secs = ?err.timeout_secs,
                elapsed_ms,
                error = %err.code,
                raw_error = err.raw_error.as_deref().unwrap_or(""),
                "Nomad Link query failed"
            );
            Err(err)
        }
    }
}

/// Outcome of [`LiveStack::ensure_path_for_direct_with_opts`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathEnsureKind {
    /// `has_path_to` was already true and `force` was false — not a reachability check.
    CachedHit,
    /// Path was absent (or never present), then reappeared after RequestPath.
    Rediscovered,
    /// Forced refresh timed out but accepted the never-cleared route (`accept_existing`).
    StaleAccept,
    /// No usable path after the wait.
    Missing,
}

impl PathEnsureKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::CachedHit => "cached_hit",
            Self::Rediscovered => "rediscovered",
            Self::StaleAccept => "stale_accept",
            Self::Missing => "missing",
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PathEnsureReport {
    ok: bool,
    kind: PathEnsureKind,
    had_cached: bool,
    saw_path_absent: bool,
}

fn path_table_added_hashes_capped(prev: &HashSet<String>, next: &HashSet<String>) -> Vec<String> {
    let mut added = path_table_added_hashes(prev, next);
    if added.len() > MAX_PEERS_UPDATED_ADDED {
        added.sort();
        added.truncate(MAX_PEERS_UPDATED_ADDED);
    }
    added
}

/// Rebuild the Direct→PN cascade list from persisted rows plus, in Auto, heard announces.
///
/// Takes the shared Arcs rather than `&self` so the propagation announce task can refresh
/// the list as soon as a new PN is heard — otherwise a discovered node would only become
/// cascade-eligible after a settings write or a stack restart.
async fn rebuild_pn_cascade_candidates(
    persisted: &Arc<RwLock<PersistedState>>,
    discovered_propagation: &Arc<Mutex<HashMap<String, super::DiscoveredPropagationRow>>>,
    outbound: &Arc<Mutex<LxmfOutboundDriver>>,
    pn_hosting_policy: &Arc<Mutex<PnHostingPolicy>>,
) {
    use pn_cascade::{auto_discovered_candidates, candidates_for_propagation_mode};
    let (rows, self_hash, mode, auto_blacklist) = {
        let state = persisted.read().await;
        let rows: Vec<(String, bool, Option<String>, Option<u8>)> = state
            .propagation
            .iter()
            .map(|p| (p.id.clone(), p.enabled, p.destination_hash.clone(), p.hops))
            .collect();
        let self_hash = state.identity.lxmf_hash.clone();
        let auto_blacklist: std::collections::HashSet<[u8; 16]> = state
            .propagation_auto_blacklist
            .iter()
            .filter_map(|h| parse_hash16(h).ok())
            .collect();
        (rows, self_hash, state.propagation_mode, auto_blacklist)
    };
    let mut candidates = candidates_for_propagation_mode(&rows, &self_hash, mode);
    // Auto ignores blacklisted remotes for outbound deposit; Manual Prefer/deposit still may.
    if mode.is_auto() {
        candidates.retain(|c| c.is_local || !auto_blacklist.contains(&c.hash));
    }
    let discovered_rows: Vec<super::DiscoveredPropagationRow> = discovered_propagation
        .lock()
        .map(|cache| cache.values().cloned().collect())
        .unwrap_or_default();
    let max_peering_cost = pn_hosting_policy
        .lock()
        .map(|p| p.max_peering_cost)
        .unwrap_or(super::pn_hosting_policy::DEFAULT_MAX_PEERING_COST);
    candidates.extend(auto_discovered_candidates(
        &discovered_rows,
        &candidates,
        &self_hash,
        mode,
        max_peering_cost,
        &auto_blacklist,
    ));
    if let Ok(mut driver) = outbound.lock() {
        driver.set_pn_cascade_candidates(candidates);
    }
}

/// Compare route-relevant fields (ignore `last_seen` / display_name churn).
fn peer_route_fields_equal(a: &PeerRow, b: &PeerRow) -> bool {
    a.hops == b.hops
        && a.interface == b.interface
        && a.path_hash == b.path_hash
        && a.via_hash == b.via_hash
        && a.public_key == b.public_key
}

/// After establish failure, suppress dead iface/via and retry client `/get` on another hub.
#[allow(clippy::too_many_arguments)] // mirrors Nomad path failover state threaded through driver loop
async fn propagation_download_attempt_failover(
    live: Option<&Arc<LiveBridge>>,
    bridge: &PropagationBridge,
    pn_hash: [u8; 16],
    pn_hex: &str,
    failover_round: &mut u8,
    tried_interfaces: &mut Vec<String>,
    blocked_ifaces: &mut Vec<String>,
    blocked_vias: &mut Vec<String>,
    live_ifaces: &[String],
    current_iface: &mut Option<String>,
    current_via: &mut Option<String>,
) -> bool {
    if live.is_none() || !should_attempt_propagation_via_failover(*failover_round) {
        return false;
    }
    bridge.cancel_client_download();
    *failover_round = failover_round.saturating_add(1);
    record_path_failover_attempt(
        tried_interfaces,
        blocked_ifaces,
        blocked_vias,
        current_iface.as_deref(),
        current_via.as_deref(),
    );
    let Some(live_ref) = live else {
        return false;
    };
    if let Some(found) = live_ref
        .suppress_via_and_rediscover(pn_hex, blocked_ifaces, blocked_vias, live_ifaces)
        .await
    {
        *current_iface = found.iface.clone();
        *current_via = found.via.clone();
    }
    tracing::info!(
        target: "propagation-sync",
        pn_hash = %pn_hex,
        failover_round = *failover_round,
        iface = ?current_iface,
        via_prefix = via_prefix(current_via.as_deref()),
        establish_error = ?bridge.last_establish_error(),
        tried_interfaces = ?tried_interfaces,
        "propagation client /get establish failover"
    );
    bridge.start_client_download(pn_hash)
}

/// Shared client `/get` driver used by user Sync (`emit_ui: true`) and post-peer
/// silent retrieve (`emit_ui: false`).
#[allow(clippy::too_many_arguments)] // bridge + router + outbound + UI/callback wiring
fn spawn_client_download_driver_task(
    live: Option<Arc<LiveBridge>>,
    bridge: Arc<PropagationBridge>,
    router: Arc<tokio::sync::Mutex<LxmRouter>>,
    outbound: Arc<std::sync::Mutex<LxmfOutboundDriver>>,
    active_run_id: Arc<AtomicU64>,
    pn_hash: [u8; 16],
    pn_hex: String,
    cancel: Arc<AtomicBool>,
    run_id: u64,
    event_tx: broadcast::Sender<String>,
    on_terminal: Option<Arc<dyn Fn() + Send + Sync>>,
    emit_ui: bool,
    retrieve_mode: &'static str,
) -> bool {
    if !bridge.start_client_download(pn_hash) {
        tracing::debug!(
            target: "propagation-retrieve",
            pn_hash = %pn_hex,
            "client /get download not started (already active or unavailable)"
        );
        return false;
    }
    tokio::spawn(async move {
        const POLL_INTERVAL: Duration = Duration::from_millis(500);
        const DOWNLOAD_WATCHDOG: Duration = Duration::from_secs(180);
        const ESTABLISH_STALL: Duration = Duration::from_secs(45);
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        let attempt_started = Instant::now();
        let mut failover_round: u8 = 0;
        let mut tried_interfaces: Vec<String> = Vec::new();
        let mut blocked_ifaces: Vec<String> = Vec::new();
        let mut blocked_vias: Vec<String> = Vec::new();
        let mut live_ifaces: Vec<String> = Vec::new();
        let mut current_iface: Option<String> = None;
        let mut current_via: Option<String> = None;
        if let Some(ref live_ref) = live {
            if let Ok(ifaces) = live_ref.fetch_interfaces().await {
                live_ifaces = super::auto_path_policy::order_live_ifaces_private_first(
                    &live_interface_names(&ifaces),
                    &ifaces,
                );
            }
            if let Ok((slots, _)) = live_ref.path_slots(&pn_hex).await {
                current_via = active_via_hash_from_slots(&slots);
                current_iface = slots
                    .iter()
                    .find(|s| {
                        s.get("active")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false)
                    })
                    .and_then(|s| s.get("interface").and_then(|v| v.as_str()))
                    .map(str::to_string);
            }
            record_path_failover_attempt(
                &mut tried_interfaces,
                &mut blocked_ifaces,
                &mut blocked_vias,
                current_iface.as_deref(),
                current_via.as_deref(),
            );
        }
        let emit_progress = |active: bool, progress: f64, message: Option<&str>| {
            if !emit_ui {
                return;
            }
            let payload = serde_json::json!({
                "active": active,
                "progress": progress,
                "message": message,
            });
            let frame = serde_json::json!({
                "type": "propagation_sync",
                "payload": payload,
            });
            let _ = event_tx.send(frame.to_string());
        };
        let clear_pins = || {
            if emit_ui {
                bridge.run_if_current(&active_run_id, run_id, || {
                    if let Some(ref cb) = on_terminal {
                        cb();
                    }
                });
            } else if let Some(ref cb) = on_terminal {
                cb();
            }
        };
        let still_current = || {
            if !emit_ui {
                return true;
            }
            PropagationBridge::is_current_sync_run(active_run_id.load(Ordering::SeqCst), run_id)
        };
        let run_guarded = |f: &dyn Fn()| {
            if emit_ui {
                bridge.run_if_current(&active_run_id, run_id, f);
            } else {
                f();
            }
        };
        let terminal_establish_failure =
            |bridge: &PropagationBridge, round: u8, tried: &[String]| {
                let message = bridge.propagation_establish_fail_message();
                tracing::info!(
                    target: "propagation-sync",
                    pn_hash = %pn_hex,
                    failover_round = round,
                    message = %message,
                    tried_interfaces = ?tried,
                    "propagation client /get establish failed"
                );
                message
            };
        'attempt: loop {
            let round_started = Instant::now();
            let mut last_logged_progress = -1.0_f64;
            run_guarded(&|| {
                emit_progress(true, 10.0, None);
            });
            loop {
                interval.tick().await;
                if !still_current() {
                    break 'attempt;
                }
                if cancel.load(Ordering::SeqCst) {
                    run_guarded(&|| {
                        bridge.cancel_client_download();
                    });
                    break 'attempt;
                }
                let progress = bridge.client_download_progress();
                if progress <= 10.0
                    && bridge.client_download_active()
                    && round_started.elapsed() > ESTABLISH_STALL
                {
                    tracing::info!(
                        target: "propagation-retrieve",
                        pn_hash = %pn_hex,
                        failover_round,
                        establish_error = ?bridge.last_establish_error(),
                        "client /get stalled while establishing"
                    );
                    if propagation_download_attempt_failover(
                        live.as_ref(),
                        &bridge,
                        pn_hash,
                        &pn_hex,
                        &mut failover_round,
                        &mut tried_interfaces,
                        &mut blocked_ifaces,
                        &mut blocked_vias,
                        &live_ifaces,
                        &mut current_iface,
                        &mut current_via,
                    )
                    .await
                    {
                        continue 'attempt;
                    }
                    let message =
                        terminal_establish_failure(&bridge, failover_round, &tried_interfaces);
                    run_guarded(&|| {
                        emit_progress(false, 0.0, Some(&message));
                    });
                    break 'attempt;
                }
                if attempt_started.elapsed() > DOWNLOAD_WATCHDOG {
                    tracing::info!(
                        target: "propagation-retrieve",
                        pn_hash = %pn_hex,
                        "client /get download watchdog timeout"
                    );
                    if propagation_download_attempt_failover(
                        live.as_ref(),
                        &bridge,
                        pn_hash,
                        &pn_hex,
                        &mut failover_round,
                        &mut tried_interfaces,
                        &mut blocked_ifaces,
                        &mut blocked_vias,
                        &live_ifaces,
                        &mut current_iface,
                        &mut current_via,
                    )
                    .await
                    {
                        continue 'attempt;
                    }
                    let message =
                        terminal_establish_failure(&bridge, failover_round, &tried_interfaces);
                    run_guarded(&|| {
                        emit_progress(false, 0.0, Some(&message));
                    });
                    break 'attempt;
                }
                if (progress - last_logged_progress).abs() >= 0.5 {
                    last_logged_progress = progress;
                    run_guarded(&|| {
                        emit_progress(true, progress, None);
                    });
                }
                let known = outbound
                    .lock()
                    .ok()
                    .map(|d| d.known_identities_for_propagation())
                    .unwrap_or_default();
                match bridge.poll_client_download(&known) {
                    ClientDownloadPoll::Idle => break 'attempt,
                    ClientDownloadPoll::InProgress => {}
                    ClientDownloadPoll::Failed => {
                        tracing::info!(
                            target: "propagation-retrieve",
                            pn_hash = %pn_hex,
                            progress,
                            establish_error = ?bridge.last_establish_error(),
                            "client /get download failed"
                        );
                        if progress <= 10.0
                            && propagation_download_attempt_failover(
                                live.as_ref(),
                                &bridge,
                                pn_hash,
                                &pn_hex,
                                &mut failover_round,
                                &mut tried_interfaces,
                                &mut blocked_ifaces,
                                &mut blocked_vias,
                                &live_ifaces,
                                &mut current_iface,
                                &mut current_via,
                            )
                            .await
                        {
                            continue 'attempt;
                        }
                        let message =
                            terminal_establish_failure(&bridge, failover_round, &tried_interfaces);
                        run_guarded(&|| {
                            bridge.cancel_client_download();
                            emit_progress(false, 0.0, Some(&message));
                        });
                        break 'attempt;
                    }
                    ClientDownloadPoll::Complete {
                        messages,
                        listed,
                        downloaded,
                    } => {
                        let delivered = messages.len();
                        {
                            let router = router.lock().await;
                            if let Some(ref cb) = router.delivery_callback {
                                for msg in &messages {
                                    cb(msg);
                                }
                            }
                        }
                        tracing::info!(
                            target: "propagation-retrieve",
                            pn_hash = %pn_hex,
                            listed,
                            downloaded,
                            delivered,
                            retrieve_mode,
                            "client /get download Completes"
                        );
                        run_guarded(&|| {
                            emit_progress(false, 100.0, None);
                        });
                        break 'attempt;
                    }
                }
            }
        }
        clear_pins();
    });
    true
}

/// Pick the next Host periodic `/get` target: Prefer/outbound first when peered
/// and identity-known, else round-robin over alive peered remotes.
fn next_host_periodic_get_target(
    router: &LxmRouter,
    preferred: Option<[u8; 16]>,
    driver: &LxmfOutboundDriver,
    rr: &mut usize,
) -> Option<[u8; 16]> {
    let identity_known = |hash: &[u8; 16]| driver.identity_known_for(&hex::encode(hash));
    if let Some(pref) = preferred {
        if let Some(peer) = router.peers.get(&pref) {
            if peer.alive && identity_known(&pref) {
                return Some(pref);
            }
        }
    }
    let mut candidates: Vec<[u8; 16]> = router
        .peers
        .values()
        .filter(|p| p.alive && identity_known(&p.destination_hash))
        .map(|p| p.destination_hash)
        .collect();
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_unstable();
    let idx = *rr % candidates.len();
    *rr = rr.wrapping_add(1);
    Some(candidates[idx])
}

/// Pure announce classification for propagation sync targets.
///
/// `entries` is `(dest_hash_hex, name_hash)` pairs from recent announces.
/// While Host PN is on, push inventory to peered PNs (lxmd `drive_pending_peer_syncs` parity).
///
/// Skips when the shared sync task is busy or a user Sync/deposit owns the PN Link.
fn drive_local_host_peer_sync(
    propagation: &Arc<PropagationBridge>,
    router: &mut LxmRouter,
    driver: &mut LxmfOutboundDriver,
    local_identity_hash: [u8; 16],
) {
    propagation.drain_peering_key_results(router);

    let offer_generation = match propagation.local_node().lock() {
        Ok(node) => node.offer_generation(),
        Err(_) => return,
    };

    let policies = router.sync_peer_policies_for_store(offer_generation);
    for policy in policies {
        let peer_hash = policy.peer_hash;
        let Some(peer) = router.peers.get(&peer_hash) else {
            continue;
        };
        if !peer.stamp_costs_known() {
            continue;
        }
        if peer.peering_cost > 0 && !peer.peering_key_ready() {
            if propagation.peering_key_job_inflight(&peer_hash) {
                continue;
            }
            let peer_hex = hex::encode(peer_hash);
            let Some(pub_key) = driver.public_key_for(&peer_hex) else {
                tracing::debug!(
                    target: "propagation-sync",
                    peer = %peer_hex,
                    "host peer sync postponed until identity is known"
                );
                continue;
            };
            let Ok(peer_identity) = Identity::from_public_key(&pub_key) else {
                continue;
            };
            let peering_cost = peer.peering_cost;
            propagation.spawn_peering_key_job(
                peer_hash,
                peering_cost,
                peer_identity.hash,
                local_identity_hash,
            );
            continue;
        }

        if driver.has_inflight_delivery_to(&peer_hash) {
            continue;
        }

        let ready_policy = OutboundOfferPolicy::from(peer);
        if peer.peering_cost > 0 && ready_policy.peering_key.is_empty() {
            continue;
        }

        if propagation.start_sync_with_policy(ready_policy) {
            if let Some(peer) = router.peers.get_mut(&peer_hash) {
                peer.begin_sync();
            }
            driver.set_propagation_sync_target(Some(peer_hash));
            tracing::info!(
                target: "propagation-sync",
                peer = %hex::encode(peer_hash),
                "local host queued outbound peer inventory sync"
            );
            return;
        }
    }
}

fn classify_propagation_target_name_hashes(
    destination_hex: &str,
    entries: &[(String, [u8; 10])],
    prop_nh: &[u8; 10],
    delivery_nh: &[u8; 10],
) -> &'static str {
    let key = destination_hex.to_lowercase();
    for (dest_hex, name_hash) in entries {
        if dest_hex.to_lowercase() != key {
            continue;
        }
        if name_hash == prop_nh {
            return "propagation";
        }
        if name_hash == delivery_nh {
            return "delivery";
        }
        return "other";
    }
    "unknown"
}

#[cfg(test)]
mod announce_display_name_tests {
    use super::*;

    #[test]
    fn classify_propagation_target_accepts_prop_and_unknown() {
        let prop_nh = rns_identity::name_hash::name_hash("lxmf.propagation");
        let delivery_nh = rns_identity::name_hash::name_hash("lxmf.delivery");
        let dest = "aabbccddeeff00112233445566778899";
        let other_nh = [0u8; 10];
        assert_eq!(
            classify_propagation_target_name_hashes(
                dest,
                &[(dest.to_string(), prop_nh)],
                &prop_nh,
                &delivery_nh,
            ),
            "propagation"
        );
        assert_eq!(
            classify_propagation_target_name_hashes(
                dest,
                &[(dest.to_string(), delivery_nh)],
                &prop_nh,
                &delivery_nh,
            ),
            "delivery"
        );
        assert_eq!(
            classify_propagation_target_name_hashes(
                dest,
                &[(dest.to_string(), other_nh)],
                &prop_nh,
                &delivery_nh,
            ),
            "other"
        );
        assert_eq!(
            classify_propagation_target_name_hashes(dest, &[], &prop_nh, &delivery_nh),
            "unknown"
        );
        assert_eq!(
            classify_propagation_target_name_hashes(
                dest,
                &[("ffffffffffff00112233445566778899".into(), prop_nh)],
                &prop_nh,
                &delivery_nh,
            ),
            "unknown"
        );
    }

    #[test]
    fn path_table_added_hashes_reports_only_new_membership() {
        let prev: HashSet<String> = ["aa".into(), "bb".into()].into_iter().collect();
        let next: HashSet<String> = ["bb".into(), "cc".into()].into_iter().collect();
        let mut added = path_table_added_hashes(&prev, &next);
        added.sort();
        assert_eq!(added, vec!["cc".to_string()]);
    }

    #[test]
    fn peer_route_fields_equal_includes_public_key() {
        let base = PeerRow {
            destination_hash: "aa".into(),
            display_name: Some("Alice".into()),
            hops: Some(1),
            last_seen: Some(1),
            interface: Some("tcp".into()),
            path_hash: Some("bb".into()),
            via_hash: Some("cc".into()),
            public_key: Some("dd".repeat(64)),
        };
        let mut other = base.clone();
        other.last_seen = Some(99);
        other.display_name = Some("Bob".into());
        assert!(peer_route_fields_equal(&base, &other));
        other.public_key = Some("ee".repeat(64));
        assert!(!peer_route_fields_equal(&base, &other));
        other.public_key = None;
        assert!(!peer_route_fields_equal(&base, &other));
    }

    #[test]
    fn force_path_refresh_rejects_stale_route_until_absent_then_accepts_refresh() {
        // Existing stale route still installed — must not accept yet.
        assert!(!force_path_refresh_accepts_current_path(true, true, false));
        // After DropPath absence was observed, a reinstalled path is acceptable.
        assert!(force_path_refresh_accepts_current_path(true, true, true));
        // Non-force / first discovery: any installed path is fine.
        assert!(force_path_refresh_accepts_current_path(false, true, false));
        assert!(force_path_refresh_accepts_current_path(true, false, false));
    }

    #[test]
    fn request_path_force_clears_peer_via_without_outbound_cache() {
        use super::lxmf_outbound::LxmfOutboundDriver;
        use rns_identity::identity::Identity;
        use std::collections::HashMap;
        use tokio::sync::mpsc;

        let hash = "d765e919676aa0340412a1afae006553";
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        assert!(!driver.has_path_to(hash));

        let mut peer_via_cache: HashMap<String, String> =
            HashMap::from([(hash.to_lowercase(), "TTP_TCP".into())]);

        // Mirrors request_path_force cleanup (must run even when has_path_to is false).
        driver.clear_path_to(hash);
        peer_via_cache.remove(&hash.to_lowercase());

        assert!(!driver.has_path_to(hash));
        assert!(!peer_via_cache.contains_key(hash));
    }

    #[test]
    fn force_path_refresh_simulates_stale_then_refreshed_route() {
        // Simulate ensure_path_for_direct force wait: start with stale path present.
        let had_path_at_start = true;
        let force = true;
        let mut saw_path_absent = false;

        // Tick 1: stale path still present → do not accept.
        let has_path = true;
        assert!(
            has_path
                && !force_path_refresh_accepts_current_path(
                    force,
                    had_path_at_start,
                    saw_path_absent
                ),
            "must not accept stale route before DropPath absence"
        );

        // Tick 2: DropPath cleared the route.
        let has_path = false;
        if !has_path {
            saw_path_absent = true;
        }
        assert!(saw_path_absent);

        // Tick 3: RequestPath installed a refreshed route (fewer hops).
        let has_path = true;
        let hops_after = Some(2u8);
        assert!(force_path_refresh_accepts_current_path(
            force,
            had_path_at_start,
            saw_path_absent
        ));
        assert!(has_path);
        assert_eq!(hops_after, Some(2));
    }

    #[test]
    fn force_path_refresh_timeout_rejects_never_absent_stale_route() {
        // DropPath failed / path never cleared — timeout must not accept stale route.
        let has_path = true;
        let saw_path_absent = false;
        assert!(
            !(has_path && force_path_refresh_accepts_current_path(true, true, saw_path_absent))
        );
        // Absence observed then path reinstalled — timeout may accept.
        assert!(has_path && force_path_refresh_accepts_current_path(true, true, true));
        // Absence observed but no path came back — reject.
        let has_path = false;
        assert!(!(has_path && force_path_refresh_accepts_current_path(true, true, true)));
        // Non-force discovery with a path present — accept.
        let has_path = true;
        assert!(has_path && force_path_refresh_accepts_current_path(false, false, false));
    }

    #[test]
    fn nomad_remote_error_json_includes_egress_and_link_budget_when_known() {
        let with_diag = nomad_remote_error_json(&NomadRemoteQueryError {
            code: "link_timeout".into(),
            egress: Some("tcp"),
            path_hops: Some(1),
            link_hops: Some(3),
            timeout_secs: Some(45),
            force_path_ok: Some(true),
            path_ensure_kind: None,
            raw_error: Some("timed out waiting for link proof".into()),
            elapsed_ms: Some(18_250),
            tried_interfaces: Some(vec!["Ratspeak".into(), "RNS_Transport_US-East".into()]),
            failover_rounds: Some(1),
            last_iface: Some("RNS_Transport_US-East".into()),
        });
        assert_eq!(with_diag["ok"], false);
        assert_eq!(with_diag["error"], "link_timeout");
        assert_eq!(with_diag["egress"], "tcp");
        assert_eq!(with_diag["path_hops"], 1);
        assert_eq!(with_diag["link_hops"], 3);
        assert_eq!(with_diag["proof_budget_secs"], 45);
        assert_eq!(with_diag["timeout_secs"], 45);
        assert_eq!(with_diag["force_path_ok"], true);
        assert_eq!(with_diag["elapsed_ms"], 18250);
        assert_eq!(with_diag["raw_error"], "timed out waiting for link proof");
        assert_eq!(
            with_diag["tried_interfaces"],
            serde_json::json!(["Ratspeak", "RNS_Transport_US-East"])
        );
        assert_eq!(with_diag["failover_rounds"], 1);
        assert_eq!(with_diag["iface"], "RNS_Transport_US-East");

        let without = nomad_remote_error_json(&NomadRemoteQueryError {
            code: "missing_identity_hash".into(),
            egress: None,
            path_hops: None,
            link_hops: None,
            timeout_secs: None,
            force_path_ok: None,
            path_ensure_kind: None,
            raw_error: None,
            elapsed_ms: None,
            tried_interfaces: None,
            failover_rounds: None,
            last_iface: None,
        });
        assert_eq!(without["ok"], false);
        assert_eq!(without["error"], "missing_identity_hash");
        assert!(without.get("egress").is_none());
        assert!(without.get("link_hops").is_none());
        assert!(without.get("timeout_secs").is_none());
        assert!(without.get("failover_rounds").is_none());
        assert!(without.get("iface").is_none());
    }

    #[test]
    fn nomad_remote_ok_json_includes_link_budget_fields() {
        let mut out = serde_json::json!({ "ok": true, "content": "hi" });
        merge_nomad_remote_ok_fields(
            &mut out,
            &NomadRemoteQueryOk {
                egress: "tcp",
                timeout_secs: 45,
                path_hops: 1,
                link_hops: 3,
                force_path_ok: None,
                path_ensure_kind: None,
                elapsed_ms: 4200,
            },
        );
        assert_eq!(out["egress"], "tcp");
        assert_eq!(out["path_hops"], 1);
        assert_eq!(out["link_hops"], 3);
        assert_eq!(out["proof_budget_secs"], 45);
        assert_eq!(out["timeout_secs"], 45);
        assert_eq!(out["elapsed_ms"], 4200);
        assert!(out.get("force_path_ok").is_none());
    }

    #[test]
    fn nomad_response_too_large_json_retains_link_budget_diagnostics() {
        let meta = NomadRemoteQueryOk {
            egress: "tcp",
            timeout_secs: 45,
            path_hops: 5,
            link_hops: 5,
            force_path_ok: Some(false),
            path_ensure_kind: Some("cached_hit"),
            elapsed_ms: 1200,
        };
        // Same helper used by remote page and file oversized branches.
        let out = nomad_response_too_large_json(&meta);
        assert_eq!(out["ok"], false);
        assert_eq!(out["error"], "response_too_large");
        assert_eq!(out["egress"], "tcp");
        assert_eq!(out["path_hops"], 5);
        assert_eq!(out["link_hops"], 5);
        assert_eq!(out["proof_budget_secs"], 45);
        assert_eq!(out["timeout_secs"], 45);
        assert_eq!(out["force_path_ok"], false);
        assert_eq!(out["path_ensure_kind"], "cached_hit");
        assert_eq!(out["elapsed_ms"], 1200);
    }

    #[test]
    fn force_path_refresh_timeout_accepts_fallthrough_when_never_absent() {
        // Nomad force refresh: path never left the table, but fall-through is on.
        assert!(force_path_refresh_timeout_accepts(
            true, true, true, false, true
        ));
        // Same never-absent stale route without fall-through must reject.
        assert!(!force_path_refresh_timeout_accepts(
            true, true, true, false, false
        ));
        // Absence observed then path back — accept even without fall-through.
        assert!(force_path_refresh_timeout_accepts(
            true, true, true, true, false
        ));
        // No path at timeout — never accept.
        assert!(!force_path_refresh_timeout_accepts(
            true, true, false, true, true
        ));
        // Force started without a path: accept whatever appeared (accept_existing unused).
        assert!(force_path_refresh_timeout_accepts(
            true, false, true, false, true
        ));
        assert!(force_path_refresh_timeout_accepts(
            true, false, true, false, false
        ));
        // Non-force first probe: path that appears by timeout is accepted even when
        // accept_existing_on_timeout is false (reserved for forced stale fall-through).
        assert!(force_path_refresh_timeout_accepts(
            false, false, true, true, false
        ));
        assert!(!force_path_refresh_timeout_accepts(
            false, false, false, true, false
        ));
    }

    #[test]
    fn path_ensure_kind_after_timeout_matches_accept_matrix() {
        // Same input matrix as force_path_refresh_timeout_accepts_fallthrough_when_never_absent.
        let cases: &[(bool, bool, bool, bool, bool, PathEnsureKind)] = &[
            // force, had_start, has_path, saw_absent, accept_existing → kind
            (true, true, true, false, true, PathEnsureKind::StaleAccept),
            (true, true, true, false, false, PathEnsureKind::Missing),
            (true, true, true, true, false, PathEnsureKind::Rediscovered),
            (true, true, false, true, true, PathEnsureKind::Missing),
            (true, false, true, false, true, PathEnsureKind::Rediscovered),
            (
                true,
                false,
                true,
                false,
                false,
                PathEnsureKind::Rediscovered,
            ),
            (
                false,
                false,
                true,
                true,
                false,
                PathEnsureKind::Rediscovered,
            ),
            (false, false, false, true, false, PathEnsureKind::Missing),
        ];
        for &(force, had_start, has_path, saw_absent, accept_existing, expected) in cases {
            let accept = force_path_refresh_timeout_accepts(
                force,
                had_start,
                has_path,
                saw_absent,
                accept_existing,
            );
            assert_eq!(
                path_ensure_kind_after_timeout(
                    accept,
                    force,
                    had_start,
                    saw_absent,
                    accept_existing,
                ),
                expected,
                "force={force} had_start={had_start} has_path={has_path} saw_absent={saw_absent} accept_existing={accept_existing} accept={accept}"
            );
        }
    }

    #[test]
    fn path_table_added_hashes_empty_when_membership_unchanged() {
        let prev: HashSet<String> = ["aa".into()].into_iter().collect();
        let next: HashSet<String> = ["aa".into()].into_iter().collect();
        assert!(path_table_added_hashes(&prev, &next).is_empty());
    }

    #[test]
    fn parse_rrc_hub_announce_name_cbor_hub_key() {
        let mut buf = Vec::new();
        let map = ciborium::Value::Map(vec![
            (
                ciborium::Value::Text("proto".into()),
                ciborium::Value::Text("rrc".into()),
            ),
            (
                ciborium::Value::Text("v".into()),
                ciborium::Value::Integer(1.into()),
            ),
            (
                ciborium::Value::Text("hub".into()),
                ciborium::Value::Text("rnscommunity".into()),
            ),
        ]);
        ciborium::into_writer(&map, &mut buf).unwrap();
        assert_eq!(
            parse_rrc_hub_announce_name(Some(&buf)),
            Some("rnscommunity".into())
        );
    }

    #[test]
    fn parse_rrc_hub_announce_name_rejects_lxmf_noise() {
        assert_eq!(parse_rrc_hub_announce_name(Some(b"LXMF")), None);
    }

    #[test]
    fn parse_announce_display_name_raw_utf8() {
        assert_eq!(
            parse_announce_display_name(Some(b"Alice Node")),
            Some("Alice Node".into())
        );
    }

    #[test]
    fn parse_announce_display_name_msgpack_binary() {
        let mut buf = Vec::new();
        rmpv::encode::write_value(
            &mut buf,
            &rmpv::Value::Array(vec![rmpv::Value::Binary(b"Mesh Peer".to_vec())]),
        )
        .unwrap();
        assert_eq!(
            parse_announce_display_name(Some(&buf)),
            Some("Mesh Peer".into())
        );
    }

    #[test]
    fn parse_announce_display_name_empty_is_none() {
        assert_eq!(parse_announce_display_name(Some(b"")), None);
        assert_eq!(parse_announce_display_name(None), None);
    }

    #[test]
    fn parse_announce_display_name_rejects_control_chars() {
        assert_eq!(parse_announce_display_name(Some(b"bad\x01name")), None);
    }

    #[test]
    fn parse_announce_display_name_json_server_name() {
        let json = br#"{"server_name": "Aurora Mesh \u2014 Cosmos BBS"}"#;
        assert_eq!(
            parse_announce_display_name(Some(json)),
            Some("Aurora Mesh — Cosmos BBS".into())
        );
    }

    #[test]
    fn parse_announce_display_name_json_rmap_geo_blob_is_none() {
        let json = br#"{"h":"5440f5d4485a00fb8441ad94fbdee46e","ha":"0","c":"1","c_n":"County/Region/City","r":"1","r_n":"Country,Country/Region"}"#;
        assert_eq!(parse_announce_display_name(Some(json)), None);
    }

    #[test]
    fn parse_announce_display_name_rejects_unknown_json_object() {
        assert_eq!(parse_announce_display_name(Some(br#"{"foo":"bar"}"#)), None);
    }

    #[test]
    fn resolve_inbound_sender_name_map_uses_cache_entry() {
        let mut names = HashMap::new();
        names.insert("aa".repeat(16), "Alice".into());
        assert_eq!(
            resolve_inbound_sender_name_map(&names, &"aa".repeat(16)),
            "Alice"
        );
    }

    #[test]
    fn resolve_inbound_sender_name_prefers_contact_display_name() {
        let contacts = vec![ContactRow {
            destination_hash: "aa".repeat(16),
            display_name: Some("Alice".into()),
            last_heard: None,
            favorited: false,
        }];
        assert_eq!(
            resolve_inbound_sender_name(&contacts, &"aa".repeat(16)),
            "Alice"
        );
    }

    #[test]
    fn resolve_inbound_sender_name_falls_back_to_hash_prefix() {
        let contacts = vec![];
        let hash = "deadbeef".repeat(4);
        assert_eq!(
            resolve_inbound_sender_name(&contacts, &hash),
            "deadbeefdead"
        );
    }

    #[test]
    fn parse_hash16_requires_exact_32_hex() {
        assert!(parse_hash16("aabbccddeeff00112233445566778899").is_ok());
        assert!(parse_hash16("AABBCCDDEEFF00112233445566778899").is_ok());
        assert!(parse_hash16("aabb").is_err());
        assert!(parse_hash16("aabbccddeeff00112233445566778899ff").is_err());
        assert!(parse_hash16("aabbccddeeff0011223344556677889g").is_err());
        assert!(parse_hash16("aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99").is_err());
    }

    #[test]
    fn path_table_added_hashes_capped_truncates_large_deltas() {
        let prev: HashSet<String> = HashSet::new();
        let next: HashSet<String> = (0..(MAX_PEERS_UPDATED_ADDED + 10))
            .map(|i| format!("{i:032x}"))
            .collect();
        let added = path_table_added_hashes_capped(&prev, &next);
        assert_eq!(added.len(), MAX_PEERS_UPDATED_ADDED);
    }

    #[test]
    fn insert_display_name_bounded_evicts_when_full() {
        let mut cache = HashMap::new();
        for i in 0..MAX_DISPLAY_NAME_CACHE {
            insert_display_name_bounded(&mut cache, format!("{i:032x}"), format!("n{i}"));
        }
        assert_eq!(cache.len(), MAX_DISPLAY_NAME_CACHE);
        insert_display_name_bounded(&mut cache, "ff".repeat(16), "overflow".into());
        assert_eq!(cache.len(), MAX_DISPLAY_NAME_CACHE);
        assert_eq!(
            cache.get(&"ff".repeat(16)).map(String::as_str),
            Some("overflow")
        );
        // Refresh of existing key must not grow past the cap.
        insert_display_name_bounded(&mut cache, "ff".repeat(16), "renamed".into());
        assert_eq!(cache.len(), MAX_DISPLAY_NAME_CACHE);
        assert_eq!(
            cache.get(&"ff".repeat(16)).map(String::as_str),
            Some("renamed")
        );
    }
}

#[cfg(test)]
mod nomad_private_first_failover_tests {
    use super::*;
    use crate::stack::auto_path_policy::order_live_ifaces_private_first;
    use crate::stack::path_failover::{live_interface_names, remaining_live_ifaces};
    use crate::stack::types::interface_discovery_defaults;

    fn iface_row(name: &str, status: &str, host: Option<&str>) -> InterfaceRow {
        let (
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
        ) = interface_discovery_defaults();
        InterfaceRow {
            id: name.to_lowercase().replace(' ', "-"),
            name: name.into(),
            iface_type: "tcp".into(),
            enabled: true,
            status: status.into(),
            host: host.map(str::to_string),
            port: None,
            preset: None,
            serial_port: None,
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: None,
            runtime_mode: None,
            seed_addresses: vec![],
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
            network_name: None,
            passphrase: None,
            flow_control: None,
            ignore_config_warnings: None,
            tx_queue_used: None,
            tx_queue_max: None,
            extra_config: std::collections::HashMap::default(),
        }
    }

    /// Mirrors LiveBridge::query_nomad_node prefer-list construction after a failed path.
    #[test]
    fn live_bridge_prefer_list_is_private_first_excluding_blocked() {
        let interfaces = [
            iface_row("Ratspeak 2", "up", Some("2.ratspeak.org")),
            iface_row("Local Transport Pi", "up", Some("192.168.1.111")),
            iface_row("Auto", "up", None),
        ];
        // LiveBridge uses iface_type detection via auto_path_policy for private;
        // mark Auto as auto type so it is not a private network target.
        let mut interfaces = interfaces.to_vec();
        interfaces[2].iface_type = "auto".into();

        let live_ifaces =
            order_live_ifaces_private_first(&live_interface_names(&interfaces), &interfaces);
        assert_eq!(
            live_ifaces.first().map(String::as_str),
            Some("Local Transport Pi")
        );
        let prefer = remaining_live_ifaces(&live_ifaces, &["Auto".into()]);
        assert_eq!(
            prefer,
            vec!["Local Transport Pi".to_string(), "Ratspeak 2".to_string()]
        );
        // Neither host private → preserve input order after filter.
        let public_only = [
            iface_row("Ratspeak 2", "up", Some("2.ratspeak.org")),
            iface_row("TTP", "up", Some("1.ratspeak.org")),
        ];
        let live_public =
            order_live_ifaces_private_first(&live_interface_names(&public_only), &public_only);
        assert_eq!(
            live_public,
            vec!["Ratspeak 2".to_string(), "TTP".to_string()]
        );
    }
}

#[cfg(test)]
mod icon_appearance_tests {
    use super::*;
    use lxmf_core::constants::FIELD_ICON_APPEARANCE;
    use lxmf_core::message::LxMessage;

    #[test]
    fn icon_appearance_json_from_message_parses_msgpack_field() {
        let mut buf = Vec::new();
        rmpv::encode::write_value(
            &mut buf,
            &rmpv::Value::Array(vec![
                rmpv::Value::String("hiking".into()),
                rmpv::Value::Binary(vec![255, 255, 0]),
                rmpv::Value::Binary(vec![0, 0, 255]),
            ]),
        )
        .expect("encode icon appearance");

        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "hello", DeliveryMethod::Direct);
        msg.set_field(FIELD_ICON_APPEARANCE, buf);
        let json = icon_appearance_json_from_message(&msg).expect("icon json");
        assert_eq!(json["icon_name"], "hiking");
        assert_eq!(json["foreground_rgb"], serde_json::json!([255, 255, 0]));
        assert_eq!(json["background_rgb"], serde_json::json!([0, 0, 255]));
    }
}

#[cfg(test)]
mod audio_field_tests {
    use super::*;
    use base64::Engine as _;
    use lxmf_core::constants::AM_OPUS_OGG;
    use lxmf_core::message::LxMessage;

    #[test]
    fn audio_json_from_message_round_trips_opus_ogg() {
        let ogg = b"OggS\0fake-opus-bytes";
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "", DeliveryMethod::Direct);
        msg.set_audio_field(AM_OPUS_OGG, ogg).expect("set audio");
        let json = audio_json_from_message(&msg).expect("audio json");
        assert_eq!(json["mode"], AM_OPUS_OGG);
        assert_eq!(json["size_bytes"], ogg.len());
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(json["data_base64"].as_str().expect("b64"))
            .expect("decode");
        assert_eq!(decoded, ogg);
    }

    #[test]
    fn audio_json_from_message_malformed_fail_open() {
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "hi", DeliveryMethod::Direct);
        // Intentionally malformed: array of 3 elements instead of [mode, bytes].
        msg.set_msgpack_field(
            lxmf_core::constants::FIELD_AUDIO,
            vec![0x93, AM_OPUS_OGG, 0xc4, 0x00, 0xc0],
        )
        .expect("set malformed");
        assert!(audio_json_from_message(&msg).is_none());
        let payload = lxmf_payload_from_message(
            &msg,
            "aa".repeat(16).as_str(),
            "Self",
            None,
            None,
            "inbound",
            None,
        );
        assert_eq!(payload["text"], "hi");
        assert!(payload.get("audio").is_none());
    }

    #[test]
    fn lxmf_payload_sets_voice_marker_when_text_empty() {
        let ogg = b"OggS\0memo";
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "", DeliveryMethod::Direct);
        msg.set_audio_field(AM_OPUS_OGG, ogg).expect("set audio");
        let payload = lxmf_payload_from_message(
            &msg,
            "aa".repeat(16).as_str(),
            "Self",
            None,
            None,
            "inbound",
            None,
        );
        assert_eq!(payload["text"], "[voice:0]");
        assert!(payload.get("audio").is_some());
        assert!(payload.get("attachment").is_none());
    }

    #[test]
    fn decode_lxmf_audio_request_rejects_oversize() {
        let oversized = vec![0u8; MAX_LXMF_AUDIO_FIELD_BYTES + 1];
        let req = super::super::types::LxmfAudioRequest {
            mode: AM_OPUS_OGG,
            data_base64: base64::engine::general_purpose::STANDARD.encode(&oversized),
        };
        let err = decode_lxmf_audio_request(Some(&req)).expect_err("oversize");
        assert!(err.starts_with("audio_too_large"), "{err}");
    }

    #[test]
    fn set_audio_field_changes_message_hash_after_sign() {
        use rns_identity::identity::Identity;
        let identity = Identity::new();
        let signing = identity.get_signing_key().expect("signing key");
        let source = identity.hash;

        let mut without =
            LxMessage::new([0u8; 16], source, "", "[voice:0]", DeliveryMethod::Direct);
        without.sign(&signing).expect("sign");
        let hash_without = without.hash.expect("hash");

        let mut with = LxMessage::new([0u8; 16], source, "", "[voice:0]", DeliveryMethod::Direct);
        with.set_audio_field(AM_OPUS_OGG, b"OggS\0x")
            .expect("set audio");
        with.sign(&signing).expect("sign");
        let hash_with = with.hash.expect("hash");
        assert_ne!(hash_without, hash_with);
    }
}

#[cfg(test)]
mod reply_field_tests {
    use super::*;
    use lxmf_core::message::LxMessage;

    #[test]
    fn parse_hash32_requires_exact_64_hex() {
        let ok = "aa".repeat(32);
        assert!(parse_hash32(&ok).is_ok());
        assert!(parse_hash32("aabb").is_err());
        assert!(parse_hash32(&"aa".repeat(16)).is_err());
        assert!(parse_optional_reply_to_hash(Some("not-a-hash")).is_none());
        assert!(parse_optional_reply_to_hash(None).is_none());
        assert_eq!(
            parse_optional_reply_to_hash(Some(&ok)).map(hex::encode),
            Some(ok)
        );
    }

    #[test]
    fn reply_fields_round_trip_on_lxmf_message() {
        let parent_id = [0x11u8; 32];
        let mut msg = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "reply body",
            DeliveryMethod::Direct,
        );
        msg.set_field(FIELD_REPLY_TO, parent_id.to_vec());
        msg.set_field(FIELD_REPLY_QUOTE, b"original snippet".to_vec());

        let fields = reply_fields_from_message(&msg).expect("reply fields");
        assert_eq!(fields.reply_to_hash, hex::encode(parent_id));
        assert_eq!(
            fields.reply_preview_text.as_deref(),
            Some("original snippet")
        );

        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert_eq!(payload["reply_to_hash"], hex::encode(parent_id));
        assert_eq!(payload["reply_preview_text"], "original snippet");
        assert_eq!(payload["text"], "reply body");
    }

    #[test]
    fn reply_fields_omit_invalid_length_reply_to() {
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "hi", DeliveryMethod::Direct);
        msg.set_field(FIELD_REPLY_TO, vec![0u8; 16]);
        assert!(reply_fields_from_message(&msg).is_none());
    }

    #[test]
    fn apply_reply_fields_caps_quote_length() {
        let parent_id = [0x22u8; 32];
        let long = "x".repeat(REPLY_QUOTE_MAX_CHARS + 40);
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "reply", DeliveryMethod::Direct);
        apply_reply_fields(&mut msg, Some(parent_id), Some(&long));
        let fields = reply_fields_from_message(&msg).expect("reply fields");
        assert_eq!(
            fields
                .reply_preview_text
                .as_ref()
                .map(|s| s.chars().count()),
            Some(REPLY_QUOTE_MAX_CHARS)
        );
    }

    #[test]
    fn lxmf_payload_sets_paper_delivery_method_and_received_via() {
        let msg = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "paper body",
            DeliveryMethod::Paper,
        );
        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            Some("paper"),
            None,
            "inbound",
            Some("Bob"),
        );
        assert_eq!(payload["delivery_method"], "paper");
        assert_eq!(payload["received_via"], "paper");
        assert_eq!(payload["text"], "paper body");
        assert_eq!(payload["sender_name"], "Bob");
    }

    fn write_reaction_map(pairs: Vec<(rmpv::Value, rmpv::Value)>) -> Vec<u8> {
        let mut buf = Vec::new();
        rmpv::encode::write_value(&mut buf, &rmpv::Value::Map(pairs)).expect("encode reaction");
        buf
    }

    #[test]
    fn encode_reaction_field_round_trips_target_and_emoji() {
        let target = [0x11u8; 32];
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "👍", DeliveryMethod::Direct);
        msg.set_msgpack_field(FIELD_REACTION, encode_reaction_field(&target, "👍"))
            .expect("set reaction field");

        let decoded = reaction_fields_from_message(&msg).expect("reaction fields");
        assert_eq!(decoded.reaction_target, hex::encode(target));
        assert_eq!(decoded.emoji.as_deref(), Some("👍"));

        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert_eq!(payload["reaction_target"], hex::encode(target));
        // Emoji stays as message content for clients that ignore 0x40.
        assert_eq!(payload["text"], "👍");
        assert!(payload.get("reply_to_hash").is_none());
    }

    #[test]
    fn reaction_missing_field_leaves_payload_untouched() {
        let msg = LxMessage::new([0u8; 16], [1u8; 16], "", "hello", DeliveryMethod::Direct);
        assert!(reaction_fields_from_message(&msg).is_none());

        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert!(payload.get("reaction_target").is_none());
        assert_eq!(payload["text"], "hello");
    }

    #[test]
    fn reaction_decodes_from_64_hex_string_target() {
        let target_hex = "AB".repeat(32); // uppercase, Ratspeak-style hex string
        let map = write_reaction_map(vec![
            (
                rmpv::Value::Integer(rmpv::Integer::from(REACTION_TO)),
                rmpv::Value::String(target_hex.as_str().into()),
            ),
            (
                rmpv::Value::Integer(rmpv::Integer::from(REACTION_CONTENT)),
                rmpv::Value::String("🎉".into()),
            ),
        ]);
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "", DeliveryMethod::Direct);
        msg.set_msgpack_field(FIELD_REACTION, map)
            .expect("set field");

        let decoded = reaction_fields_from_message(&msg).expect("reaction fields");
        assert_eq!(decoded.reaction_target, target_hex.to_ascii_lowercase());
        assert_eq!(decoded.emoji.as_deref(), Some("🎉"));

        // Content was empty, so the field emoji fills `text`.
        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert_eq!(payload["text"], "🎉");
    }

    #[test]
    fn reaction_malformed_field_is_ignored() {
        // Not a msgpack map (a plain string value).
        let mut buf = Vec::new();
        rmpv::encode::write_value(&mut buf, &rmpv::Value::String("garbage".into()))
            .expect("encode garbage");
        let mut msg = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "still here",
            DeliveryMethod::Direct,
        );
        msg.set_msgpack_field(FIELD_REACTION, buf)
            .expect("set field");
        assert!(reaction_fields_from_message(&msg).is_none());

        // Map present but REACTION_TO has a bad length → treated as absent.
        let bad_len = write_reaction_map(vec![(
            rmpv::Value::Integer(rmpv::Integer::from(REACTION_TO)),
            rmpv::Value::Binary(vec![0u8; 16]),
        )]);
        let mut msg2 = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "still here",
            DeliveryMethod::Direct,
        );
        msg2.set_msgpack_field(FIELD_REACTION, bad_len)
            .expect("set field");
        assert!(reaction_fields_from_message(&msg2).is_none());

        let payload = lxmf_payload_from_message(
            &msg2,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert!(payload.get("reaction_target").is_none());
        assert_eq!(payload["text"], "still here");
    }

    #[test]
    fn reaction_wins_over_reply_when_both_present() {
        let reaction_target = [0x22u8; 32];
        let reply_parent = [0x33u8; 32];
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "😀", DeliveryMethod::Direct);
        msg.set_field(FIELD_REPLY_TO, reply_parent.to_vec());
        msg.set_field(FIELD_REPLY_QUOTE, b"quoted".to_vec());
        msg.set_msgpack_field(
            FIELD_REACTION,
            encode_reaction_field(&reaction_target, "😀"),
        )
        .expect("set reaction field");

        let payload = lxmf_payload_from_message(
            &msg,
            "aabbccddeeff00112233445566778899",
            "Self",
            None,
            None,
            "inbound",
            Some("Alice"),
        );
        assert_eq!(payload["reaction_target"], hex::encode(reaction_target));
        // A reaction must not also render as a reply bubble.
        assert!(payload.get("reply_to_hash").is_none());
        assert!(payload.get("reply_preview_text").is_none());
    }

    #[test]
    fn reaction_field_with_trailing_bytes_is_rejected() {
        // A well-formed reaction map that is followed by extra bytes must fail open: the field
        // is malformed, so decoding returns None (ingest as normal text) rather than trust it.
        let target = [0x44u8; 32];
        let mut buf = encode_reaction_field(&target, "🔥");
        buf.push(0x00); // trailing byte after the complete msgpack map
        // Use the raw field setter: set_msgpack_field itself rejects trailing bytes, but a hostile
        // or buggy peer can still place raw bytes in the field, which decode must reject.
        let mut msg = LxMessage::new([0u8; 16], [1u8; 16], "", "🔥", DeliveryMethod::Direct);
        msg.set_field(FIELD_REACTION, buf);
        assert!(reaction_fields_from_message(&msg).is_none());

        // Sanity: the same map without trailing bytes still decodes.
        let mut ok_msg = LxMessage::new([0u8; 16], [1u8; 16], "", "🔥", DeliveryMethod::Direct);
        ok_msg
            .set_msgpack_field(FIELD_REACTION, encode_reaction_field(&target, "🔥"))
            .expect("set field");
        let decoded = reaction_fields_from_message(&ok_msg).expect("reaction fields");
        assert_eq!(decoded.reaction_target, hex::encode(target));
    }
}

#[cfg(test)]
mod live_tx_queue_fields_tests {
    use super::{live_interface_runtime_mode_if_online, live_interface_tx_queue_fields};

    #[test]
    fn online_stats_populate_used_and_max() {
        assert_eq!(
            live_interface_tx_queue_fields(true, 64, 256),
            (Some(64), Some(256))
        );
        assert_eq!(
            live_interface_tx_queue_fields(true, 0, 256),
            (Some(0), Some(256))
        );
    }

    #[test]
    fn offline_or_zero_capacity_remain_unset() {
        assert_eq!(live_interface_tx_queue_fields(false, 64, 256), (None, None));
        assert_eq!(live_interface_tx_queue_fields(false, 0, 0), (None, None));
        // Zero-capacity must stay unavailable rather than Some(0).
        assert_eq!(live_interface_tx_queue_fields(true, 0, 0), (None, None));
        assert_eq!(live_interface_tx_queue_fields(true, 10, 0), (None, None));
    }

    #[test]
    fn offline_exposes_no_runtime_mode() {
        assert_eq!(
            live_interface_runtime_mode_if_online(false, "AccessPoint"),
            None
        );
        assert_eq!(
            live_interface_runtime_mode_if_online(true, "AccessPoint").as_deref(),
            Some("access_point")
        );
    }
}
