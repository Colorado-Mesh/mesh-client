//! Multi-profile GATT session manager (Meshtastic / MeshCore / registry for RNode).

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};
use uuid::Uuid;

use super::att::chunk_payload;
use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::error::{GattError, GattErrorCode};
use super::events::GattSessionEvent;
use super::fake::FakeBleBackend;
use super::profile::{GattProfile, normalize_address};
use super::registry::GattRegistry;

#[cfg(feature = "gatt-ble")]
use super::btleplug_backend::BtleplugBackend;

struct LiveSession {
    #[allow(dead_code)] // retained for diagnostics / future session listing
    session_id: String,
    profile: GattProfile,
    address: String,
    conn: BackendConnId,
    mtu: Option<u16>,
}

/// Production or test backend selection.
pub enum GattBackend {
    /// In-memory (unit tests / stub builds without btleplug).
    #[cfg_attr(not(test), allow(dead_code))]
    Fake(FakeBleBackend),
    #[cfg(feature = "gatt-ble")]
    Btleplug(Arc<BtleplugBackend>),
    /// Feature not compiled or adapter probe deferred.
    Disabled,
}

impl GattBackend {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn fake() -> Self {
        Self::Fake(FakeBleBackend::new())
    }

    pub fn disabled() -> Self {
        Self::Disabled
    }
}

pub struct GattManager {
    backend: GattBackend,
    registry: Mutex<GattRegistry>,
    sessions: RwLock<HashMap<String, LiveSession>>,
    /// address → session_id
    by_address: Mutex<HashMap<String, String>>,
    event_tx: broadcast::Sender<GattSessionEvent>,
}

