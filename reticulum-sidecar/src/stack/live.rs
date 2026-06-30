//! Live rsReticulum bridge (optional runtime queries + LXMF send).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

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

pub struct LiveBridge {
    handle: reticulum::ReticulumHandle,
    _shutdown: ShutdownSignal,
    router: tokio::sync::Mutex<LxmRouter>,
    identity: Identity,
    lxmf_dest_hash: [u8; 16],
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

        let mut router = LxmRouter::new(lxmf_core::router::RouterConfig::default());
        router.set_transport(handle.transport_tx.clone());

        persisted.rns_ready = true;
        persisted.lxmf_ready = true;

        let bridge = Self {
            handle,
            _shutdown: shutdown,
            router: tokio::sync::Mutex::new(router),
            identity,
            lxmf_dest_hash,
        };

        let _ = event_tx;
        Ok(bridge)
    }

    pub async fn fetch_interfaces(&self) -> Result<Vec<InterfaceRow>, String> {
        let resp = self
            .handle
            .query_control(TransportQuery::GetInterfaceStats)
            .await;
        let Some(TransportQueryResponse::InterfaceStats(stats)) = resp else {
            return Ok(vec![]);
        };
        Ok(stats
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
            .collect())
    }

    pub async fn fetch_peers(&self) -> Result<Vec<PeerRow>, String> {
        let resp = self
            .handle
            .query_control(TransportQuery::GetPathTable)
            .await;
        let Some(TransportQueryResponse::PathTable(entries)) = resp else {
            return Ok(vec![]);
        };
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
        let msg = LxMessage::new(
            dest,
            self.lxmf_dest_hash,
            "",
            &req.text,
            DeliveryMethod::Direct,
        );
        let mut router = self.router.lock().await;
        router
            .try_send(msg)
            .map_err(|e| format!("lxmf send: {e:?}"))?;
        router.tick();
        Ok(serde_json::json!({
            "ok": true,
            "destination_hash": req.destination_hash,
            "text": req.text
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
