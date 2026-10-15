//! Per-message radio evidence for destination-encrypted (opportunistic) LXMF.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use rns_transport::messages::{PacketTapDirection, PacketTapEvent};
use rns_wire::flags::{DestinationType, PacketType};
use rns_wire::header::PacketHeader;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::types::InterfaceRow;
use super::via::classify_interface_row;

const MAX_OBSERVATIONS: usize = 256;

/// apply_interfaces only starts/stops BLE Peers; other live interface types stay unchanged.
pub fn refresh_ble_peer_reception_interfaces(
    current: &mut Vec<InterfaceRow>,
    configured: &[InterfaceRow],
) {
    current.retain(|row| row.iface_type != "ble_peer");
    current.extend(
        configured
            .iter()
            .filter(|row| row.iface_type == "ble_peer" && row.enabled)
            .cloned(),
    );
}

#[derive(Clone, Serialize)]
pub struct RadioReception {
    #[serde(rename = "rx_radio_transport")]
    pub transport: &'static str,
    #[serde(rename = "rx_hops")]
    pub hops: u8,
    #[serde(rename = "rx_snr")]
    pub snr: Option<f32>,
    #[serde(rename = "rx_rssi")]
    pub rssi: Option<f32>,
}

#[derive(Default)]
struct Observations {
    frames: HashMap<[u8; 32], RadioReception>,
    order: VecDeque<[u8; 32]>,
}

#[derive(Default)]
pub struct LxmfReception {
    observations: Mutex<Observations>,
    /// Only populated while invoking the synchronous router callback under its lock.
    current: Mutex<Option<([u8; 32], RadioReception)>>,
}

impl LxmfReception {
    pub fn observe(
        &self,
        event: &PacketTapEvent,
        local_destination: [u8; 16],
        interfaces: &[InterfaceRow],
    ) {
        if !matches!(event.direction, PacketTapDirection::Rx) {
            return;
        }
        let Ok((header, _)) = PacketHeader::unpack(&event.raw) else {
            return;
        };
        if header.flags.packet_type != PacketType::Data
            || header.flags.destination_type != DestinationType::Single
            || header.destination_hash != local_destination
        {
            return;
        }
        // Require a configured interface type. A peer's route or a guessed name is not ingress.
        let Some(interface) = interfaces.iter().find(|row| {
            row.name.eq_ignore_ascii_case(&event.interface_name)
                || row.id.eq_ignore_ascii_case(&event.interface_name)
        }) else {
            return;
        };
        let Some(kind) = super::interface_catalog::INTERFACE_CATALOG.get(&interface.iface_type)
        else {
            return;
        };
        if !matches!(kind.classify.as_str(), "rf" | "ble") {
            return;
        }
        let via = classify_interface_row(
            &interface.iface_type,
            &interface.name,
            interface.serial_port.as_deref(),
        );
        if via != "rf" && via != "ble" {
            return;
        }
        let reception = RadioReception {
            transport: via,
            hops: header.hops,
            snr: event.snr.filter(|value| value.is_finite()),
            rssi: event.rssi.filter(|value| value.is_finite()),
        };
        if let Ok(mut observations) = self.observations.lock() {
            let key: [u8; 32] = Sha256::digest(&event.raw).into();
            if observations.frames.contains_key(&key) {
                return;
            }
            if observations.order.len() >= MAX_OBSERVATIONS
                && let Some(oldest) = observations.order.pop_front()
            {
                observations.frames.remove(&oldest);
            }
            observations.order.push_back(key);
            observations.frames.insert(key, reception);
        }
    }

    /// Bind only the exact encrypted frame successfully unpacked as this LXMF message.
    /// A missing/lagged tap is deliberately unavailable; link/resource/propagated delivery
    /// never installs this context because it cannot bind one frame to the message.
    pub fn with_message(&self, hash: Option<[u8; 32]>, raw: &[u8], deliver: impl FnOnce()) {
        let reception = self.observations.lock().ok().and_then(|observations| {
            observations
                .frames
                .get(&<[u8; 32]>::from(Sha256::digest(raw)))
                .cloned()
        });
        if let Ok(mut current) = self.current.lock() {
            *current = hash.zip(reception);
        }
        deliver();
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
    }

