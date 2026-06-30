//! Live rsReticulum bridge (optional runtime queries + LXMF send/receive).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use lxmf_core::constants::DeliveryMethod;
use lxmf_core::message::LxMessage;
use lxmf_core::router::LxmRouter;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_runtime::lifecycle::ShutdownSignal;
use rns_runtime::reticulum;
use rns_transport::messages::{TransportMessage, TransportQuery, TransportQueryResponse};
use tokio::sync::broadcast;

use super::StackHandle;
use super::persistence::PersistedState;
use super::types::{InterfaceRow, LxmfSendRequest, PeerRow};
use super::via::{
    classify_interface, merge_live_interfaces_with_config, resolve_outbound_sent_via,
    resolve_peer_sent_via,
};

pub struct LiveBridge {
    config_dir: PathBuf,
    handle: reticulum::ReticulumHandle,
    _shutdown: ShutdownSignal,
    router: Arc<tokio::sync::Mutex<LxmRouter>>,
    identity: Identity,
    lxmf_hash_hex: String,
    display_name: String,
    peer_via_cache: Arc<Mutex<HashMap<String, String>>>,
}

impl LiveBridge {
    pub async fn spawn(
        config_dir: PathBuf,
        _storage_dir: PathBuf,
        event_tx: broadcast::Sender<String>,
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
            handle: handle.clone(),
            _shutdown: shutdown,
            router: Arc::new(tokio::sync::Mutex::new(router)),
            identity,
            lxmf_hash_hex,
            display_name,
            peer_via_cache,
        };

        bridge.spawn_maintenance(event_tx);

        persisted.rns_ready = true;
        persisted.lxmf_ready = true;

        Ok(bridge)
    }

    fn spawn_maintenance(&self, _event_tx: broadcast::Sender<String>) {
        let handle = self.handle.clone();
        let router = self.router.clone();
        let peer_via_cache = self.peer_via_cache.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(2));
            loop {
                interval.tick().await;
                if let Some(TransportQueryResponse::PathTable(entries)) = handle
                    .query_control(TransportQuery::GetPathTable)
                    .await
                {
                    if let Ok(mut cache) = peer_via_cache.lock() {
                        cache.clear();
                        for entry in entries {
                            let key = hex::encode(entry.hash);
                            cache.insert(key, entry.interface);
                        }
                    }
                }
                let mut router = router.lock().await;
                router.tick();
            }
        });
    }

    pub async fn fetch_interfaces(&self) -> Result<Vec<InterfaceRow>, String> {
        let config_rows = super::config::interfaces_from_config_dir(&self.config_dir).unwrap_or_default();
        let resp = self
            .handle
            .query_control(TransportQuery::GetInterfaceStats)
            .await;
        let Some(TransportQueryResponse::InterfaceStats(stats)) = resp else {
            return Ok(vec![]);
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
            .handle
            .query_control(TransportQuery::GetPathTable)
            .await;
        let Some(TransportQueryResponse::PathTable(entries)) = resp else {
            return Err("path table query unavailable".into());
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
                path_hash: Some(hex::encode(e.hash)),
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
        let sent_via = match self.fetch_interfaces().await {
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
            DeliveryMethod::Direct,
        );
        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf send: {e:?}"))?;
        router.tick();

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
            "sent_via": sent_via,
            "received_via": sent_via
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

        Ok(serde_json::json!({
            "ok": true,
            "destination_hash": req.destination_hash,
            "text": req.text,
            "sent_via": sent_via,
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

fn lxmf_payload_from_message(
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
    payload
}

fn emit_lxmf_event(event_tx: &broadcast::Sender<String>, payload: serde_json::Value) {
    let frame = serde_json::json!({
        "type": "lxmf_message",
        "payload": payload
    });
    let _ = event_tx.send(frame.to_string());
}

fn parse_hash16(hex_str: &str) -> Result<[u8; 16], String> {
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
