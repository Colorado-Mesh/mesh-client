//! Real btleplug central for Meshtastic / MeshCore GATT sessions.

use std::collections::HashMap;
use std::time::Duration;

use btleplug::api::{
    Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager as BtleManager, Peripheral};
use futures_util::StreamExt;
use tokio::sync::{Mutex, mpsc};
use uuid::Uuid;

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::error::{GattError, GattErrorCode};
use super::profile::{self, GattProfile, normalize_address};

fn connect_timeout() -> Duration {
    if cfg!(target_os = "macos") {
        Duration::from_secs(15)
    } else {
        Duration::from_secs(30)
    }
}

fn discovery_timeout() -> Duration {
    if cfg!(target_os = "macos") {
        Duration::from_secs(15)
    } else {
        Duration::from_secs(30)
    }
}

struct OpenConn {
    peripheral: Peripheral,
    write_char: Characteristic,
    from_radio_char: Option<Characteristic>,
    /// True when NUS TX notify is active (MeshCore) — forbids GATT read on TX.
    nus_notify_only: bool,
}

pub struct BtleplugBackend {
    adapter: Adapter,
    open: Mutex<HashMap<String, OpenConn>>,
}

impl BtleplugBackend {
    pub async fn try_new() -> Result<Self, GattError> {
        let manager = BtleManager::new().await.map_err(|e| {
            GattError::new(
                GattErrorCode::AdapterMissing,
                format!("btleplug manager: {e}"),
            )
        })?;
        let adapters = manager.adapters().await.map_err(|e| {
            GattError::new(GattErrorCode::AdapterMissing, format!("list adapters: {e}"))
        })?;
        let adapter = adapters
            .into_iter()
            .next()
            .ok_or_else(|| GattError::new(GattErrorCode::AdapterMissing, "no bluetooth adapter"))?;
        Ok(Self {
            adapter,
            open: Mutex::new(HashMap::new()),
        })
    }

    fn service_uuid(profile: GattProfile) -> Option<Uuid> {
        match profile {
            GattProfile::Meshtastic => Some(profile::meshtastic::service()),
            GattProfile::Meshcore | GattProfile::Rnode => Some(profile::nus::service()),
            GattProfile::Peer => None,
        }
    }

    async fn find_peripheral(&self, address: &str) -> Result<Peripheral, GattError> {
        let key = normalize_address(address)?;
        let peris =
            self.adapter.peripherals().await.map_err(|e| {
                GattError::new(GattErrorCode::Internal, format!("peripherals: {e}"))
            })?;
        for p in peris {
            let props = p.properties().await.ok().flatten();
            let addr = props
                .as_ref()
                .map(|x| x.address.to_string().to_ascii_lowercase())
                .unwrap_or_default();
            let id = format!("{:?}", p.id()).to_ascii_lowercase();
            if addr == key || id.contains(&key) || (!addr.is_empty() && key.contains(&addr)) {
                return Ok(p);
            }
        }
        Err(GattError::new(
            GattErrorCode::ConnectTimeout,
            format!("peripheral {key} not found — scan first"),
        ))
    }
}

impl BleBackend for BtleplugBackend {
    #[allow(clippy::unused_async_trait_impl)] // trait requires async; adapter already probed in try_new
    async fn adapter_available(&self) -> Result<(), GattError> {
        Ok(())
    }

    async fn scan(
        &self,
        profile: GattProfile,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        let filter = match Self::service_uuid(profile) {
            Some(u) => ScanFilter { services: vec![u] },
            None => ScanFilter::default(),
        };
        self.adapter
            .start_scan(filter)
            .await
            .map_err(|e| GattError::new(GattErrorCode::Internal, format!("start_scan: {e}")))?;
        tokio::time::sleep(Duration::from_secs(timeout_secs.max(1))).await;
        let _ = self.adapter.stop_scan().await;
        let peris =
            self.adapter.peripherals().await.map_err(|e| {
                GattError::new(GattErrorCode::Internal, format!("peripherals: {e}"))
            })?;
        let mut out = Vec::new();
        for p in peris {
            let Some(props) = p.properties().await.ok().flatten() else {
                continue;
            };
            out.push(ScannedDevice {
                address: props.address.to_string(),
                name: props.local_name,
                rssi: props.rssi,
                service_uuids: props
                    .services
                    .iter()
                    .map(std::string::ToString::to_string)
                    .collect(),
            });
        }
        Ok(out)
    }

