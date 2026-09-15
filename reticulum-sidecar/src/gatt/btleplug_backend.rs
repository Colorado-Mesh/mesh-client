//! Real btleplug central for Meshtastic / MeshCore GATT sessions.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use btleplug::api::{
    Central, CentralEvent, CentralState, CharPropFlags, Characteristic, Manager as _,
    Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager as BtleManager, Peripheral};
use futures_util::{Stream, StreamExt};
use tokio::sync::{Mutex, Notify, OwnedMutexGuard, mpsc};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::error::{GattError, GattErrorCode};
use super::profile::{self, GattProfile, ble_id_match_key, ble_ids_match, normalize_address};

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

fn characteristic_write_type(properties: CharPropFlags) -> Result<WriteType, GattError> {
    if properties.contains(CharPropFlags::WRITE) {
        Ok(WriteType::WithResponse)
    } else if properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
        Ok(WriteType::WithoutResponse)
    } else {
        Err(GattError::new(
            GattErrorCode::GattDiscoverFailed,
            "write characteristic is not writable",
        ))
    }
}

async fn wait_for_disconnect(
    events: &mut (impl Stream<Item = CentralEvent> + Unpin),
    peripheral_id: &str,
) -> &'static str {
    while let Some(event) = events.next().await {
        match event {
            CentralEvent::DeviceDisconnected(id) if id.to_string() == peripheral_id => {
                return "link_lost";
            }
            CentralEvent::StateUpdate(CentralState::PoweredOff) => return "adapter_powered_off",
            _ => {}
        }
    }
    "adapter_events_ended"
}

async fn setup_with_cleanup<T>(
    setup: impl Future<Output = Result<T, GattError>>,
    disconnect: impl Future<Output = Result<(), btleplug::Error>>,
) -> Result<T, GattError> {
    let result = setup.await;
    if result.is_err() {
        match tokio::time::timeout(Duration::from_secs(5), disconnect).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!("gatt: failed setup disconnect: {e}"),
            Err(_) => tracing::warn!("gatt: failed setup disconnect timed out"),
        }
    }
    result
}

struct ScanLease {
    lock: Option<OwnedMutexGuard<()>>,
    stop: Option<Pin<Box<dyn Future<Output = ()> + Send>>>,
}

impl ScanLease {
    async fn finish(mut self) {
        if let Some(stop) = self.stop.as_mut() {
            stop.await;
        }
        self.stop.take();
        self.lock.take();
    }
}

impl Drop for ScanLease {
    fn drop(&mut self) {
        if let (Some(lock), Some(stop)) = (self.lock.take(), self.stop.take()) {
            // A connect deadline can cancel discovery after start_scan reached the OS.
            // Keep the next scan out until that scan has actually been stopped.
            tokio::spawn(async move {
                stop.await;
                drop(lock);
            });
        }
    }
}

async fn serialized_scan<T>(
    lock: &Arc<Mutex<()>>,
    scan: impl Future<Output = Result<T, GattError>>,
    stop: impl Future<Output = ()> + Send + 'static,
) -> Result<T, GattError> {
    let lease = ScanLease {
        lock: Some(Arc::clone(lock).lock_owned().await),
        stop: Some(Box::pin(stop)),
    };
    let result = scan.await;
    lease.finish().await;
    result
}

