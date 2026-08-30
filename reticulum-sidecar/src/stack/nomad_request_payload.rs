//! Encode NomadNet link request data (`field_*` / `var_*` map) for RNS link REQUEST payloads.
//!
//! Wire MessagePack encoding lives in `nomad-core` (`encode_request_fields`).
//! This module only translates the mesh-client HTTP `data` (base64 JSON) shape.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use nomad_core::encode_request_fields;

/// Decode base64 JSON object into msgpack map bytes for `LinkClient::query` payload.
pub fn nomad_page_request_payload(data_b64: Option<&str>) -> Vec<u8> {
    let Some(b64) = data_b64.filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    let Ok(json_bytes) = BASE64.decode(b64) else {
        return Vec::new();
    };
    let Ok(fields) = serde_json::from_slice::<BTreeMap<String, String>>(&json_bytes) else {
        return Vec::new();
    };
    encode_request_fields(&fields)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nomad_core::decode_request_fields;

    #[test]
    fn encodes_request_data_as_msgpack_map() {
        let json = br#"{"field_q":"hello","var_mode":"search"}"#;
        let b64 = BASE64.encode(json);
        let payload = nomad_page_request_payload(Some(&b64));
        assert!(!payload.is_empty());

        let value: rmpv::Value = rmpv::decode::read_value(&mut payload.as_slice()).unwrap();
        let rmpv::Value::Map(map) = value else {
            panic!("expected map");
        };
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn encode_round_trips_through_nomad_core_decode() {
        let json = br#"{"field_q":"hello","var_mode":"search"}"#;
        let b64 = BASE64.encode(json);
        let payload = nomad_page_request_payload(Some(&b64));
        let parsed = decode_request_fields(&payload).unwrap();
        assert_eq!(
            parsed.fields.get("field_q").map(String::as_str),
            Some("hello")
        );
        assert_eq!(
            parsed.fields.get("var_mode").map(String::as_str),
            Some("search")
        );
    }

    #[test]
    fn empty_when_data_missing_or_invalid() {
        assert!(nomad_page_request_payload(None).is_empty());
        assert!(nomad_page_request_payload(Some("")).is_empty());
        assert!(nomad_page_request_payload(Some("not-base64!!!")).is_empty());
    }
}
