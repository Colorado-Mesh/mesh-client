//! Decode Reticulum private identity material (64-byte wire format).

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};

pub const RNS_PRIVATE_KEY_LEN: usize = 64;

const BASE32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

fn base32_value(ch: u8) -> Option<u8> {
    match ch {
        b'A'..=b'Z' => Some(ch - b'A'),
        b'a'..=b'z' => Some(ch - b'a'),
        b'2'..=b'7' => Some(ch - b'2' + 26),
        _ => None,
    }
}

/// Decode RFC 4648 base32 (Ratspeak / Python `rnid -B`), ignoring whitespace and `-`.
pub fn decode_base32_private_key(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    let mut saw_padding = false;

    for ch in text.bytes() {
        if ch.is_ascii_whitespace() || ch == b'-' {
            continue;
        }
        if ch == b'=' {
            saw_padding = true;
            continue;
        }
        if saw_padding {
            return Err("Invalid base32 private key padding".into());
        }
        let value =
            base32_value(ch).ok_or_else(|| "Invalid base32 private key data".to_string())?;
        buffer = (buffer << 5) | u32::from(value);
        bits += 5;
        while bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
            if bits > 0 {
                buffer &= (1 << bits) - 1;
            } else {
                buffer = 0;
            }
        }
    }

    Ok(out)
}

/// Encode bytes as padded RFC 4648 base32 (uppercase), matching Ratspeak / rnid.
pub fn encode_base32_padded(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;

    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buffer >> bits) & 0x1f) as usize] as char);
            if bits > 0 {
                buffer &= (1 << bits) - 1;
            } else {
                buffer = 0;
            }
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buffer << (5 - bits)) & 0x1f) as usize] as char);
    }
    while !out.is_empty() && out.len() % 8 != 0 {
        out.push('=');
    }
    out
}

/// Decode user-supplied private key text: 128-char hex, base64/base64url, or base32 (64 decoded bytes).
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

    if let Ok(bytes) = decode_base32_private_key(trimmed) {
        if let Ok(key) = bytes_to_key(&bytes) {
            return Ok(key);
        }
    }

    Err(format!(
        "private key must be {RNS_PRIVATE_KEY_LEN} bytes as 128-char hex, base64, or base32"
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
    fn decode_urlsafe_base64_private_key() {
        let raw = [0x11u8; RNS_PRIVATE_KEY_LEN];
        let b64 = URL_SAFE.encode(raw);
        let decoded = decode_private_key_input(&b64).unwrap();
        assert_eq!(decoded, raw);
    }

    #[test]
    fn base32_round_trip() {
        let raw = [0x5au8; RNS_PRIVATE_KEY_LEN];
        let encoded = encode_base32_padded(&raw);
        let decoded = decode_private_key_input(&encoded).unwrap();
        assert_eq!(decoded, raw);
    }

    #[test]
    fn reject_wrong_length() {
        assert!(decode_private_key_input("abcd").is_err());
        assert!(decode_private_key_bytes(&[1, 2, 3]).is_err());
    }
}