/// Meshtastic FromRadio queue: read until empty, with short empty retries while the
/// radio finishes filling the mailbox (parity with meshtastic-python / Android).
async fn drain_meshtastic_from_radio(
    peripheral: &Peripheral,
    from_radio: &Characteristic,
    tx: &mpsc::UnboundedSender<BackendEvent>,
) -> usize {
    const MAX_EMPTY_STREAK: u8 = 5;
    let mut packets = 0usize;
    let mut empty_streak = 0u8;
    loop {
        match peripheral.read(from_radio).await {
            Ok(data) if !data.is_empty() => {
                empty_streak = 0;
                packets = packets.saturating_add(1);
                if tx.send(BackendEvent::Bytes(data)).is_err() {
                    break;
                }
            }
            Ok(_) => {
                empty_streak = empty_streak.saturating_add(1);
                if empty_streak >= MAX_EMPTY_STREAK {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(_) => break,
        }
    }
    packets
}

fn is_usable_mac(addr: &str) -> bool {
    let hex = ble_id_match_key(addr);
    hex.len() == 12 && hex != "000000000000"
}

/// Prefer a real MAC when CoreBluetooth/WinRT exposes one; otherwise compact peripheral UUID hex
/// (matches Noble `lastBleDevice` ids on macOS).
fn connect_address_for(
    peripheral: &Peripheral,
    props: &btleplug::api::PeripheralProperties,
) -> String {
    let mac = props.address.to_string();
    if is_usable_mac(&mac) {
        return mac.to_ascii_lowercase();
    }
    let id_str = format!("{}", peripheral.id());
    let id_hex = ble_id_match_key(&id_str);
    if !id_hex.is_empty() {
        return id_hex;
    }
    ble_id_match_key(&format!("{:?}", peripheral.id()))
}

struct OpenConn {
    peripheral: Peripheral,
    write_char: Characteristic,
    /// Last advertisement / property RSSI (CoreBluetooth often only exposes this at discovery).
    last_rssi: Option<i16>,
    write_type: WriteType,
    write_lock: Arc<Mutex<()>>,
    read_request: Arc<Notify>,
    meshtastic: bool,
    event_task: JoinHandle<()>,
}

pub struct BtleplugBackend {
    adapter: Adapter,
    scan_lock: Arc<Mutex<()>>,
    scan_needs_stop: Arc<AtomicBool>,
    open: Mutex<HashMap<String, OpenConn>>,
    /// RSSI from the most recent advertisement / scan, keyed by normalized connect address.
    last_seen_rssi: Mutex<HashMap<String, i16>>,
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
            scan_lock: Arc::new(Mutex::new(())),
            scan_needs_stop: Arc::new(AtomicBool::new(false)),
            open: Mutex::new(HashMap::new()),
            last_seen_rssi: Mutex::new(HashMap::new()),
        })
    }

    fn service_uuid(profile: GattProfile) -> Option<Uuid> {
        match profile {
            GattProfile::Meshtastic => Some(profile::meshtastic::service()),
            GattProfile::Meshcore | GattProfile::Rnode => Some(profile::nus::service()),
            GattProfile::Peer => None,
        }
    }

    fn peripheral_id_str(peripheral: &Peripheral) -> String {
        // Prefer Display (bare UUID / MAC) over Debug (`PeripheralId(...)`) so hex keys match
        // stored Noble / CoreBluetooth ids without wrapper noise.
        let display = format!("{}", peripheral.id());
        if !ble_id_match_key(&display).is_empty() {
            return display;
        }
        format!("{:?}", peripheral.id())
    }

    async fn find_peripheral(&self, address: &str) -> Result<Peripheral, GattError> {
        let key = normalize_address(address)?;
        let peris =
            self.adapter.peripherals().await.map_err(|e| {
                GattError::new(GattErrorCode::Internal, format!("peripherals: {e}"))
            })?;
        for p in peris {
            let props = p.properties().await.ok().flatten();
            let id_str = Self::peripheral_id_str(&p);
            let addr = props
                .as_ref()
                .map(|x| x.address.to_string())
                .unwrap_or_default();
            if ble_ids_match(&key, &id_str) || (!addr.is_empty() && ble_ids_match(&key, &addr)) {
                return Ok(p);
            }
        }
        Err(GattError::new(
            GattErrorCode::ConnectTimeout,
            format!("peripheral {key} not found — scan first"),
        ))
    }

    /// Unfiltered scan so connect-by-id works when the radio does not advertise its GATT
    /// service UUID (common for MeshCore / some RNodes — filtered UI scans still use NUS).
    async fn scan_unfiltered(&self, timeout_secs: u64) -> Result<Vec<ScannedDevice>, GattError> {
        self.scan_devices(ScanFilter::default(), timeout_secs).await
    }

    async fn scan_devices(
        &self,
        filter: ScanFilter,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        let stop_adapter = self.adapter.clone();
        let needs_stop = Arc::clone(&self.scan_needs_stop);
        serialized_scan(
            &self.scan_lock,
            async {
                if self.scan_needs_stop.load(Ordering::Relaxed) {
                    tokio::time::timeout(Duration::from_secs(3), self.adapter.stop_scan())
                        .await
                        .map_err(|_| {
                            GattError::new(
                                GattErrorCode::ScanBusy,
                                "previous scan cleanup timed out",
                            )
                        })?
                        .map_err(|e| {
                            GattError::new(
                                GattErrorCode::ScanBusy,
                                format!("previous scan cleanup failed: {e}"),
                            )
                        })?;
                    self.scan_needs_stop.store(false, Ordering::Relaxed);
                }
                self.scan_needs_stop.store(true, Ordering::Relaxed);
                self.adapter.start_scan(filter).await.map_err(|e| {
                    GattError::new(GattErrorCode::Internal, format!("start_scan: {e}"))
                })?;
                tokio::time::sleep(Duration::from_secs(timeout_secs.max(1))).await;
                Ok(())
            },
            async move {
                match tokio::time::timeout(Duration::from_secs(3), stop_adapter.stop_scan()).await {
                    Ok(Ok(())) => {
                        needs_stop.store(false, Ordering::Relaxed);
                    }
                    Ok(Err(e)) => tracing::warn!("gatt: stop_scan failed: {e}"),
                    Err(_) => tracing::warn!("gatt: stop_scan timed out"),
                }
            },
        )
        .await?;
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
                address: connect_address_for(&p, &props),
                name: props.local_name,
                rssi: props.rssi,
                service_uuids: props
                    .services
                    .iter()
                    .map(std::string::ToString::to_string)
                    .collect(),
            });
        }
        self.remember_scanned_rssi(&out);
        Ok(out)
    }

    async fn find_peripheral_scanning(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> Result<Peripheral, GattError> {
        if let Ok(p) = self.find_peripheral(address).await {
            return Ok(p);
        }
        tracing::info!(
            target: "gatt",
            address,
            profile = %profile,
            "peripheral not cached — unfiltered scan before connect"
        );
        // Ignore empty Ok; surface hard scan failures so callers do not spin on stale "scan first".
        let scanned = self.scan_unfiltered(8).await?;
        self.remember_scanned_rssi(&scanned);
        self.find_peripheral(address).await
    }

    fn remember_scanned_rssi(&self, devices: &[ScannedDevice]) {
        let Ok(mut map) = self.last_seen_rssi.try_lock() else {
            return;
        };
        for d in devices {
            if let Some(rssi) = d.rssi {
                map.insert(d.address.to_ascii_lowercase(), rssi);
            }
        }
    }

    fn cached_rssi_for(&self, address: &str) -> Option<i16> {
        let key = address.to_ascii_lowercase();
        self.last_seen_rssi
            .try_lock()
            .ok()
            .and_then(|map| map.get(&key).copied())
    }
}

