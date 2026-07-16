//! Decode Reticulum private identity material (64-byte wire format).

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};

pub const RNS_PRIVATE_KEY_LEN: usize = 64;

/// Decode user-supplied private key text: 128-char hex or base64/base64url (64 decoded bytes).
pub fn decode_private_key_input(input: &str) -> Result<[u8; RNS_PRIVATE_KEY_LEN], String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("private key is empty".into());
    }

    if trimmed.len() == RNS_PRIVATE_KEY_LEN * 2 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        let bytes = hex::decode(trimmed).map_err(|e| format!("invalid hex private key: {e}"))?;
        return bytes_to_key(&bytes);
    }

    for engine in [STANDARD, URL_SAFE, URL_SAFE_NO_PAD] {
        if let Ok(bytes) = engine.decode(trimmed.as_bytes()) {
            if let Ok(key) = bytes_to_key(&bytes) {
                return Ok(key);
            }
        }
    }

    Err(format!(
        "private key must be {RNS_PRIVATE_KEY_LEN} bytes as 128-char hex or base64"
    ))
}

/// Decode exactly 64 raw bytes (e.g. from Electron file picker).
#[allow(dead_code)] // binary import API used by identity_import_private_bytes
pub fn decode_private_key_bytes(data: &[u8]) -> Result<[u8; RNS_PRIVATE_KEY_LEN], String> {
    bytes_to_key(data)
}

fn bytes_to_key(bytes: &[u8]) -> Result<[u8; RNS_PRIVATE_KEY_LEN], String> {
    if bytes.len() != RNS_PRIVATE_KEY_LEN {
        return Err(format!(
            "invalid private key length: expected {RNS_PRIVATE_KEY_LEN}, got {}",
            bytes.len()
        ));
    }
    let mut key = [0u8; RNS_PRIVATE_KEY_LEN];
    key.copy_from_slice(bytes);
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_hex_private_key() {
        let raw = [0x42u8; RNS_PRIVATE_KEY_LEN];
        let hex = hex::encode(raw);
        let decoded = decode_private_key_input(&hex).unwrap();
        assert_eq!(decoded, raw);
    }

    #[test]
    fn decode_base64_private_key() {
        let raw = [0x7au8; RNS_PRIVATE_KEY_LEN];
        let b64 = STANDARD.encode(raw);
        let decoded = decode_private_key_input(&b64).unwrap();
        assert_eq!(decoded, raw);
    }

    #[test]
    fn reject_wrong_length() {
        assert!(decode_private_key_input("abcd").is_err());
        assert!(decode_private_key_bytes(&[1, 2, 3]).is_err());
    }
}
