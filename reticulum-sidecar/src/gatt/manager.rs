//! Multi-profile GATT session manager (Meshtastic / MeshCore / registry for RNode).

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};
use uuid::Uuid;

use super::att::validate_write_payload;
use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::error::{GattError, GattErrorCode};
use super::events::GattSessionEvent;
use super::fake::FakeBleBackend;
use super::profile::{GattProfile, normalize_address};
use super::registry::GattRegistry;

#[cfg(feature = "gatt-ble")]
use super::LazyBtleplugBackend;

struct LiveSession {
    profile: GattProfile,
    address: String,
    conn: BackendConnId,
    mtu: Option<u16>,
    closing: Arc<Mutex<()>>,
}

#[derive(Default)]
struct PendingEvents {
    events: Vec<GattSessionEvent>,
    overflowed: bool,
}

const MAX_PENDING_EVENTS: usize = 256;

/// Production or test backend selection.
pub enum GattBackend {
    /// In-memory (unit tests / stub builds without btleplug).
    #[cfg_attr(not(test), allow(dead_code))]
    Fake(FakeBleBackend),
    #[cfg(feature = "gatt-ble")]
    Btleplug(Arc<LazyBtleplugBackend>),
    /// Bluetooth support was not compiled into this build.
    #[cfg(not(feature = "gatt-ble"))]
    Disabled,
}

impl GattBackend {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn fake() -> Self {
        Self::Fake(FakeBleBackend::new())
    }

    #[cfg(not(feature = "gatt-ble"))]
    pub fn disabled() -> Self {
        Self::Disabled
    }
}

