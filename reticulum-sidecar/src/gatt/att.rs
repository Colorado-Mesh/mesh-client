//! GATT characteristic values must preserve the radio's packet boundary.

use super::error::{GattError, GattErrorCode};

pub const BLE_GATT_VALUE_MAX_BYTES: usize = 512;

pub fn validate_write_payload(payload: &[u8]) -> Result<(), GattError> {
    if payload.len() > BLE_GATT_VALUE_MAX_BYTES {
        return Err(GattError::new(
            GattErrorCode::WriteFailed,
            format!("GATT frame exceeds {BLE_GATT_VALUE_MAX_BYTES} bytes"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_full_length_characteristic_values() {
        assert!(validate_write_payload(&[0; 512]).is_ok());
    }

    #[test]
    fn rejects_values_beyond_the_gatt_limit() {
        assert_eq!(
            validate_write_payload(&[0; 513]).unwrap_err().code,
            GattErrorCode::WriteFailed
        );
    }
}
