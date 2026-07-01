//! Live rsReticulum bridge (optional runtime queries + LXMF send/receive).

#[path = "lxmf_outbound.rs"]
mod lxmf_outbound;

use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use lxmf_core::constants::{DeliveryMethod, FIELD_FILE_ATTACHMENTS};
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
use super::nomad_file::nomad_file_name_from_path;
use super::nomad_timeouts;
use super::persistence::PersistedState;
use super::propagation_bridge::PropagationBridge;
use super::packet_log::{emit_wire_packet_event, wire_packet_from_tap, PacketLogBuffer};
use super::types::{InterfaceRow, LxmfResourceRequest, LxmfSendRequest, PeerRow};
use super::via::{
    classify_interface, merge_live_interfaces_with_config, resolve_outbound_sent_via,
    resolve_peer_sent_via,
};
use lxmf_outbound::LxmfOutboundDriver;

/// Cap blocking transport control queries so HTTP handlers return cached state
/// before the Electron IPC proxy GET timeout (10s default).
const TRANSPORT_QUERY_TIMEOUT: Duration = Duration::from_secs(8);

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
    outbound: Arc<Mutex<LxmfOutboundDriver>>,
    propagation: Arc<PropagationBridge>,
    sync_cancel: Arc<std::sync::atomic::AtomicBool>,
    event_tx: broadcast::Sender<String>,
}

impl LiveBridge {
    pub async fn spawn(
        config_dir: PathBuf,
        storage_dir: PathBuf,
        event_tx: broadcast::Sender<String>,
        packet_log: Arc<PacketLogBuffer>,
        persisted: &mut PersistedState,
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

        let identity_path = config_dir.join("identity");
        let identity = if identity_path.exists() {
            Identity::from_file(&identity_path).map_err(|e| format!("load identity: {e}"))?
        } else if persisted.identity.configured {
            Identity::new()
        } else {
            return Err("identity not configured for live stack".into());
        };

        if !identity_path.exists() {
            identity
                .to_file(&identity_path)
                .map_err(|e| format!("save identity: {e}"))?;
        }

        const LXMF_APP: &str = "lxmf.delivery";
        let lxmf_dest_hash =
            Destination::hash_from_name_and_identity(LXMF_APP, Some(&identity.hash));
        let lxmf_hash_hex = hex::encode(lxmf_dest_hash);
        let display_name = persisted
            .identity
            .display_name
            .clone()
            .unwrap_or_else(|| "Self".into());

        let peer_via_cache: Arc<Mutex<HashMap<String, String>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let mut router = LxmRouter::new(lxmf_core::router::RouterConfig::default());
        router.set_transport(handle.transport_tx.clone());

        let cache_for_cb = peer_via_cache.clone();
        let event_tx_cb = event_tx.clone();
        let self_hash_cb = lxmf_hash_hex.clone();
        let self_name_cb = display_name.clone();
        router.register_delivery_callback(move |msg| {
            if !msg.incoming {
                return;
            }
            let sender_hex = hex::encode(msg.source_hash);
            let received_via = cache_for_cb
                .lock()
                .ok()
                .and_then(|cache| cache.get(&sender_hex).cloned())
                .map(|iface| classify_interface(&iface).to_string())
                .unwrap_or_else(|| "network".into());
            let payload = lxmf_payload_from_message(
                msg,
                &self_hash_cb,
                &self_name_cb,
                Some(&received_via),
                None,
                "inbound",
            );
            emit_lxmf_event(&event_tx_cb, payload);
        });

        let bridge = Self {
            config_dir,
            storage_dir: storage_dir.clone(),
            handle: handle.clone(),
            _shutdown: shutdown,
            router: Arc::new(tokio::sync::Mutex::new(router)),
            identity: identity.clone(),
            lxmf_hash_hex: lxmf_hash_hex.clone(),
            display_name: display_name.clone(),
            peer_via_cache,
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
        };

        let preferred_prop_hash = persisted
            .preferred_propagation_id
            .as_ref()
            .and_then(|id| {
                persisted
                    .propagation
                    .iter()
                    .find(|p| p.id == *id)
                    .and_then(|p| p.destination_hash.clone())
            });

        bridge.spawn_maintenance(event_tx);

        if let Some(hash_hex) = preferred_prop_hash {
            bridge.set_outbound_propagation_node(Some(&hash_hex)).await;
        }

        persisted.rns_ready = true;
        persisted.lxmf_ready = true;

        Ok(bridge)
    }