    pub fn take(&self, hash: Option<[u8; 32]>) -> Option<RadioReception> {
        let mut current = self.current.lock().ok()?;
        if current.as_ref().map(|(key, _)| *key) == hash {
            current.take().map(|(_, reception)| reception)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rns_wire::context::PacketContext;
    use rns_wire::flags::{HeaderType, PacketFlags, TransportType};

    pub(super) fn interface(kind: &str) -> InterfaceRow {
        serde_json::from_value(serde_json::json!({
            "id": "radio", "name": "radio", "type": kind, "enabled": true, "status": "up"
        }))
        .unwrap()
    }

    pub(super) fn event(raw: &[u8]) -> PacketTapEvent {
        PacketTapEvent::from_wire(
            PacketTapDirection::Rx,
            1,
            "radio".into(),
            raw,
            Some(-98.0),
            Some(0.0),
            None,
        )
    }

    fn raw() -> Vec<u8> {
        let mut raw = PacketHeader {
            flags: PacketFlags {
                header_type: HeaderType::Header1,
                context_flag: false,
                transport_type: TransportType::Broadcast,
                destination_type: DestinationType::Single,
                packet_type: PacketType::Data,
            },
            hops: 2,
            transport_id: None,
            destination_hash: [1; 16],
            context: PacketContext::None,
        }
        .pack();
        raw.extend_from_slice(b"encrypted message");
        raw
    }

    #[test]
    fn runtime_ble_peer_updates_reach_the_tap_before_reception() {
        let interfaces = std::sync::Arc::new(Mutex::new(Vec::new()));
        let tap_interfaces = interfaces.clone();
        let reception = LxmfReception::default();
        let raw = raw();
        reception.observe(&event(&raw), [1; 16], &tap_interfaces.lock().unwrap());
        reception.with_message(Some([2; 32]), &raw, || {
            assert!(reception.take(Some([2; 32])).is_none());
        });

        let mut peer = interface("ble_peer");
        refresh_ble_peer_reception_interfaces(
            &mut interfaces.lock().unwrap(),
            std::slice::from_ref(&peer),
        );
        reception.observe(&event(&raw), [1; 16], &tap_interfaces.lock().unwrap());
        reception.with_message(Some([2; 32]), &raw, || {
            assert_eq!(reception.take(Some([2; 32])).unwrap().transport, "ble");
        });

        peer.enabled = false;
        refresh_ble_peer_reception_interfaces(&mut interfaces.lock().unwrap(), &[peer]);
        let mut later = raw.clone();
        later.push(1);
        reception.observe(&event(&later), [1; 16], &tap_interfaces.lock().unwrap());
        reception.with_message(Some([3; 32]), &later, || {
            assert!(reception.take(Some([3; 32])).is_none());
        });
    }

    #[test]
    fn runtime_refresh_does_not_reclassify_ordinary_live_interfaces() {
        let mut interfaces = vec![interface("tcp"), interface("ble_peer")];
        refresh_ble_peer_reception_interfaces(&mut interfaces, &[interface("rnode")]);
        assert_eq!(interfaces.len(), 1);
        assert_eq!(interfaces[0].iface_type, "tcp");
        let reception = LxmfReception::default();
        let raw = raw();
        reception.observe(&event(&raw), [1; 16], &interfaces);
        reception.with_message(Some([2; 32]), &raw, || {
            assert!(reception.take(Some([2; 32])).is_none());
        });
    }

    #[test]
    fn binds_only_exact_rx_frame_and_message_hash_then_clears_context() {
        let reception = LxmfReception::default();
        let raw = raw();
        reception.observe(&event(&raw), [1; 16], &[interface("rnode")]);
        reception.with_message(Some([2; 32]), &raw, || {
            assert!(reception.take(Some([3; 32])).is_none());
            let stats = serde_json::to_value(reception.take(Some([2; 32])).unwrap()).unwrap();
            assert_eq!(stats["rx_radio_transport"], "rf");
            assert_eq!(stats["rx_snr"], 0.0);
            assert_eq!(stats["rx_rssi"], -98.0);
            assert_eq!(stats["rx_hops"], 2);
        });
        assert!(reception.take(Some([2; 32])).is_none());
        let mut different = raw.clone();
        different.push(1);
        reception.with_message(Some([2; 32]), &different, || {
            assert!(reception.take(Some([2; 32])).is_none());
        });
        reception.with_message(Some([2; 32]), &raw, || {});
        assert!(reception.take(Some([2; 32])).is_none());
    }

    #[test]
    fn rejects_tcp_named_radio_tx_unknown_interfaces_and_other_destinations() {
        let raw = raw();
        let reception = LxmfReception::default();
        reception.observe(&event(&raw), [1; 16], &[interface("tcp")]);
        for kind in ["tcp", "auto", "unknown"] {
            let mut named = interface(kind);
            named.name = "LoRa bridge".into();
            let mut packet = event(&raw);
            packet.interface_name.clone_from(&named.name);
            reception.observe(&packet, [1; 16], &[named]);
        }
        reception.observe(&event(&raw), [1; 16], &[]);
        reception.observe(&event(&raw), [9; 16], &[interface("rnode")]);
        let mut tx = event(&raw);
        tx.direction = PacketTapDirection::Tx;
        reception.observe(&tx, [1; 16], &[interface("rnode")]);
        reception.with_message(Some([2; 32]), &raw, || {
            assert!(reception.take(Some([2; 32])).is_none());
        });
    }

    #[test]
    fn ble_is_explicit_and_non_finite_measurements_are_unavailable() {
        let raw = raw();
        let reception = LxmfReception::default();
        let mut ble = interface("rnode");
        ble.serial_port = Some("ble://peer".into());
        let mut packet = event(&raw);
        packet.snr = Some(f32::NAN);
        packet.rssi = Some(f32::INFINITY);
        reception.observe(&packet, [1; 16], &[ble]);
        reception.with_message(Some([2; 32]), &raw, || {
            let stats = reception.take(Some([2; 32])).unwrap();
            assert_eq!(stats.transport, "ble");
            assert!(stats.snr.is_none());
            assert!(stats.rssi.is_none());
        });
    }

    #[test]
    fn frame_cache_is_bounded_and_keeps_first_radio_measurements() {
        let reception = LxmfReception::default();
        let original = raw();
        let interfaces = [interface("rnode")];
        reception.observe(&event(&original), [1; 16], &interfaces);
        let mut repeat = event(&original);
        repeat.snr = Some(20.0);
        reception.observe(&repeat, [1; 16], &interfaces);
        reception.with_message(Some([2; 32]), &original, || {
            let stats = serde_json::to_value(reception.take(Some([2; 32]))).unwrap();
            assert_eq!(stats["rx_snr"], 0.0);
        });
        for index in 0..MAX_OBSERVATIONS {
            let mut frame = original.clone();
            frame.extend_from_slice(&index.to_be_bytes());
            reception.observe(&event(&frame), [1; 16], &interfaces);
        }
        reception.with_message(Some([2; 32]), &original, || {
            assert!(reception.take(Some([2; 32])).is_none());
        });
        assert_eq!(
            reception.observations.lock().unwrap().frames.len(),
            MAX_OBSERVATIONS
        );
    }
}
