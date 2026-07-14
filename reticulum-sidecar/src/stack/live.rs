//! Live rsReticulum bridge (optional runtime queries + LXMF send/receive).

#[path = "lxmf_outbound.rs"]
mod lxmf_outbound;

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use lxmf_core::constants::{DeliveryMethod, FIELD_FILE_ATTACHMENTS, FIELD_ICON_APPEARANCE};
use lxmf_core::message::LxMessage;
use lxmf_core::router::LxmRouter;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_runtime::link_client::LinkClient;
use rns_runtime::lifecycle::ShutdownSignal;
use rns_runtime::reticulum;
use rns_transport::messages::{
    AnnounceHandlerEvent, TransportMessage, TransportQuery, TransportQueryResponse,
};
use tokio::sync::{RwLock, broadcast};

use super::StackHandle;
use super::config;
use super::local_rnode_primary;
use super::lxmf_delivery::{
    send_lxmf_delivery_announce, spawn_lxmf_announce_loop, spawn_lxmf_inbound_receiver, LXMF_APP,
};
use super::nomad_file::nomad_file_name_from_path;
use super::nomad_link_errors::map_nomad_link_error;
use super::nomad_request_payload::nomad_page_request_payload;
use super::nomad_timeouts;
use super::packet_log::{
    collect_tx_interface_names_for_egress, emit_wire_packet_event, wire_packet_from_tap,
    PacketLogBuffer,
};
use super::persistence::PersistedState;
use super::propagation_bridge::PropagationBridge;
use super::types::{InterfaceRow, LxmfReactionRequest, LxmfResourceRequest, LxmfSendRequest, PeerRow, ContactRow};
use super::via::{
    classify_path_interface_name, merge_live_interfaces_with_config, merge_observed_egress_vias,
    resolve_lxmf_sent_via,
};
use lxmf_outbound::LxmfOutboundDriver;

/// Settle window for PacketTap Tx correlation after LXMF enqueue.
const LXMF_EGRESS_TAP_SETTLE_MS: u64 = 1500;

/// Cap blocking transport control queries so HTTP handlers return cached state
/// before the Electron IPC proxy GET timeout (10s default).
const TRANSPORT_QUERY_TIMEOUT: Duration = Duration::from_secs(8);

/// Aspect Nomad Network nodes announce and serve page/file requests under.
const NOMAD_NODE_ASPECT: &str = "nomadnetwork.node";

#[cfg(feature = "rns-ble")]
struct BlePeerRuntimeState {
    spawned: HashMap<String, u64>,
    foreground_wake: Arc<tokio::sync::Notify>,
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
    display_name_cache: Arc<Mutex<HashMap<String, String>>>,
    outbound: Arc<Mutex<LxmfOutboundDriver>>,
    propagation: Arc<PropagationBridge>,
    sync_cancel: Arc<std::sync::atomic::AtomicBool>,
    event_tx: broadcast::Sender<String>,
    packet_log: Arc<PacketLogBuffer>,
    /// Serialize Nomad Link queries — transport actor is single-threaded and
    /// overlapping page/file fetches contend with path/pubkey discovery.
    nomad_link_lock: Arc<tokio::sync::Mutex<()>>,
    #[cfg(feature = "rns-ble")]
    ble_peer_state: Arc<tokio::sync::Mutex<BlePeerRuntimeState>>,
}

