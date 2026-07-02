use std::collections::VecDeque;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

pub const MAX_WIRE_PACKET_LOG: usize = 2500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WirePacketRow {
    pub ts: u64,
    pub direction: String,
    pub interface_id: u64,
    pub interface_name: String,
    pub raw_hex: String,
    pub rssi: Option<f32>,
    pub snr: Option<f32>,
    pub q: Option<f32>,
    pub packet_type: Option<String>,
    pub header_type: Option<String>,
    pub destination_hash: Option<String>,
    pub transport_type: Option<String>,
    pub context: Option<String>,
}

#[derive(Debug)]
pub struct PacketLogBuffer {
    max: usize,
    inner: Mutex<VecDeque<WirePacketRow>>,
}

impl PacketLogBuffer {
    pub fn new(max: usize) -> Self {
        Self {
            max,
            inner: Mutex::new(VecDeque::new()),
        }
    }

    pub fn push(&self, row: WirePacketRow) {
        if let Ok(mut buf) = self.inner.lock() {
            if buf.len() >= self.max {
                buf.pop_front();
            }
            buf.push_back(row);
        }
    }

    pub fn snapshot(&self, limit: usize) -> Vec<WirePacketRow> {
        self.inner
            .lock()
            .ok()
            .map(|buf| {
                let start = buf.len().saturating_sub(limit);
                buf.iter().skip(start).cloned().collect()
            })
            .unwrap_or_default()
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.inner.lock() {
            buf.clear();
        }
    }
}

pub fn emit_wire_packet_event(event_tx: &broadcast::Sender<String>, row: &WirePacketRow) {
    let msg = serde_json::json!({ "type": "wire_packet", "payload": row });
    let _ = event_tx.send(msg.to_string());
}

#[cfg(feature = "rns-stack")]
pub fn wire_packet_from_tap(evt: &rns_transport::messages::PacketTapEvent) -> WirePacketRow {
    use rns_transport::messages::PacketTapDirection;
    WirePacketRow {
        ts: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        direction: match evt.direction {
            PacketTapDirection::Rx => "rx".into(),
            PacketTapDirection::Tx => "tx".into(),
        },
        interface_id: evt.interface_id,
        interface_name: evt.interface_name.clone(),
        raw_hex: hex::encode(&evt.raw),
        rssi: evt.rssi,
        snr: evt.snr,
        q: evt.q,
        packet_type: evt.packet_type.clone(),
        header_type: evt.header_type.clone(),
        destination_hash: evt.destination_hash.map(hex::encode),
        transport_type: evt.transport_type.clone(),
        context: evt.context.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_drops_oldest_at_cap() {
        let buf = PacketLogBuffer::new(3);
        for i in 0..5 {
            buf.push(WirePacketRow {
                ts: i,
                direction: "rx".into(),
                interface_id: 1,
                interface_name: "test".into(),
                raw_hex: "aa".into(),
                rssi: None,
                snr: None,
                q: None,
                packet_type: None,
                header_type: None,
                destination_hash: None,
                transport_type: None,
                context: None,
            });
        }
        let snap = buf.snapshot(10);
        assert_eq!(snap.len(), 3);
        assert_eq!(snap[0].ts, 2);
        assert_eq!(snap[2].ts, 4);
    }
}