pub struct GattManager {
    backend: GattBackend,
    registry: Mutex<GattRegistry>,
    sessions: RwLock<HashMap<String, LiveSession>>,
    /// address → session_id; None reserves an in-progress connect.
    by_address: Mutex<HashMap<String, Option<String>>>,
    event_tx: broadcast::Sender<GattSessionEvent>,
    pending_events: std::sync::Mutex<HashMap<String, PendingEvents>>,
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
            pending_events: std::sync::Mutex::new(HashMap::new()),
        })
    }

    pub async fn subscribe_session(
        &self,
        session_id: &str,
    ) -> Result<(broadcast::Receiver<GattSessionEvent>, Vec<GattSessionEvent>), GattError> {
        let sessions = self.sessions.read().await;
        if !sessions.contains_key(session_id) {
            return Err(GattError::new(
                GattErrorCode::SessionNotFound,
                "session not connected",
            ));
        }
        let mut pending = self
            .pending_events
            .lock()
            .expect("GATT pending events lock");
        let queued = pending.remove(session_id).unwrap_or_default();
        if queued.overflowed {
            return Err(GattError::new(
                GattErrorCode::Internal,
                "GATT events overflowed before subscription",
            ));
        }
        // emit() uses the same lock, leaving no gap between replay and live delivery.
        Ok((self.event_tx.subscribe(), queued.events))
    }

    pub fn emit(&self, event: GattSessionEvent) {
        let session_id = match &event {
            GattSessionEvent::Bytes { session_id, .. }
            | GattSessionEvent::Disconnected { session_id, .. }
            | GattSessionEvent::Mtu { session_id, .. }
            | GattSessionEvent::Rssi { session_id, .. } => Some(session_id),
            GattSessionEvent::Error { session_id, .. } => session_id.as_ref(),
        };
        let mut pending = self
            .pending_events
            .lock()
            .expect("GATT pending events lock");
        if let Some(queued) = session_id.and_then(|id| pending.get_mut(id)) {
            if queued.events.len() == MAX_PENDING_EVENTS {
                queued.overflowed = true;
            } else {
                queued.events.push(event);
            }
            return;
        }
        let _ = self.event_tx.send(event);
    }

    async fn be_adapter_available(&self) -> Result<(), GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.adapter_available().await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.adapter_available().await,
            #[cfg(not(feature = "gatt-ble"))]
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
            #[cfg(not(feature = "gatt-ble"))]
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
            #[cfg(not(feature = "gatt-ble"))]
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
            #[cfg(not(feature = "gatt-ble"))]
            GattBackend::Disabled => Err(GattError::new(
                GattErrorCode::FeatureDisabled,
                "gatt ble backend not enabled in this build",
            )),
        }
    }

    async fn be_disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.disconnect(conn).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.disconnect(conn).await,
            #[cfg(not(feature = "gatt-ble"))]
            GattBackend::Disabled => Ok(()),
        }
    }

    async fn be_rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        match &self.backend {
            GattBackend::Fake(b) => b.rssi(conn).await,
            #[cfg(feature = "gatt-ble")]
            GattBackend::Btleplug(b) => b.rssi(conn).await,
            #[cfg(not(feature = "gatt-ble"))]
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
        // Power loss / abandoned DELETE can leave the MAC reserved for this same
        // profile. Reclaim so reconnect is not stuck on mac_conflict forever.
        self.reclaim_stale_same_profile(&key, profile).await?;
        {
            let mut addresses = self.by_address.lock().await;
            if addresses.contains_key(&key) {
                return Err(GattError::new(
                    GattErrorCode::MacConflict,
                    "peripheral already connected or connecting",
                ));
            }
            addresses.insert(key.clone(), None);
        }
        {
            let mut reg = self.registry.lock().await;
            if let Err(e) = reg.register(&key, profile) {
                self.by_address.lock().await.remove(&key);
                return Err(e);
            }
        }

        let connect_result = self.be_connect(profile, &key).await;
        let (conn, mut events, mtu) = match connect_result {
            Ok(v) => v,
            Err(e) => {
                let mut reg = self.registry.lock().await;
                let _ = reg.unregister(&key, profile);
                self.by_address.lock().await.remove(&key);
                self.emit(GattSessionEvent::from_error(None, &e));
                return Err(e);
            }
        };

        let session_id = Uuid::new_v4().to_string();
        self.pending_events
            .lock()
            .expect("GATT pending events lock")
            .insert(session_id.clone(), PendingEvents::default());
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(
                session_id.clone(),
                LiveSession {
                    profile,
                    address: key.clone(),
                    conn: conn.clone(),
                    mtu,
                    closing: Arc::new(Mutex::new(())),
                },
            );
        }
        {
            self.by_address
                .lock()
                .await
                .insert(key.clone(), Some(session_id.clone()));
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
                        // Peripheral is already gone — force-forget even if OS
                        // disconnect fails/times out so reconnect can reclaim.
                        let _ = mgr.drop_session_internal(&sid, true).await;
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

    /// Drop a same-profile orphan left by power loss or failed DELETE cleanup.
    async fn reclaim_stale_same_profile(
        &self,
        key: &str,
        profile: GattProfile,
    ) -> Result<(), GattError> {
        let existing = {
            let addresses = self.by_address.lock().await;
            addresses.get(key).cloned()
        };
        let Some(maybe_sid) = existing else {
            return Ok(());
        };
        let Some(sid) = maybe_sid else {
            // Another connect is in flight for this MAC.
            return Ok(());
        };
        let existing_profile = {
            let sessions = self.sessions.read().await;
            sessions.get(&sid).map(|s| s.profile)
        };
        match existing_profile {
            Some(owner) if owner == profile => {
                tracing::warn!(
                    target: "gatt",
                    profile = %profile,
                    address = %key,
                    session_id = %sid,
                    "reclaiming stale same-profile GATT session before reconnect"
                );
                self.drop_session_internal(&sid, true).await
            }
            Some(_) => Ok(()),
            None => {
                // by_address points at a session that is already gone — free the MAC
                // only if this exact sid is still reserved (a newer connect may have
                // replaced it between our unlocked reads).
                tracing::warn!(
                    target: "gatt",
                    profile = %profile,
                    address = %key,
                    session_id = %sid,
                    "clearing dangling GATT address reservation before reconnect"
                );
                let mut addresses = self.by_address.lock().await;
                let still_stale =
                    matches!(addresses.get(key), Some(Some(current)) if current == &sid);
                if still_stale {
                    addresses.remove(key);
                    drop(addresses);
                    let mut reg = self.registry.lock().await;
                    let _ = reg.unregister(key, profile);
                }
                Ok(())
            }
        }
    }

    async fn drop_session_internal(&self, session_id: &str, force: bool) -> Result<(), GattError> {
        let closing = {
            let sessions = self.sessions.read().await;
            let Some(session) = sessions.get(session_id) else {
                return Ok(());
            };
            Arc::clone(&session.closing)
        };
        let _closing = closing.lock().await;
        let conn = {
            let sessions = self.sessions.read().await;
            let Some(session) = sessions.get(session_id) else {
                return Ok(());
            };
            session.conn.clone()
        };
        // Keep ownership until OS teardown completes. Explicit DELETE retries on
        // error; force=true (physical disconnect / same-profile reclaim) frees
        // the MAC even when disconnect fails so power-loss reconnect works.
        let disconnect_result = self.be_disconnect(&conn).await;
        if let Err(ref e) = disconnect_result {
            if !force {
                return Err(e.clone());
            }
            tracing::warn!(
                target: "gatt",
                session_id,
                error = %e.message,
                "force-forgetting GATT session after disconnect failure"
            );
        }
        if let Some(session) = self.sessions.write().await.remove(session_id) {
            self.pending_events
                .lock()
                .expect("GATT pending events lock")
                .remove(session_id);
            {
                self.by_address.lock().await.remove(&session.address);
            }
            {
                let mut reg = self.registry.lock().await;
                let _ = reg.unregister(&session.address, session.profile);
            }
        }
        if force { Ok(()) } else { disconnect_result }
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), GattError> {
        let exists = self.sessions.read().await.contains_key(session_id);
        if !exists {
            return Err(GattError::new(
                GattErrorCode::SessionNotFound,
                format!("session {session_id} not found"),
            ));
        }
        self.drop_session_internal(session_id, false).await
    }

    /// Disconnect every LoRa GATT session and drop the btleplug CBCentralManager
    /// so an RNode bond-recovery connect is the only CoreBluetooth central.
    pub async fn release_ble_central(&self) -> Result<usize, GattError> {
        let ids: Vec<String> = self.sessions.read().await.keys().cloned().collect();
        let count = ids.len();
        for id in &ids {
            let _ = self.drop_session_internal(id, true).await;
        }
        #[cfg(feature = "gatt-ble")]
        if let GattBackend::Btleplug(lazy) = &self.backend {
            lazy.dispose_adapter().await;
        }
        Ok(count)
    }

    /// Allow LoRa GATT to create a CBCentralManager again after RNode bond recovery.
    pub fn clear_bond_recovery_hold(&self) {
        #[cfg(feature = "gatt-ble")]
        if let GattBackend::Btleplug(lazy) = &self.backend {
            lazy.set_bond_recovery_hold(false);
        }
    }

    pub async fn write(&self, session_id: &str, payload: &[u8]) -> Result<(), GattError> {
        validate_write_payload(payload)?;
        let conn = {
            let sessions = self.sessions.read().await;
            let session = sessions.get(session_id).ok_or_else(|| {
                GattError::new(
                    GattErrorCode::SessionNotFound,
                    format!("session {session_id} not found"),
                )
            })?;
            session.conn.clone()
        };
        if payload.is_empty() {
            return Ok(());
        }
        // Both firmware APIs decode one whole command per GATT write. ATT long writes
        // belong to the OS; splitting here sends independent, truncated commands.
        self.be_write(&conn, payload).await.inspect_err(|e| {
            self.emit(GattSessionEvent::from_error(
                Some(session_id.to_string()),
                e,
            ));
        })?;
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
            #[cfg(not(feature = "gatt-ble"))]
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
    async fn meshtastic_write_preserves_the_complete_protobuf() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        fake.add_device(meshtastic_dev("11:22:33:44:55:66")).await;
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "11:22:33:44:55:66")
            .await
            .unwrap();
        // A ToRadio text-message packet, encoded with the application's protobuf schema.
        let payload = hex::decode("0a3915ffffffff222d0801122954686973206d657373616765206973206c6f6e676572207468616e207477656e74792062797465732e357b000000").unwrap();
        mgr.write(&sid, &payload).await.unwrap();
        let writes = fake.writes_for("11:22:33:44:55:66").await;
        assert_eq!(writes, vec![payload]);
    }

    #[tokio::test]
    async fn meshcore_write_preserves_the_complete_command() {
        let mgr = GattManager::new(GattBackend::fake());
        let fake = mgr.fake_backend().unwrap();
        let (sid, _) = mgr
            .connect(GattProfile::Meshcore, "11:22:33:44:55:66")
            .await
            .unwrap();
        let mut payload = vec![2, 0, 0, 0, 0, 0];
        payload.extend_from_slice(b"A MeshCore message longer than twenty bytes");
        mgr.write(&sid, &payload).await.unwrap();
        assert_eq!(fake.writes_for("11:22:33:44:55:66").await, vec![payload]);
    }

    #[tokio::test]
    async fn oversized_write_is_rejected_without_sending_a_partial_frame() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshcore, "11:22:33:44:55:66")
            .await
            .unwrap();
        let err = mgr.write(&sid, &[1; 513]).await.unwrap_err();
        assert_eq!(err.code, GattErrorCode::WriteFailed);
        assert!(
            mgr.fake_backend()
                .unwrap()
                .writes_for("11:22:33:44:55:66")
                .await
                .is_empty()
        );
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

    #[tokio::test]
    async fn connection_aliases_cannot_claim_the_same_peripheral_twice() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        assert_eq!(
            mgr.connect(GattProfile::Meshcore, "aabbccddeeff")
                .await
                .unwrap_err()
                .code,
            GattErrorCode::MacConflict
        );
        assert!(mgr.is_connected(&sid).await);
        assert_eq!(mgr.session_count().await, 1);

        // Same-profile reconnect reclaims (power-loss / abandoned cleanup path).
        let (sid2, _) = mgr
            .connect(GattProfile::Meshtastic, "aabbccddeeff")
            .await
            .unwrap();
        assert_ne!(sid, sid2);
        assert!(!mgr.is_connected(&sid).await);
        assert!(mgr.is_connected(&sid2).await);
        assert_eq!(mgr.session_count().await, 1);
    }

    #[tokio::test]
    async fn events_wait_for_the_first_websocket_subscription() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        let packet = |data: &[u8]| GattSessionEvent::Bytes {
            session_id: sid.clone(),
            profile: GattProfile::Meshtastic,
            data_b64: B64.encode(data),
        };
        mgr.emit(packet(&[1, 2, 3]));
        let (mut receiver, pending) = mgr.subscribe_session(&sid).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert!(
            matches!(&pending[0], GattSessionEvent::Bytes { data_b64, .. } if data_b64 == "AQID")
        );
        mgr.emit(packet(&[4, 5, 6]));
        assert!(
            matches!(receiver.recv().await.unwrap(), GattSessionEvent::Bytes { data_b64, .. } if data_b64 == "BAUG")
        );
        assert!(receiver.try_recv().is_err());
        let (_, replay) = mgr.subscribe_session(&sid).await.unwrap();
        assert!(replay.is_empty());
    }

    #[tokio::test]
    async fn pending_event_overflow_fails_the_subscription() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshcore, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        for _ in 0..=MAX_PENDING_EVENTS {
            mgr.emit(GattSessionEvent::Bytes {
                session_id: sid.clone(),
                profile: GattProfile::Meshcore,
                data_b64: "AQID".into(),
            });
        }
        let error = mgr.subscribe_session(&sid).await.unwrap_err();
        assert_eq!(error.code, GattErrorCode::Internal);
        assert!(error.message.contains("overflowed"));
    }

    #[tokio::test]
    async fn disconnect_keeps_ownership_until_backend_teardown_finishes() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        let gate = mgr.fake_backend().unwrap().pause_disconnect().await;
        let disconnect = tokio::spawn({
            let mgr = Arc::clone(&mgr);
            let sid = sid.clone();
            async move { mgr.disconnect(&sid).await }
        });
        mgr.fake_backend()
            .unwrap()
            .wait_for_disconnect_start()
            .await;
        assert!(mgr.is_connected(&sid).await);
        assert_eq!(
            mgr.register_external(GattProfile::Rnode, "aabbccddeeff")
                .await
                .unwrap_err()
                .code,
            GattErrorCode::MacConflict
        );
        // Other LoRa profile must not steal the MAC mid-teardown.
        assert_eq!(
            mgr.connect(GattProfile::Meshcore, "aabbccddeeff")
                .await
                .unwrap_err()
                .code,
            GattErrorCode::MacConflict
        );
        gate.notify_one();
        disconnect.await.unwrap().unwrap();
        assert!(!mgr.is_connected(&sid).await);
        mgr.register_external(GattProfile::Rnode, "aabbccddeeff")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn failed_disconnect_retains_the_session_for_retry() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        mgr.fake_backend()
            .unwrap()
            .set_disconnect_failure(true)
            .await;
        assert!(mgr.disconnect(&sid).await.is_err());
        assert!(mgr.is_connected(&sid).await);
        assert_eq!(
            mgr.register_external(GattProfile::Rnode, "aabbccddeeff")
                .await
                .unwrap_err()
                .code,
            GattErrorCode::MacConflict
        );
        mgr.fake_backend()
            .unwrap()
            .set_disconnect_failure(false)
            .await;
        mgr.disconnect(&sid).await.unwrap();
        assert!(!mgr.is_connected(&sid).await);
    }

    #[tokio::test]
    async fn same_profile_reconnect_reclaims_after_failed_disconnect() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshcore, "AA:BB:CC:DD:EE:01")
            .await
            .unwrap();
        mgr.fake_backend()
            .unwrap()
            .set_disconnect_failure(true)
            .await;
        assert!(mgr.disconnect(&sid).await.is_err());
        assert!(mgr.is_connected(&sid).await);

        // Simulate Electron abandoning DELETE cleanup while the sidecar still
        // holds the MAC — same-profile reconnect must reclaim, not mac_conflict.
        mgr.fake_backend()
            .unwrap()
            .set_disconnect_failure(false)
            .await;
        let (sid2, _) = mgr
            .connect(GattProfile::Meshcore, "AA:BB:CC:DD:EE:01")
            .await
            .unwrap();
        assert_ne!(sid, sid2);
        assert!(!mgr.is_connected(&sid).await);
        assert!(mgr.is_connected(&sid2).await);
    }

    #[tokio::test]
    async fn other_profile_still_conflicts_while_session_held() {
        let mgr = GattManager::new(GattBackend::fake());
        let (_sid, _) = mgr
            .connect(GattProfile::Meshcore, "AA:BB:CC:DD:EE:02")
            .await
            .unwrap();
        assert_eq!(
            mgr.connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:02")
                .await
                .unwrap_err()
                .code,
            GattErrorCode::MacConflict
        );
    }

    #[tokio::test(start_paused = true)]
    async fn meshtastic_write_does_not_wait_for_the_receive_queue() {
        let mgr = GattManager::new(GattBackend::fake());
        let (sid, _) = mgr
            .connect(GattProfile::Meshtastic, "AA:BB:CC:DD:EE:FF")
            .await
            .unwrap();
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            mgr.write(&sid, &[1, 2, 3]),
        )
        .await
        .unwrap()
        .unwrap();
    }
}