impl LiveBridge {
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
        let event_tx_tap = event_tx.clone();
        tokio::spawn(async move {
            loop {
                match tap_rx.recv().await {
                    Ok(evt) => {
                        let row = wire_packet_from_tap(&evt);
                        packet_log_tap.push(row.clone());
                        emit_wire_packet_event(&event_tx_tap, &row);
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

        const LXMF_APP_NAME: &str = LXMF_APP;
        let lxmf_dest_hash =
            Destination::hash_from_name_and_identity(LXMF_APP_NAME, Some(&identity.hash));
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
        let display_name_cache: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new({
            let state = inner.read().await;
            contacts_to_name_map(&state.contacts)
        }));

        let mut router = LxmRouter::new(lxmf_core::router::RouterConfig::default());
        router.set_transport(handle.transport_tx.clone());

        let cache_for_cb = peer_via_cache.clone();
        let name_cache_for_cb = display_name_cache.clone();
        let event_tx_cb = event_tx.clone();
        let self_hash_cb = lxmf_hash_hex.clone();
        let self_name_cb = display_name.clone();
        let inner_for_cb = inner.clone();
        let config_dir_for_cb = config_dir.clone();
        let storage_dir_for_cb = storage_dir.clone();
        router.register_delivery_callback(move |msg| {
            if !msg.incoming {
                return;
            }
            let sender_hex = hex::encode(msg.source_hash);
            // Match path-table iface name to local config (same as outbound) so
            // TCP hubs named e.g. "RNS Testnet" classify as tcp, not network.
            let received_via = cache_for_cb
                .lock()
                .ok()
                .and_then(|cache| cache.get(&sender_hex).cloned())
                .map(|iface_name| {
                    let config_rows =
                        config::interfaces_from_config_dir(&config_dir_for_cb).unwrap_or_default();
                    classify_path_interface_name(&iface_name, &config_rows).to_string()
                })
                .unwrap_or_else(|| "network".into());
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
            let inner = inner_for_cb.clone();
            let config_dir = config_dir_for_cb.clone();
            let storage_dir = storage_dir_for_cb.clone();
            let name_cache = name_cache_for_cb.clone();
            let sender = sender_hex.clone();
            tokio::spawn(async move {
                let mut state = inner.write().await;
                if let Some(name) = state
                    .contacts
                    .iter()
                    .find(|c| c.destination_hash == sender)
                    .and_then(|c| c.display_name.clone())
                    .filter(|name| !name.trim().is_empty())
                {
                    if let Ok(mut cache) = name_cache.lock() {
                        cache.insert(sender.clone(), name);
                    }
                }
                state.upsert_contact(&sender, None);
                if let Err(e) = state.save(&config_dir, &storage_dir) {
                    tracing::warn!("contact persist failed: {e}");
                }
            });
            emit_lxmf_event(&event_tx_cb, payload);
        });

        let router = Arc::new(tokio::sync::Mutex::new(router));
        spawn_lxmf_inbound_receiver(
            handle.transport_tx.clone(),
            &identity,
            lxmf_dest_hash,
            router.clone(),
        );
        spawn_lxmf_announce_loop(
            handle.transport_tx.clone(),
            identity.clone(),
            lxmf_dest_hash,
            config_dir.clone(),
            inner.clone(),
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
            display_name_cache,
            outbound: Arc::new(Mutex::new(LxmfOutboundDriver::new(
                handle.transport_tx.clone(),
                &identity,
                lxmf_hash_hex.clone(),
                display_name.clone(),
            ))),
            propagation: Arc::new(PropagationBridge::new(
                handle.transport_tx.clone(),
                lxmf_dest_hash,
                storage_dir.join("propagation"),
            )?),
            sync_cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            event_tx: event_tx.clone(),
            packet_log,
            nomad_link_lock: Arc::new(tokio::sync::Mutex::new(())),
            #[cfg(feature = "rns-ble")]
            ble_peer_state: Arc::new(tokio::sync::Mutex::new(BlePeerRuntimeState {
                spawned: HashMap::new(),
                foreground_wake: foreground_wake.clone(),
            })),
        };

        let preferred_prop_hash = {
            let state = inner.read().await;
            state
                .preferred_propagation_id
                .as_ref()
                .and_then(|id| {
                    state
                        .propagation
                        .iter()
                        .find(|p| p.id == *id)
                        .and_then(|p| p.destination_hash.clone())
                })
        };

        bridge.spawn_maintenance(event_tx);

        if let Some(hash_hex) = preferred_prop_hash {
            bridge.set_outbound_propagation_node(Some(&hash_hex)).await;
        }

        if let Ok(ifaces) = config::interfaces_from_config_dir(&config_dir) {
            let _ = bridge.sync_ble_peer_interfaces(&ifaces).await;
        }

        {
            let mut state = inner.write().await;
            state.rns_ready = true;
            state.lxmf_ready = true;
        }

        Ok(bridge)
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
        .await
    }

    /// `hash_hex` is the announced Nomad node destination hash (used for the
    /// path-table hops lookup); `identity_hash_hex` is the node's identity
    /// hash recovered from its announce (`AnnounceHandlerEvent::identity_hash`),
    /// required by `LinkClient::query` to rebuild the `nomadnetwork.node`
    /// destination on our side.
    async fn query_nomad_node(
        &self,
        hash_hex: &str,
        identity_hash_hex: &str,
        path: &str,
        payload: Vec<u8>,
        interfaces: &[InterfaceRow],
    ) -> Result<Vec<u8>, String> {
        let remote_hash = parse_hash16(identity_hash_hex)?;
        let hops = self.hops_to_destination(hash_hex).await.unwrap_or(8);
        let timeout_secs = nomad_timeouts::nomad_page_timeout_secs_for_interfaces(interfaces, hops);
        let _guard = match tokio::time::timeout(NOMAD_LINK_LOCK_WAIT, self.nomad_link_lock.lock()).await
        {
            Ok(g) => g,
            Err(_) => return Err("nomad_busy".into()),
        };
        let client = LinkClient::new(self.handle.transport_tx.clone(), self.identity.clone());
        client
            .query(
                remote_hash,
                NOMAD_NODE_ASPECT,
                path,
                payload,
                hops,
                Duration::from_secs(timeout_secs),
            )
            .await
            .map_err(|e| map_nomad_link_error(&format!("{e}")))
    }

    pub async fn fetch_nomad_file(
        &self,
        hash_hex: &str,
        identity_hash_hex: Option<&str>,
        path: &str,
        interfaces: &[InterfaceRow],
    ) -> serde_json::Value {
        let Some(identity_hash_hex) = identity_hash_hex.filter(|s| !s.is_empty()) else {
            return serde_json::json!({ "ok": false, "error": "missing_identity_hash" });
        };
        match self
            .query_nomad_node(hash_hex, identity_hash_hex, path, Vec::new(), interfaces)
            .await
        {
            Ok(bytes) => {
                if bytes.len() > NOMAD_FILE_MAX_BYTES {
                    return serde_json::json!({ "ok": false, "error": "response_too_large" });
                }
                let file_name = nomad_file_name_from_path(path);
                let content_base64 = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &bytes,
                );
                serde_json::json!({
                    "ok": true,
                    "file_name": file_name,
                    "content_base64": content_base64,
                })
            }
            Err(e) => serde_json::json!({
                "ok": false,
                "error": e,
            }),
        }
    }

    /// See `fetch_nomad_file` for `hash_hex` / `identity_hash_hex` semantics.
    pub async fn fetch_nomad_page(
        &self,
        hash_hex: &str,
        identity_hash_hex: Option<&str>,
        path: &str,
        data_b64: Option<&str>,
        interfaces: &[InterfaceRow],
    ) -> serde_json::Value {
        let Some(identity_hash_hex) = identity_hash_hex.filter(|s| !s.is_empty()) else {
            return serde_json::json!({ "ok": false, "error": "missing_identity_hash" });
        };
        let payload = nomad_page_request_payload(data_b64);
        match self
            .query_nomad_node(hash_hex, identity_hash_hex, path, payload, interfaces)
            .await
        {
            Ok(bytes) => {
                if bytes.len() > NOMAD_PAGE_MAX_BYTES {
                    return serde_json::json!({ "ok": false, "error": "response_too_large" });
                }
                let content = String::from_utf8_lossy(&bytes).into_owned();
                let content_type = if path.split('`').next().is_some_and(|p| p.ends_with(".mu")) {
                    "micron"
                } else {
                    "text"
                };
                serde_json::json!({
                    "ok": true,
                    "content": content,
                    "content_type": content_type,
                })
            }
            Err(e) => serde_json::json!({
                "ok": false,
                "error": e,
            }),
        }
    }

    async fn query_control_timed(
        &self,
        query: TransportQuery,
    ) -> Option<TransportQueryResponse> {
        match tokio::time::timeout(
            TRANSPORT_QUERY_TIMEOUT,
            self.handle.query_control(query),
        )
        .await
        {
            Ok(resp) => resp,
            Err(_) => {
                tracing::debug!(
                    "transport control query timed out after {:?}",
                    TRANSPORT_QUERY_TIMEOUT
                );
                None
            }
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
            .find(|e| hex::encode(e.hash).to_lowercase() == key)
            .map(|e| e.hops)
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
                let hops = Some(evt.hops);
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
                        "hops": evt.hops,
                    })
                };
                let frame = serde_json::json!({ "type": "nomadnetwork.node", "payload": payload });
                let _ = event_tx.send(frame.to_string());
            }
        });
    }

    fn spawn_maintenance(&self, _event_tx: broadcast::Sender<String>) {
        let handle = self.handle.clone();
        let router = self.router.clone();
        let peer_via_cache = self.peer_via_cache.clone();
        let outbound = self.outbound.clone();
        let event_tx = self.event_tx.clone();
        let propagation = self.propagation.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(2));
            let mut known_path_hashes: HashSet<String> = HashSet::new();
            loop {
                interval.tick().await;
                // Only replace the outbound path table on a successful GetPathTable.
                // Timeout/empty fallback must NOT wipe known routes (that forced every
                // LXMF send onto the propagation node with hasPath:false).
                let path_entries = match tokio::time::timeout(
                    TRANSPORT_QUERY_TIMEOUT,
                    handle.query_control(TransportQuery::GetPathTable),
                )
                .await
                {
                    Ok(Some(TransportQueryResponse::PathTable(entries))) => {
                        if let Ok(mut cache) = peer_via_cache.lock() {
                            cache.clear();
                            for entry in &entries {
                                let key = hex::encode(entry.hash);
                                cache.insert(key, entry.interface.clone());
                            }
                        }
                        let next_hashes: HashSet<String> = entries
                            .iter()
                            .map(|e| hex::encode(e.hash))
                            .collect();
                        let added = path_table_added_hashes_capped(&known_path_hashes, &next_hashes);
                        if !added.is_empty() {
                            let frame = serde_json::json!({
                                "type": "peers_updated",
                                "payload": {
                                    "added": added,
                                    "count": next_hashes.len(),
                                }
                            });
                            let _ = event_tx.send(frame.to_string());
                        }
                        known_path_hashes = next_hashes;
                        Some(
                            entries
                                .iter()
                                .map(|e| (e.hash, e.hops, hex::encode(e.hash)))
                                .collect::<Vec<_>>(),
                        )
                    }
                    _ => {
                        tracing::debug!(
                            "maintenance path table query timed out after {:?}; keeping prior routes",
                            TRANSPORT_QUERY_TIMEOUT
                        );
                        None
                    }
                };
                let mut router = router.lock().await;
                if let Ok(mut driver) = outbound.lock() {
                    if let Some(ref entries) = path_entries {
                        driver.update_path_table(entries);
                    }
                    driver.process_tick(&mut router, &event_tx);
                    let known_identities = driver.known_identities_for_propagation();
                    propagation.tick(&known_identities);
                } else {
                    propagation.tick(&HashMap::new());
                }
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
                tracing::warn!("LXMF identity announce handler registration failed: transport closed");
                return;
            }

            while let Some(evt) = callback_rx.recv().await {
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
                        cache.insert(dest_hex.clone(), name.clone());
                    }
                }
                // Always notify the UI so nameless announces still refresh Peers promptly.
                let frame = serde_json::json!({
                    "type": "announce.received",
                    "payload": {
                        "destination_hash": dest_hex,
                        "display_name": display_name,
                        "hops": evt.hops,
                    }
                });
                let _ = event_tx.send(frame.to_string());
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
        let Some(TransportQueryResponse::PathTable(entries)) = self
            .query_control_timed(TransportQuery::GetPathTable)
            .await
        else {
            return false;
        };
        if let Ok(mut cache) = self.peer_via_cache.lock() {
            cache.clear();
            for entry in &entries {
                cache.insert(hex::encode(entry.hash), entry.interface.clone());
            }
        }
        let path_entries = entries
            .iter()
            .map(|e| (e.hash, e.hops, hex::encode(e.hash)))
            .collect::<Vec<_>>();
        if let Ok(mut driver) = self.outbound.lock() {
            driver.update_path_table(&path_entries);
        }
        true
    }

    /// Discover a path to the destination before falling back to the propagation node.
    async fn ensure_path_for_direct(&self, destination_hex: &str) -> bool {
        let already = self
            .outbound
            .lock()
            .map(|d| d.has_path_to(destination_hex))
            .unwrap_or(false);
        if already {
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
        let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
        while tokio::time::Instant::now() < deadline {
            let _ = self.refresh_outbound_path_table().await;
            if self
                .outbound
                .lock()
                .map(|d| d.has_path_to(destination_hex))
                .unwrap_or(false)
            {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        false
    }

    /// Ensure destination public key is known before choosing Direct delivery.
    async fn ensure_identity_for_direct(&self, destination_hex: &str) -> bool {
        if self.hydrate_identity_from_recent_announces(destination_hex).await {
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
            let _ = self.hydrate_identity_from_recent_announces(destination_hex).await;
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
    fn prepare_signed_outbound_lxmf(
        &self,
        dest: [u8; 16],
        title: &str,
        content: &str,
        method: DeliveryMethod,
    ) -> Result<(LxMessage, String), String> {
        let mut msg = LxMessage::new(
            dest,
            parse_hash16(&self.lxmf_hash_hex)?,
            title,
            content,
            method,
        );
        let signing_key = self.identity.get_signing_key().ok_or_else(|| {
            "lxmf sign: identity has no signing key".to_string()
        })?;
        msg.sign(&signing_key)
            .map_err(|e| format!("lxmf sign: {e:?}"))?;
        let hash_hex = msg
            .hash
            .map(hex::encode)
            .ok_or_else(|| "lxmf hash missing after sign".to_string())?;
        Ok((msg, hash_hex))
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

        let (msg, message_hash_hex) = self.prepare_signed_outbound_lxmf(
            dest,
            "",
            &req.emoji,
            delivery_method,
        )?;
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
            "reaction_target": req.target_hash,
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
    }

    pub fn propagation_local_stats(&self) -> (usize, usize) {
        self.propagation.local_stats()
    }

    pub fn propagation_local_hash(&self) -> String {
        self.propagation.local_dest_hash_hex()
    }

    pub async fn start_propagation_sync(&self, destination_hash: &str) -> Result<(), String> {
        let hash = parse_hash16(destination_hash)?;
        self.sync_cancel.store(false, std::sync::atomic::Ordering::SeqCst);
        if !self.propagation.start_sync(hash) {
            return Err("propagation sync unavailable".into());
        }
        self.propagation.spawn_sync_progress_emitter(
            self.event_tx.clone(),
            Arc::clone(&self.sync_cancel),
        );
        Ok(())
    }

    pub fn propagation_is_local_serving(&self) -> bool {
        self.propagation.is_local_serving()
    }

    pub async fn cancel_propagation_sync(&self) {
        self.sync_cancel
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.propagation.cancel_sync();
    }

    pub async fn set_outbound_propagation_node(&self, destination_hash: Option<&str>) {
        let hash = destination_hash.and_then(lxmf_outbound::parse_propagation_hash);
        let mut router = self.router.lock().await;
        if let Ok(mut driver) = self.outbound.lock() {
            driver.set_propagation_node(&mut router, hash);
        }
    }

    pub async fn fetch_interfaces(&self) -> Result<Vec<InterfaceRow>, String> {
        let config_rows = super::config::interfaces_from_config_dir(&self.config_dir).unwrap_or_default();
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
            .map(|(i, s)| InterfaceRow {
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
                seed_addresses: Vec::new(),
                discoverable: None,
                latitude: None,
                longitude: None,
                height: None,
                discovery_name: None,
                announce_interval_min: None,
                connectable: None,
                reachable_on: None,
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

    pub async fn fetch_peers(&self) -> Result<Vec<PeerRow>, String> {
        let resp = self
            .query_control_timed(TransportQuery::GetPathTable)
            .await;
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
        Ok(entries
            .iter()
            .map(|e| PeerRow {
                destination_hash: hex::encode(e.hash),
                display_name: None,
                hops: Some(e.hops),
                last_seen: Some(e.timestamp as u64),
                interface: Some(e.interface.clone()),
                path_hash: e.via.map(hex::encode),
                via_hash: e.via.map(hex::encode),
            })
            .collect())
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
            router
                .outbound_propagation_node
                .map(hex::encode)
        };
        let preferred_pn_set = preferred_pn_hash.is_some();

        // Prefer Direct when a path can be discovered — do not immediately park on
        // the preferred PN just because the local path table was empty at click time.
        if !has_path {
            has_path = self.ensure_path_for_direct(&req.destination_hash).await;
        }
        // Path alone is not enough for Direct (LRPROOF needs pubkey). Learn it from
        // recent announces / path responses before deciding Propagated.
        if has_path && !identity_known {
            identity_known = self.ensure_identity_for_direct(&req.destination_hash).await;
        }

        let delivery_method = match lxmf_outbound::choose_lxmf_send_route(
            has_path,
            identity_known,
            preferred_pn_set,
        ) {
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

        let (msg, message_hash_hex) = self.prepare_signed_outbound_lxmf(
            dest,
            "",
            &req.text,
            delivery_method,
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
        let payload = serde_json::json!({
            "sender_hash": self.lxmf_hash_hex,
            "sender_name": self.display_name,
            "text": req.text,
            "timestamp": ts_ms,
            "to_hash": req.destination_hash,
            "reply_to_hash": req.reply_to_hash,
            "reply_to_id": req.reply_to_id,
            "direction": "outbound",
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "received_via": egress_via,
            "delivery_status": "sending",
            "message_hash": message_hash_hex.clone(),
        });

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
            "text": req.text,
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "delivery_status": "queued",
            "message": payload
        }))
    }

    pub async fn send_lxmf_resource(
        &self,
        req: &LxmfResourceRequest,
    ) -> Result<serde_json::Value, String> {
        use base64::Engine as _;

        let file_bytes = base64::engine::general_purpose::STANDARD
            .decode(req.data_base64.as_bytes())
            .map_err(|e| format!("invalid attachment base64: {e}"))?;
        if file_bytes.is_empty() {
            return Err("attachment data is empty".into());
        }
        if file_bytes.len() > 4 * 1024 * 1024 {
            return Err("attachment exceeds 4 MiB limit".into());
        }

        let dest = parse_hash16(&req.destination_hash)?;
        let has_path = self
            .outbound
            .lock()
            .map(|d| d.has_path_to(&req.destination_hash))
            .unwrap_or(false);

        let preferred_pn_hash = {
            let router = self.router.lock().await;
            router.outbound_propagation_node.map(hex::encode)
        };
        let delivery_method = if has_path {
            DeliveryMethod::Direct
        } else if preferred_pn_hash.is_some() {
            DeliveryMethod::Propagated
        } else {
            return Ok(serde_json::json!({
                "ok": false,
                "error": "no_propagation_node",
                "destination_hash": req.destination_hash,
            }));
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

        let text = format!("[file:{}:{}]", req.file_name, req.mime_type);
        let attachment_msgpack =
            build_file_attachment_msgpack(&req.file_name, &file_bytes)?;

        let mut msg = LxMessage::new(
            dest,
            parse_hash16(&self.lxmf_hash_hex)?,
            &req.file_name,
            &text,
            delivery_method,
        );
        msg.set_msgpack_field(FIELD_FILE_ATTACHMENTS, attachment_msgpack)
            .map_err(|e| format!("attachment field: {e:?}"))?;
        let signing_key = self.identity.get_signing_key().ok_or_else(|| {
            "lxmf attachment sign: identity has no signing key".to_string()
        })?;
        msg.sign(&signing_key)
            .map_err(|e| format!("lxmf attachment sign: {e:?}"))?;
        let message_hash_hex = msg
            .hash
            .map(hex::encode)
            .ok_or_else(|| "lxmf hash missing after attachment sign".to_string())?;

        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf resource send: {e:?}"))?;

        let ts_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000) as i64;
        let attachment_b64 = base64::engine::general_purpose::STANDARD.encode(&file_bytes);
        let payload = serde_json::json!({
            "sender_hash": self.lxmf_hash_hex,
            "sender_name": self.display_name,
            "text": text,
            "timestamp": ts_ms,
            "to_hash": req.destination_hash,
            "reply_to_hash": req.reply_to_hash,
            "direction": "outbound",
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "received_via": egress_via,
            "delivery_status": "sending",
            "message_hash": message_hash_hex.clone(),
            "attachment": {
                "file_name": req.file_name,
                "mime_type": req.mime_type,
                "size_bytes": file_bytes.len(),
                "data_base64": attachment_b64,
            }
        });

        if let Ok(mut driver) = self.outbound.lock() {
            driver.process_tick(&mut router, &self.event_tx);
        }

        self.schedule_egress_tap_upgrade(
            message_hash_hex,
            req.destination_hash.clone(),
            preferred_pn_hash,
            egress_via.clone(),
            ifaces,
            send_started_ms,
        );

        Ok(serde_json::json!({
            "ok": true,
            "destination_hash": req.destination_hash,
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "delivery_status": "sending",
            "message": payload
        }))
    }

    pub async fn apply_interfaces(&self, stack: &StackHandle) -> Result<(), String> {
        let interfaces = stack.list_interfaces().await;
        tracing::info!(
            count = interfaces.len(),
            "apply_interfaces: syncing {} interface(s) from config",
            interfaces.len()
        );
        self.sync_ble_peer_interfaces(&interfaces).await
    }

    #[cfg(feature = "rns-ble")]
    async fn sync_ble_peer_interfaces(&self, interfaces: &[InterfaceRow]) -> Result<(), String> {
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
        let foreground_wake = {
            self.ble_peer_state
                .lock()
                .await
                .foreground_wake
                .clone()
        };
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

    fn emit_event(&self, event_type: &str, payload: serde_json::Value) {
        let msg = serde_json::json!({ "type": event_type, "payload": payload });
        let _ = self.event_tx.send(msg.to_string());
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
        "message_hash": message_hash
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
    if let Some(icon) = icon_appearance_json_from_message(msg) {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("icon_appearance".into(), icon);
        }
    }
    payload
}

fn build_file_attachment_msgpack(file_name: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    let attachment_value = rmpv::Value::Array(vec![rmpv::Value::Array(vec![
        rmpv::Value::String(file_name.into()),
        rmpv::Value::Binary(data.to_vec()),
    ])]);
    let mut attachment_bytes = Vec::new();
    rmpv::encode::write_value(&mut attachment_bytes, &attachment_value)
        .map_err(|e| format!("encode attachment msgpack: {e}"))?;
    Ok(attachment_bytes)
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

pub(super) fn emit_lxmf_event(event_tx: &broadcast::Sender<String>, payload: serde_json::Value) {
    let frame = serde_json::json!({
        "type": "lxmf_message",
        "payload": payload
    });
    let _ = event_tx.send(frame.to_string());
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
    s.chars()
        .all(|c| !c.is_control() || c == ' ' || c == '\t')
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

fn resolve_inbound_sender_name(contacts: &[ContactRow], sender_hash: &str) -> String {
    resolve_inbound_sender_name_map(&contacts_to_name_map(contacts), sender_hash)
}

fn resolve_inbound_sender_name_map(
    names: &HashMap<String, String>,
    sender_hash: &str,
) -> String {
    let prefix = sender_hash.get(..12).unwrap_or(sender_hash);
    names
        .get(sender_hash)
        .map(|name| name.trim())
        .filter(|name| !name.is_empty() && *name != prefix)
        .map(str::to_string)
        .unwrap_or_else(|| prefix.to_string())
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

/// Cap membership growth event payloads under path-table floods.
const MAX_PEERS_UPDATED_ADDED: usize = 256;
/// Cap Nomad page body before UTF-8 conversion (DoS bound).
const NOMAD_PAGE_MAX_BYTES: usize = 512 * 1024;
/// Cap Nomad file body before base64 (aligned with Axum 4 MiB body limit).
const NOMAD_FILE_MAX_BYTES: usize = 4 * 1024 * 1024;
const NOMAD_LINK_LOCK_WAIT: Duration = Duration::from_secs(2);

fn path_table_added_hashes_capped(prev: &HashSet<String>, next: &HashSet<String>) -> Vec<String> {
    let mut added = path_table_added_hashes(prev, next);
    if added.len() > MAX_PEERS_UPDATED_ADDED {
        added.sort();
        added.truncate(MAX_PEERS_UPDATED_ADDED);
    }
    added
}

#[cfg(test)]
mod announce_display_name_tests {
    use super::*;

    #[test]
    fn path_table_added_hashes_reports_only_new_membership() {
        let prev: HashSet<String> = ["aa".into(), "bb".into()].into_iter().collect();
        let next: HashSet<String> = ["bb".into(), "cc".into()].into_iter().collect();
        let mut added = path_table_added_hashes(&prev, &next);
        added.sort();
        assert_eq!(added, vec!["cc".to_string()]);
    }

    #[test]
    fn path_table_added_hashes_empty_when_membership_unchanged() {
        let prev: HashSet<String> = ["aa".into()].into_iter().collect();
        let next: HashSet<String> = ["aa".into()].into_iter().collect();
        assert!(path_table_added_hashes(&prev, &next).is_empty());
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
        assert_eq!(
            parse_announce_display_name(Some(br#"{"foo":"bar"}"#)),
            None
        );
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
        assert_eq!(resolve_inbound_sender_name(&contacts, &hash), "deadbeefdead");
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
            .map(|i| format!("{:032x}", i))
            .collect();
        let added = path_table_added_hashes_capped(&prev, &next);
        assert_eq!(added.len(), MAX_PEERS_UPDATED_ADDED);
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

        let mut msg = LxMessage::new(
            [0u8; 16],
            [1u8; 16],
            "",
            "hello",
            DeliveryMethod::Direct,
        );
        msg.set_field(FIELD_ICON_APPEARANCE, buf);
        let json = icon_appearance_json_from_message(&msg).expect("icon json");
        assert_eq!(json["icon_name"], "hiking");
        assert_eq!(json["foreground_rgb"], serde_json::json!([255, 255, 0]));
        assert_eq!(json["background_rgb"], serde_json::json!([0, 0, 255]));
    }
}