    pub async fn fetch_nomad_file(
        &self,
        hash_hex: &str,
        path: &str,
        interfaces: &[InterfaceRow],
    ) -> serde_json::Value {
        let dest = match parse_hash16(hash_hex) {
            Ok(h) => h,
            Err(e) => {
                return serde_json::json!({ "ok": false, "error": e });
            }
        };
        let hops = self.hops_to_destination(hash_hex).await.unwrap_or(8);
        let timeout_secs = nomad_timeouts::nomad_page_timeout_secs_for_interfaces(interfaces, hops);
        let client = LinkClient::new(self.handle.transport_tx.clone(), self.identity.clone());
        match client
            .query_destination(
                dest,
                path,
                Vec::new(),
                hops,
                Duration::from_secs(timeout_secs),
            )
            .await
        {
            Ok(bytes) => {
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
            Err(e) => serde_json::json!({ "ok": false, "error": format!("{e}") }),
        }
    }

    pub async fn fetch_nomad_page(
        &self,
        hash_hex: &str,
        path: &str,
        interfaces: &[InterfaceRow],
    ) -> serde_json::Value {
        let dest = match parse_hash16(hash_hex) {
            Ok(h) => h,
            Err(e) => {
                return serde_json::json!({ "ok": false, "error": e });
            }
        };
        let hops = self.hops_to_destination(hash_hex).await.unwrap_or(8);
        let timeout_secs = nomad_timeouts::nomad_page_timeout_secs_for_interfaces(interfaces, hops);
        let client = LinkClient::new(self.handle.transport_tx.clone(), self.identity.clone());
        match client
            .query_destination(
                dest,
                path,
                Vec::new(),
                hops,
                Duration::from_secs(timeout_secs),
            )
            .await
        {
            Ok(bytes) => {
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
            Err(e) => serde_json::json!({ "ok": false, "error": format!("{e}") }),
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
        const NOMAD_NODE_ASPECT: &str = "nomadnetwork.node";
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
                let display_name = parse_nomad_display_name(evt.app_data.as_deref());
                let hops = Some(evt.hops);
                let payload = {
                    let mut state = inner.write().await;
                    state.upsert_nomad_node(&hash_hex, display_name.clone(), hops);
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
            loop {
                interval.tick().await;
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
                        entries
                            .iter()
                            .map(|e| (e.hash, e.hops, hex::encode(e.hash)))
                            .collect::<Vec<_>>()
                    }
                    _ => {
                        tracing::debug!(
                            "maintenance path table query timed out after {:?}",
                            TRANSPORT_QUERY_TIMEOUT
                        );
                        Vec::new()
                    }
                };
                let mut router = router.lock().await;
                if let Ok(mut driver) = outbound.lock() {
                    driver.update_path_table(&path_entries);
                    driver.process_tick(&mut router, &event_tx);
                }
                propagation.tick(&HashMap::new());
            }
        });
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
            })
            .collect();
        Ok(merge_live_interfaces_with_config(&config_rows, live_rows))
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
        let delivery_method_str = match delivery_method {
            DeliveryMethod::Direct => "direct",
            DeliveryMethod::Propagated => "propagated",
            DeliveryMethod::Opportunistic => "opportunistic",
            DeliveryMethod::Paper => "paper",
        };

        let egress_via = match self.fetch_interfaces().await {
            Ok(ifaces) if !ifaces.is_empty() => resolve_outbound_sent_via(&ifaces),
            _ => {
                let peer_iface = self
                    .peer_via_cache
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(&req.destination_hash).cloned());
                resolve_peer_sent_via(peer_iface.as_deref())
            }
        };

        let msg = LxMessage::new(
            dest,
            parse_hash16(&self.lxmf_hash_hex)?,
            "",
            &req.text,
            delivery_method,
        );
        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf send: {e:?}"))?;

        let ts_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            * 1000) as i64;
        let mut payload = serde_json::json!({
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
            "delivery_status": "queued"
        });
        let hash_input = format!(
            "{}:{}:{}",
            payload["sender_hash"].as_str().unwrap_or_default(),
            payload["timestamp"].as_i64().unwrap_or(0),
            payload["text"].as_str().unwrap_or_default()
        );
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "message_hash".into(),
                serde_json::Value::String(format!("{:032x}", super::persistence::stable_hash(
                    &hash_input
                ))),
            );
        }

        if let Ok(mut driver) = self.outbound.lock() {
            driver.process_tick(&mut router, &self.event_tx);
        }

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
        if file_bytes.len() > 16 * 1024 * 1024 {
            return Err("attachment exceeds 16 MiB limit".into());
        }

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
        let delivery_method_str = match delivery_method {
            DeliveryMethod::Direct => "direct",
            DeliveryMethod::Propagated => "propagated",
            DeliveryMethod::Opportunistic => "opportunistic",
            DeliveryMethod::Paper => "paper",
        };

        let egress_via = match self.fetch_interfaces().await {
            Ok(ifaces) if !ifaces.is_empty() => resolve_outbound_sent_via(&ifaces),
            _ => {
                let peer_iface = self
                    .peer_via_cache
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(&req.destination_hash).cloned());
                resolve_peer_sent_via(peer_iface.as_deref())
            }
        };

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
        let mut payload = serde_json::json!({
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
            "delivery_status": "queued",
            "attachment": {
                "file_name": req.file_name,
                "mime_type": req.mime_type,
                "size_bytes": file_bytes.len(),
                "data_base64": attachment_b64,
            }
        });
        let hash_input = format!(
            "{}:{}:{}",
            payload["sender_hash"].as_str().unwrap_or_default(),
            payload["timestamp"].as_i64().unwrap_or(0),
            payload["text"].as_str().unwrap_or_default()
        );
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "message_hash".into(),
                serde_json::Value::String(format!(
                    "{:032x}",
                    super::persistence::stable_hash(&hash_input)
                )),
            );
        }

        if let Ok(mut driver) = self.outbound.lock() {
            driver.process_tick(&mut router, &self.event_tx);
        }

        Ok(serde_json::json!({
            "ok": true,
            "destination_hash": req.destination_hash,
            "delivery_method": delivery_method_str,
            "sent_via": egress_via,
            "delivery_status": "queued",
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
        for iface in &interfaces {
            tracing::debug!(
                id = %iface.id,
                name = %iface.name,
                iface_type = %iface.iface_type,
                enabled = iface.enabled,
                "interface config entry"
            );
        }

        let config_path = stack.config_dir.join("config");
        match std::fs::read_to_string(&config_path) {
            Ok(content) => {
                tracing::info!(
                    path = %config_path.display(),
                    bytes = content.len(),
                    "apply_interfaces: config reload read OK (live rns-stack hot-reload not yet wired)"
                );
            }
            Err(e) => {
                tracing::warn!(
                    path = %config_path.display(),
                    error = %e,
                    "apply_interfaces: config reload read failed"
                );
            }
        }

        Ok(())
    }
}

pub(super) fn lxmf_payload_from_message(
    msg: &LxMessage,
    self_lxmf_hash: &str,
    self_name: &str,
    received_via: Option<&str>,
    sent_via: Option<&str>,
    direction: &str,
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
        self_name
    } else {
        sender_hex.get(..12).unwrap_or(&sender_hex)
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

/// Nomad Network encodes node display names in announce app_data as msgpack
/// `[display_name_bytes, ...]` (see NomadNet / MeshChat wire compat).
fn parse_nomad_display_name(app_data: Option<&[u8]>) -> Option<String> {
    let bytes = app_data?;
    if bytes.is_empty() {
        return None;
    }
    if let Ok(value) = rmpv::decode::read_value(&mut Cursor::new(bytes)) {
        if let rmpv::Value::Array(arr) = value {
            if let Some(name) = arr.first().and_then(nomad_name_from_msgpack_value) {
                return Some(name);
            }
        }
    }
    std::str::from_utf8(bytes)
        .ok()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
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

pub(super) fn parse_hash16(hex_str: &str) -> Result<[u8; 16], String> {
    let clean: String = hex_str.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let bytes = hex::decode(if clean.len() >= 32 {
        &clean[..32]
    } else {
        return Err("hash too short".into());
    })
    .map_err(|e| e.to_string())?;
    let mut out = [0u8; 16];
    out.copy_from_slice(&bytes[..16]);
    Ok(out)
}