impl GattManager {
    pub fn new(backend: GattBackend) -> Arc<Self> {
        let (event_tx, _) = broadcast::channel(256);
        Arc::new(Self {
            backend,
            registry: Mutex::new(GattRegistry::new()),
            sessions: RwLock::new(HashMap::new()),
            by_address: Mutex::new(HashMap::new()),
            event_tx,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GattSessionEvent> {
        self.event_tx.subscribe()
    }

    pub fn emit(&self, event: GattSessionEvent) {
        let _ = self.event_tx.send(event);
    }

    async fn be_adapter_available(&self) -> Result<(), GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.adapter_available().await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.adapter_available().await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    async fn be_scan(
        &self,
        profile: GattProfile,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.scan(profile, timeout_secs).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.scan(profile, timeout_secs).await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    async fn be_connect(
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
        match &self.backend {
            GattBackend::Fake(b) => b.connect(profile, address).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.connect(profile, address).await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    async fn be_write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.write(conn, payload).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.write(conn, payload).await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    async fn be_read_from_radio(&self, conn: &BackendConnId) -> Result<Vec<u8>, GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.read_from_radio(conn).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.read_from_radio(conn).await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    /// Drain Meshtastic FromRadio until empty (with empty retries while the mailbox fills).
    async fn drain_meshtastic_from_radio(&self, session_id: &str, conn: &BackendConnId) -> usize {
        const MAX_EMPTY_STREAK: u8 = 5;
        let mut packets = 0usize;
        let mut empty_streak = 0u8;
        loop {
            match self.be_read_from_radio(conn).await {
                Ok(data) if !data.is_empty() => {
                    empty_streak = 0;
                    packets = packets.saturating_add(1);
                    self.emit(GattSessionEvent::Bytes {
                        session_id: session_id.to_string(),
                        profile: GattProfile::Meshtastic,
                        data_b64: B64.encode(data),
                    });
                }
                Ok(_) => {
                    empty_streak = empty_streak.saturating_add(1);
                    if empty_streak >= MAX_EMPTY_STREAK {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(e) => {
                    self.emit(GattSessionEvent::from_error(
                        Some(session_id.to_string()),
                        &e,
                    ));
                    break;
                }
            }
        }
        packets
    }

    async fn be_disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.disconnect(conn).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.disconnect(conn).await,
            GattBackend::Disabled => Ok(()),
        }
    }

    async fn be_rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.rssi(conn).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.rssi(conn).await,
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    pub async fn availability(&self) -> serde_json::Value {
        match self.be_adapter_available().await {
            Ok(()) => serde_json::json!({
                "available": true,
                "missing": [],
                "permissions_granted": true,
                "probe_failed": false,
            }),
            Err(e) => serde_json::json!({
                "available": false,
                "missing": [e.message],
                "permissions_granted": e.code != GattErrorCode::AdapterMissing
                    && e.code != GattErrorCode::FeatureDisabled,
                "probe_failed": e.code != GattErrorCode::FeatureDisabled,
                "code": e.code.as_str(),
            }),
        }
    }

    pub async fn scan(
        &self,
        mode: &str,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        let timeout_secs = timeout_secs.clamp(1, 30);
        let profiles: Vec<GattProfile> = match mode {
            "meshtastic" => vec![GattProfile::Meshtastic],
            "meshcore" => vec![GattProfile::Meshcore],
            "rnode" => vec![GattProfile::Rnode],
            "peer" => vec![GattProfile::Peer],
            "all" => vec![
                GattProfile::Meshtastic,
                GattProfile::Meshcore,
                GattProfile::Rnode,
                GattProfile::Peer,
            ],
            other => {
                return Err(GattError::new(
                    GattErrorCode::InvalidProfile,
                    format!("invalid scan mode: {other}"),
                ));
            }
        };

        let scan_profile = profiles[0];
        {
            let mut reg = self.registry.lock().await;
            reg.acquire_scan(scan_profile)?;
        }
        let result = async {
            let mut out = Vec::new();
            for profile in profiles {
                let found = self.be_scan(profile, timeout_secs).await?;
                out.extend(found);
            }
            // Dedupe by address.
            let mut seen = std::collections::HashSet::new();
            out.retain(|d| seen.insert(d.address.to_ascii_lowercase()));
            Ok(out)
        }
        .await;
        {
            let mut reg = self.registry.lock().await;
            let _ = reg.release_scan(scan_profile);
        }
        result
    }

    pub async fn connect(
        self: &Arc<Self>,
        profile: GattProfile,
        address: &str,
    ) -> Result<(String, Option<u16>), GattError> {
        if !profile.is_lora_pipe() {
            return Err(GattError::new(
                GattErrorCode::InvalidProfile,
                format!("profile {profile} does not use gatt session pipe"),
            ));
        }
        let key = normalize_address(address)?;
        {
            let mut reg = self.registry.lock().await;
            reg.assert_can_connect(&key, profile)?;
            reg.register(&key, profile)?;
        }

        let connect_result = self.be_connect(profile, &key).await;
        let (conn, mut events, mtu) = match connect_result {
            Ok(v) => v,
            Err(e) => {
                let mut reg = self.registry.lock().await;
                let _ = reg.unregister(&key, profile);
                self.emit(GattSessionEvent::from_error(None, &e));
                return Err(e);
            }
        };

        let session_id = Uuid::new_v4().to_string();
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(
                session_id.clone(),
                LiveSession {
                    session_id: session_id.clone(),
                    profile,
                    address: key.clone(),
                    conn: conn.clone(),
                    mtu,
                },
            );
        }
        {
            self.by_address
                .lock()
                .await
                .insert(key.clone(), session_id.clone());
        }

        let mgr = Arc::clone(self);
        let sid = session_id.clone();
        let prof = profile;
        tokio::spawn(async move {
            while let Some(ev) = events.recv().await {
                match ev {
                    BackendEvent::Bytes(data) => {
                        mgr.emit(GattSessionEvent::Bytes {
                            session_id: sid.clone(),
                            profile: prof,
                            data_b64: B64.encode(data),
                        });
                    }
                    BackendEvent::Disconnected { reason } => {
                        mgr.emit(GattSessionEvent::Disconnected {
                            session_id: sid.clone(),
                            profile: prof,
                            reason,
                        });
                        let _ = mgr.drop_session_internal(&sid).await;
                        break;
                    }
                    BackendEvent::Mtu(mtu) => {
                        if let Some(session) = mgr.sessions.write().await.get_mut(&sid) {
                            session.mtu = Some(mtu);
                        }
                        mgr.emit(GattSessionEvent::Mtu {
                            session_id: sid.clone(),
                            mtu,
                        });
                    }
                    BackendEvent::Rssi(rssi) => {
                        mgr.emit(GattSessionEvent::Rssi {
                            session_id: sid.clone(),
                            rssi,
                        });
                    }
                }
            }
        });

        // Meshtastic: kick an initial fromRadio drain (notify may arrive later).
        if profile == GattProfile::Meshtastic {
            let mgr = Arc::clone(self);
            let sid = session_id.clone();
            let conn_id = conn;
            tokio::spawn(async move {
                let _ = mgr.drain_meshtastic_from_radio(&sid, &conn_id).await;
            });
        }

        Ok((session_id, mtu))
    }

    /// Register an external owner (e.g. RNode via rsReticulum) in the MAC registry without opening a pipe.
    pub async fn register_external(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> Result<(), GattError> {
        let mut reg = self.registry.lock().await;
        reg.register(address, profile)
    }

    pub async fn unregister_external(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> Result<(), GattError> {
        let mut reg = self.registry.lock().await;
        reg.unregister(address, profile)
    }

    async fn drop_session_internal(&self, session_id: &str) -> Result<(), GattError> {
        let removed = {
            let mut sessions = self.sessions.write().await;
            sessions.remove(session_id)
        };
        if let Some(session) = removed {
            {
                self.by_address.lock().await.remove(&session.address);
            }
            {
                let mut reg = self.registry.lock().await;
                let _ = reg.unregister(&session.address, session.profile);
            }
            let _ = self.be_disconnect(&session.conn).await;
        }
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), GattError> {
        let exists = self.sessions.read().await.contains_key(session_id);
        if !exists {
            return Err(GattError::new(
                GattErrorCode::SessionNotFound,
                format!("session {session_id} not found"),
            ));
        }
        self.drop_session_internal(session_id).await
    }

    pub async fn write(&self, session_id: &str, payload: &[u8]) -> Result<(), GattError> {
        let (conn, mtu, profile) = {
            let sessions = self.sessions.read().await;
            let session = sessions.get(session_id).ok_or_else(|| {
                GattError::new(
                    GattErrorCode::SessionNotFound,
                    format!("session {session_id} not found"),
                )
            })?;
            (session.conn.clone(), session.mtu, session.profile)
        };
        for chunk in chunk_payload(payload, mtu) {
            self.be_write(&conn, &chunk).await.inspect_err(|e| {
                self.emit(GattSessionEvent::from_error(
                    Some(session_id.to_string()),
                    e,
                ));
            })?;
        }
        // After Meshtastic write, drain FromRadio until empty (protocol: not a single read).
        if profile == GattProfile::Meshtastic {
            let _ = self.drain_meshtastic_from_radio(session_id, &conn).await;
        }
        Ok(())
    }

    pub async fn rssi(&self, session_id: &str) -> Result<i16, GattError> {
        let conn = {
            let sessions = self.sessions.read().await;
            sessions
                .get(session_id)
                .ok_or_else(|| {
                    GattError::new(
                        GattErrorCode::SessionNotFound,
                        format!("session {session_id} not found"),
                    )
                })?
                .conn
                .clone()
        };
        self.be_rssi(&conn).await
    }

    pub async fn is_connected(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains_key(session_id)
    }

    #[cfg(test)]
    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }

    /// Test helper: access fake backend.
    #[cfg(test)]
    pub fn fake_backend(&self) -> Option<&FakeBleBackend> {
        match &self.backend {
            GattBackend::Fake(b) => Some(b),
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(_) => None,
            GattBackend::Disabled => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gatt::backend::ScannedDevice;
    use crate::gatt::error::GattErrorCode;

    fn meshtastic_dev(addr: &str) -> ScannedDevice {
        ScannedDevice {
            address: addr.into(),
            name: Some("Meshtastic".into()),
            rssi: Some(-60),
            service_uuids: vec!["6ba1b21815a8461f9fa85dcae273eafd".into()],
        }
    }

    fn meshcore_dev(addr: &str) -> ScannedDevice {
        ScannedDevice {
            address: addr.into(),
            name: Some("MeshCore".into()),
            rssi: Some(-70),
            service_uuids: vec!["6e400001b5a3f393e0a9e50e24dcca9e".into()],
        }
    }

    #[tokio::test]
    async fn concurrent_three_sessions_and_mac_conflict() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        fake.add_device(meshtastic_dev("aa:bb:cc:dd:ee:01")).await;
        fake.add_device(meshcore_dev("aa:bb:cc:dd:ee:02")).await;
        fake.add_device(meshcore_dev("aa:bb:cc:dd:ee:03")).await;

        let (s1, _) = mgr
            .connect(GattProfile::Meshtastic, "aa:bb:cc:dd:ee:01")
            .await
            .unwrap();
        let (s2, _) = mgr
            .connect(GattProfile::Meshcore, "aa:bb:cc:dd:ee:02")
            .await
            .unwrap();
        mgr.register_external(GattProfile::Rnode, "aa:bb:cc:dd:ee:03")
            .await
            .unwrap();
        assert_eq!(mgr.session_count().await, 2);

        let err = mgr
            .connect(GattProfile::Meshcore, "aa:bb:cc:dd:ee:01")
            .await
            .unwrap_err();
        assert_eq!(err.code, GattErrorCode::MacConflict);

        mgr.disconnect(&s1).await.unwrap();
        assert!(mgr.is_connected(&s2).await);
        assert!(!mgr.is_connected(&s1).await);
    }

    #[tokio::test]
    async fn write_chunks_and_emits_bytes() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        fake.add_device(meshtastic_dev("11:22:33:44:55:66")).await;
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "11:22:33:44:55:66")
            .await
            .unwrap();
        let payload = vec![1u8; 45];
        mgr.write(&sid, &payload).await.unwrap();
        let writes = fake.writes_for("11:22:33:44:55:66").await;
        assert!(writes.len() >= 2);
    }

    #[tokio::test]
    async fn adapter_missing_surfaces_code() {
        let mgr = GattManager::new(GattBackend::fake());
        mgr.fake_backend().unwrap().set_adapter_ok(false).await;
        let v = mgr.availability().await;
        assert_eq!(v["available"], false);
        assert_eq!(v["code"], "adapter_missing");
    }

    #[tokio::test]
    async fn scan_filters_by_mode() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        fake.add_device(meshtastic_dev("aa:00:00:00:00:01")).await;
        fake.add_device(meshcore_dev("aa:00:00:00:00:02")).await;
        let mt = mgr.scan("meshtastic", 1).await.unwrap();
        assert_eq!(mt.len(), 1);
        let mc = mgr.scan("meshcore", 1).await.unwrap();
        assert_eq!(mc.len(), 1);
        let err = mgr.scan("nope", 1).await.unwrap_err();
        assert_eq!(err.code, GattErrorCode::InvalidProfile);
    }

    #[tokio::test]
    async fn disconnect_one_leaves_others() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        fake.add_device(meshtastic_dev("01:01:01:01:01:01")).await;
        fake.add_device(meshcore_dev("02:02:02:02:02:02")).await;
        let (a, _) = mgr
            .connect(GattProfile::Meshtastic, "01:01:01:01:01:01")
            .await
            .unwrap();
        let (b, _) = mgr
            .connect(GattProfile::Meshcore, "02:02:02:02:02:02")
            .await
            .unwrap();
        mgr.disconnect(&a).await.unwrap();
        assert!(mgr.is_connected(&b).await);
        assert_eq!(mgr.session_count().await, 1);
    }
}