    async fn connect(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> Result<
        (
            BackendConnId,
            mpsc::UnboundedReceiver<BackendEvent>,
            Option<u16>,
        ),
        GattError,
    > {
        let key = normalize_address(address)?;
        let peripheral = self.find_peripheral(&key).await?;

        tokio::time::timeout(connect_timeout(), peripheral.connect())
            .await
            .map_err(|_| GattError::new(GattErrorCode::ConnectTimeout, "connect timed out"))?
            .map_err(|e| {
                let msg = e.to_string();
                let code = if msg.to_ascii_lowercase().contains("pair") {
                    GattErrorCode::PairingRequired
                } else {
                    GattErrorCode::ConnectTimeout
                };
                GattError::new(code, msg)
            })?;

        tokio::time::timeout(discovery_timeout(), peripheral.discover_services())
            .await
            .map_err(|_| {
                GattError::new(
                    GattErrorCode::GattDiscoverFailed,
                    "service discovery timed out",
                )
            })?
            .map_err(|e| GattError::new(GattErrorCode::GattDiscoverFailed, e.to_string()))?;

        let chars = peripheral.characteristics();
        let (write_uuid, notify_uuid, from_radio_uuid, nus_notify_only) = match profile {
            GattProfile::Meshtastic => (
                profile::meshtastic::to_radio(),
                profile::meshtastic::from_num(),
                Some(profile::meshtastic::from_radio()),
                false,
            ),
            GattProfile::Meshcore | GattProfile::Rnode => {
                (profile::nus::rx(), profile::nus::tx(), None, true)
            }
            GattProfile::Peer => {
                return Err(GattError::new(
                    GattErrorCode::InvalidProfile,
                    "peer profile has no gatt pipe",
                ));
            }
        };

        let write_char = chars
            .iter()
            .find(|c| c.uuid == write_uuid)
            .cloned()
            .ok_or_else(|| {
                GattError::new(
                    GattErrorCode::GattDiscoverFailed,
                    "write characteristic missing",
                )
            })?;
        let notify_char = chars
            .iter()
            .find(|c| c.uuid == notify_uuid)
            .cloned()
            .ok_or_else(|| {
                GattError::new(
                    GattErrorCode::GattDiscoverFailed,
                    "notify characteristic missing",
                )
            })?;
        let from_radio_char =
            from_radio_uuid.and_then(|u| chars.iter().find(|c| c.uuid == u).cloned());

        peripheral.subscribe(&notify_char).await.map_err(|e| {
            GattError::new(GattErrorCode::GattDiscoverFailed, format!("subscribe: {e}"))
        })?;

        let (tx, rx) = mpsc::unbounded_channel();
        let mut notifications = peripheral
            .notifications()
            .await
            .map_err(|e| GattError::new(GattErrorCode::Internal, format!("notifications: {e}")))?;
        let tx_notify = tx.clone();
        let notify_uuid_copy = notify_uuid;
        tokio::spawn(async move {
            while let Some(n) = notifications.next().await {
                if n.uuid == notify_uuid_copy {
                    let _ = tx_notify.send(BackendEvent::Bytes(n.value));
                }
            }
            let _ = tx_notify.send(BackendEvent::Disconnected {
                reason: "notifications_ended".into(),
            });
        });

        {
            let mut open = self.open.lock().await;
            open.insert(
                key.clone(),
                OpenConn {
                    peripheral,
                    write_char,
                    from_radio_char,
                    nus_notify_only,
                },
            );
        }

        Ok((BackendConnId(key), rx, None))
    }

    async fn write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        let open = self.open.lock().await;
        let session = open
            .get(&conn.0)
            .ok_or_else(|| GattError::new(GattErrorCode::SessionNotFound, "not connected"))?;
        if session
            .peripheral
            .write(&session.write_char, payload, WriteType::WithoutResponse)
            .await
            .is_err()
        {
            session
                .peripheral
                .write(&session.write_char, payload, WriteType::WithResponse)
                .await
                .map_err(|err| {
                    GattError::new(GattErrorCode::WriteFailed, format!("write failed: {err}"))
                })?;
        }
        Ok(())
    }

    async fn read_from_radio(&self, conn: &BackendConnId) -> Result<Vec<u8>, GattError> {
        let open = self.open.lock().await;
        let session = open
            .get(&conn.0)
            .ok_or_else(|| GattError::new(GattErrorCode::SessionNotFound, "not connected"))?;
        if session.nus_notify_only {
            return Err(GattError::new(
                GattErrorCode::NotifiedReadForbidden,
                "nus tx read forbidden while notify active",
            ));
        }
        let Some(from_radio) = session.from_radio_char.as_ref() else {
            return Ok(Vec::new());
        };
        session
            .peripheral
            .read(from_radio)
            .await
            .map_err(|e| GattError::new(GattErrorCode::WriteFailed, format!("read: {e}")))
    }

    async fn disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        let mut open = self.open.lock().await;
        if let Some(session) = open.remove(&conn.0) {
            let _ = session.peripheral.disconnect().await;
        }
        Ok(())
    }

    async fn rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        let open = self.open.lock().await;
        let session = open
            .get(&conn.0)
            .ok_or_else(|| GattError::new(GattErrorCode::SessionNotFound, "not connected"))?;
        let props = session
            .peripheral
            .properties()
            .await
            .ok()
            .flatten()
            .ok_or_else(|| GattError::new(GattErrorCode::Internal, "no peripheral properties"))?;
        props
            .rssi
            .ok_or_else(|| GattError::new(GattErrorCode::Internal, "rssi unavailable"))
    }
}