impl BleBackend for BtleplugBackend {
    async fn adapter_available(&self) -> Result<(), GattError> {
        match self.adapter.adapter_state().await {
            Ok(CentralState::PoweredOn) => Ok(()),
            Ok(_) => Err(GattError::new(
                GattErrorCode::AdapterMissing,
                "Bluetooth adapter is powered off",
            )),
            Err(e) => Err(GattError::new(
                GattErrorCode::AdapterMissing,
                format!("adapter state: {e}"),
            )),
        }
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
        self.scan_devices(filter, timeout_secs).await
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
        // The proxy's 45s HTTP budget also has to cover the bounded 5s cleanup.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(35);
        let peripheral =
            tokio::time::timeout_at(deadline, self.find_peripheral_scanning(profile, &key))
                .await
                .map_err(|_| {
                    GattError::new(GattErrorCode::ConnectTimeout, "peripheral lookup timed out")
                })??;
        let peripheral_id = Self::peripheral_id_str(&peripheral);
        let mut central_events = tokio::time::timeout_at(deadline, self.adapter.events())
            .await
            .map_err(|_| GattError::new(GattErrorCode::ConnectTimeout, "adapter events timed out"))?
            .map_err(|e| GattError::new(GattErrorCode::Internal, format!("adapter events: {e}")))?;

        let setup = async {
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
            let (write_uuid, notify_uuid, from_radio_uuid) = match profile {
                GattProfile::Meshtastic => (
                    profile::meshtastic::to_radio(),
                    profile::meshtastic::from_num(),
                    Some(profile::meshtastic::from_radio()),
                ),
                GattProfile::Meshcore | GattProfile::Rnode => {
                    (profile::nus::rx(), profile::nus::tx(), None)
                }
                GattProfile::Peer => {
                    return Err(GattError::new(
                        GattErrorCode::InvalidProfile,
                        "peer profile has no gatt pipe",
                    ));
                }
            };

            let find_char = |uuid, label| {
                chars
                    .iter()
                    .find(|c| c.uuid == uuid)
                    .cloned()
                    .ok_or_else(|| {
                        GattError::new(
                            GattErrorCode::GattDiscoverFailed,
                            format!("{label} characteristic missing"),
                        )
                    })
            };
            let write_char = find_char(write_uuid, "write")?;
            let write_type = characteristic_write_type(write_char.properties)?;
            let notify_char = find_char(notify_uuid, "notify")?;
            let from_radio_char = from_radio_uuid
                .map(|uuid| find_char(uuid, "fromRadio"))
                .transpose()?;

            // Subscribe the receiver before CCCD so early notifications stay queued.
            let notifications = peripheral.notifications().await.map_err(|e| {
                GattError::new(GattErrorCode::Internal, format!("notifications: {e}"))
            })?;
            tokio::time::timeout(discovery_timeout(), peripheral.subscribe(&notify_char))
                .await
                .map_err(|_| {
                    GattError::new(GattErrorCode::GattDiscoverFailed, "subscribe timed out")
                })?
                .map_err(|e| {
                    GattError::new(GattErrorCode::GattDiscoverFailed, format!("subscribe: {e}"))
                })?;
            let seed_rssi = peripheral
                .properties()
                .await
                .ok()
                .flatten()
                .and_then(|p| p.rssi)
                .or_else(|| self.cached_rssi_for(&key));
            Ok((
                write_char,
                write_type,
                notify_uuid,
                from_radio_char,
                notifications,
                seed_rssi,
            ))
        };
        let setup_until_disconnect = async {
            tokio::select! {
                result = tokio::time::timeout_at(deadline, setup) => {
                    result.unwrap_or_else(|_| Err(GattError::new(GattErrorCode::ConnectTimeout, "GATT setup timed out")))
                },
                reason = wait_for_disconnect(&mut central_events, &peripheral_id) => {
                    Err(GattError::new(GattErrorCode::GattDiscoverFailed, reason))
                }
            }
        };
        let (write_char, write_type, notify_uuid, from_radio_char, mut notifications, seed_rssi) =
            setup_with_cleanup(setup_until_disconnect, peripheral.disconnect()).await?;

        let (tx, rx) = mpsc::unbounded_channel();
        if let Some(rssi) = seed_rssi {
            let _ = tx.send(BackendEvent::Rssi(rssi));
        }
        let read_request = Arc::new(Notify::new());
        if from_radio_char.is_some() {
            read_request.notify_one();
        }
        let reads_for_events = Arc::clone(&read_request);
        let peripheral_for_events = peripheral.clone();
        let event_task = tokio::spawn(async move {
            let forward_notifications = async {
                while let Some(notification) = notifications.next().await {
                    if notification.uuid != notify_uuid {
                        continue;
                    }
                    if from_radio_char.is_some() {
                        reads_for_events.notify_one();
                    } else if tx.send(BackendEvent::Bytes(notification.value)).is_err() {
                        break;
                    }
                }
            };
            let drain_reads = async {
                loop {
                    reads_for_events.notified().await;
                    if let Some(ref from_radio) = from_radio_char {
                        let _ =
                            drain_meshtastic_from_radio(&peripheral_for_events, from_radio, &tx)
                                .await;
                    }
                }
            };
            let poll_rssi = async {
                let mut last = seed_rssi;
                loop {
                    tokio::time::sleep(Duration::from_secs(4)).await;
                    if let Some(rssi) = peripheral_for_events
                        .properties()
                        .await
                        .ok()
                        .flatten()
                        .and_then(|p| p.rssi)
                    {
                        last = Some(rssi);
                    }
                    if let Some(rssi) = last {
                        if tx.send(BackendEvent::Rssi(rssi)).is_err() {
                            break;
                        }
                    }
                }
            };
            // Notifications survive disconnects in btleplug. Central events must also
            // interrupt a pending FromRadio read, while Notify coalesces queue drains.
            let reason = tokio::select! {
                reason = wait_for_disconnect(&mut central_events, &peripheral_id) => reason,
                () = forward_notifications => "notifications_ended",
                () = drain_reads => "read_pump_ended",
                () = poll_rssi => "rssi_poll_ended",
                () = tx.closed() => return,
            };
            let _ = tx.send(BackendEvent::Disconnected {
                reason: reason.into(),
            });
        });

        let conn = BackendConnId(Uuid::new_v4().to_string());
        self.open.lock().await.insert(
            conn.0.clone(),
            OpenConn {
                peripheral,
                write_char,
                last_rssi: seed_rssi,
                write_type,
                write_lock: Arc::new(Mutex::new(())),
                read_request,
                meshtastic: profile == GattProfile::Meshtastic,
                event_task,
            },
        );
        Ok((conn, rx, None))
    }

