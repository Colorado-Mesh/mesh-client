//! ATT MTU helpers (mirrors src/shared/bleAttWriteLimit.ts).

pub const ATT_MTU_DEFAULT: u16 = 23;
pub const ATT_MTU_MAX: u16 = 517;
pub const BLE_TO_RADIO_PAYLOAD_CAP: usize = 512;

pub fn att_mtu_or_default(mtu: Option<u16>) -> u16 {
    match mtu {
        Some(n) if n >= ATT_MTU_DEFAULT => n.min(ATT_MTU_MAX),
        _ => ATT_MTU_DEFAULT,
    }
}

pub fn max_write_request_payload_bytes(mtu: Option<u16>) -> usize {
    let overhead = 3usize;
    let room = usize::from(att_mtu_or_default(mtu)).saturating_sub(overhead);
    room.min(BLE_TO_RADIO_PAYLOAD_CAP)
}

pub fn chunk_payload(payload: &[u8], mtu: Option<u16>) -> Vec<Vec<u8>> {
    let chunk = max_write_request_payload_bytes(mtu).max(1);
    payload.chunks(chunk).map(<[u8]>::to_vec).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coerces_sub_23_mtu() {
        assert_eq!(att_mtu_or_default(Some(20)), ATT_MTU_DEFAULT);
        assert_eq!(max_write_request_payload_bytes(Some(23)), 20);
    }

    #[test]
    fn chunks_large_payload() {
        let data = vec![0u8; 50];
        let parts = chunk_payload(&data, Some(23));
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].len(), 20);
        assert_eq!(parts[2].len(), 10);
    }
}