    async fn write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        let (peripheral, write_char, write_type, write_lock, read_request, meshtastic) = {
            let open = self.open.lock().await;
            let session = open
                .get(&conn.0)
                .ok_or_else(|| GattError::new(GattErrorCode::SessionNotFound, "not connected"))?;
            (
                session.peripheral.clone(),
                session.write_char.clone(),
                session.write_type,
                Arc::clone(&session.write_lock),
                Arc::clone(&session.read_request),
                session.meshtastic,
            )
        };
        let _write = write_lock.lock().await;
        peripheral
            .write(&write_char, payload, write_type)
            .await
            .map_err(|err| {
                GattError::new(GattErrorCode::WriteFailed, format!("write failed: {err}"))
            })?;
        if meshtastic {
            read_request.notify_one();
        }
        Ok(())
    }

    async fn disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        let peripheral = {
            let open = self.open.lock().await;
            let Some(session) = open.get(&conn.0) else {
                return Ok(());
            };
            session.event_task.abort();
            session.peripheral.clone()
        };
        tokio::time::timeout(Duration::from_secs(5), async {
            if !peripheral.is_connected().await? {
                return Ok(());
            }
            peripheral.disconnect().await
        })
        .await
        .map_err(|_| GattError::new(GattErrorCode::Internal, "disconnect timed out"))?
        .map_err(|e: btleplug::Error| {
            GattError::new(GattErrorCode::Internal, format!("disconnect: {e}"))
        })?;
        self.open.lock().await.remove(&conn.0);
        Ok(())
    }

    async fn rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        let mut open = self.open.lock().await;
        let session = open
            .get_mut(&conn.0)
            .ok_or_else(|| GattError::new(GattErrorCode::SessionNotFound, "not connected"))?;
        if let Some(rssi) = session
            .peripheral
            .properties()
            .await
            .ok()
            .flatten()
            .and_then(|p| p.rssi)
        {
            session.last_rssi = Some(rssi);
            return Ok(rssi);
        }
        session
            .last_rssi
            .ok_or_else(|| GattError::new(GattErrorCode::Internal, "rssi unavailable"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn scans_wait_for_cleanup_after_completion_and_cancellation() {
        for cancel in [false, true] {
            let lock = Arc::new(Mutex::new(()));
            let started = Arc::new(Notify::new());
            let finish_scan = Arc::new(Notify::new());
            let cleanup_started = Arc::new(Notify::new());
            let finish_cleanup = Arc::new(Notify::new());
            let first = tokio::spawn({
                let lock = Arc::clone(&lock);
                let started = Arc::clone(&started);
                let finish_scan = Arc::clone(&finish_scan);
                let cleanup_started = Arc::clone(&cleanup_started);
                let finish_cleanup = Arc::clone(&finish_cleanup);
                async move {
                    serialized_scan(
                        &lock,
                        async {
                            started.notify_one();
                            finish_scan.notified().await;
                            Ok(())
                        },
                        async move {
                            cleanup_started.notify_one();
                            finish_cleanup.notified().await;
                        },
                    )
                    .await
                }
            });
            started.notified().await;
            let second_started = Arc::new(Notify::new());
            let second = tokio::spawn({
                let second_started = Arc::clone(&second_started);
                async move {
                    serialized_scan(
                        &lock,
                        async {
                            second_started.notify_one();
                            Ok(())
                        },
                        async {},
                    )
                    .await
                }
            });
            assert!(
                tokio::time::timeout(Duration::from_millis(1), second_started.notified())
                    .await
                    .is_err()
            );
            if cancel {
                first.abort();
            } else {
                finish_scan.notify_one();
            }
            cleanup_started.notified().await;
            assert!(
                tokio::time::timeout(Duration::from_millis(1), second_started.notified())
                    .await
                    .is_err()
            );
            finish_cleanup.notify_one();
            second.await.unwrap().unwrap();
            let first_result = first.await;
            if cancel {
                assert!(first_result.unwrap_err().is_cancelled());
            } else {
                first_result.unwrap().unwrap();
            }
        }
    }

    #[test]
    fn write_requests_prefer_the_advertised_response_mode() {
        assert_eq!(
            characteristic_write_type(CharPropFlags::WRITE).unwrap(),
            WriteType::WithResponse
        );
        assert_eq!(
            characteristic_write_type(CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE)
                .unwrap(),
            WriteType::WithResponse
        );
        assert_eq!(
            characteristic_write_type(CharPropFlags::WRITE_WITHOUT_RESPONSE).unwrap(),
            WriteType::WithoutResponse
        );
        assert!(characteristic_write_type(CharPropFlags::READ).is_err());
    }

    #[tokio::test]
    async fn setup_failure_disconnects_and_preserves_the_original_error() {
        let disconnected = AtomicBool::new(false);
        let result: Result<(), GattError> = setup_with_cleanup(
            async {
                Err(GattError::new(
                    GattErrorCode::GattDiscoverFailed,
                    "subscribe failed",
                ))
            },
            async {
                disconnected.store(true, Ordering::SeqCst);
                Err(btleplug::Error::NotConnected)
            },
        )
        .await;
        assert!(disconnected.load(Ordering::SeqCst));
        assert_eq!(result.unwrap_err().message, "subscribe failed");
    }

    #[tokio::test]
    async fn successful_setup_keeps_the_peripheral_connected() {
        let disconnected = AtomicBool::new(false);
        setup_with_cleanup(async { Ok(()) }, async {
            disconnected.store(true, Ordering::SeqCst);
            Ok(())
        })
        .await
        .unwrap();
        assert!(!disconnected.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn setup_error_cleanup_has_a_deadline() {
        let result: Result<(), GattError> = setup_with_cleanup(
            async {
                Err(GattError::new(
                    GattErrorCode::ConnectTimeout,
                    "connect failed",
                ))
            },
            std::future::pending(),
        )
        .await;
        assert_eq!(result.unwrap_err().code, GattErrorCode::ConnectTimeout);
    }

    #[tokio::test]
    async fn adapter_power_off_reports_disconnect_without_ending_notifications() {
        let mut events = futures_util::stream::iter([
            CentralEvent::StateUpdate(CentralState::PoweredOn),
            CentralEvent::StateUpdate(CentralState::PoweredOff),
        ])
        .chain(futures_util::stream::pending());
        assert_eq!(
            wait_for_disconnect(&mut events, "device").await,
            "adapter_powered_off"
        );
    }

    // CoreBluetooth exposes UUID construction; BlueZ's PeripheralId constructor is private.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn physical_disconnect_ignores_other_peripherals() {
        let target = Uuid::new_v4();
        let mut events = futures_util::stream::iter([
            CentralEvent::DeviceDisconnected(Uuid::new_v4().into()),
            CentralEvent::DeviceDisconnected(target.into()),
        ])
        .chain(futures_util::stream::pending());
        assert_eq!(
            wait_for_disconnect(&mut events, &target.to_string()).await,
            "link_lost"
        );
    }
}
