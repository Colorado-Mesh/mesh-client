//! Encode NomadNet link request data (`field_*` / `var_*` map) for RNS link REQUEST payloads.
//!
//! Wire MessagePack encoding lives in `nomad-core` (`encode_request_fields`,
//! `encode_media_request`). This module translates mesh-client HTTP shapes.

use std::collections::BTreeMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use nomad_core::{encode_media_request, encode_request_fields};
use rns_link::link::decode_single_value;

/// MessagePack value for Reticulum Link REQUEST slot 3 (NomadNet `data` / form map).
///
/// Pre-encoded nomad-core bodies are a single top-level map; [`rns_runtime::link_session::LinkSessionHandle::request`]
/// would wrap them as `Binary`, which breaks Python NomadNet (`isinstance(data, dict)`).
pub fn nomad_link_request_data_value(payload: &[u8]) -> rmpv::Value {
    if payload.is_empty() {
        return rmpv::Value::Nil;
    }
    decode_single_value(payload).unwrap_or_else(|| rmpv::Value::Binary(payload.to_vec()))
}

/// Decode base64 JSON object into msgpack map bytes for a Nomad Link REQUEST body.
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

/// Encode NomadNet `/media` request body: msgpack map `{path, key: nil}`.
pub fn nomad_media_request_payload(path: &str) -> Vec<u8> {
    encode_media_request(path)
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
        assert!(!payload.is_empty(), "{payload:?}");

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
        assert!(
            nomad_page_request_payload(None).is_empty(),
            "{:?}",
            nomad_page_request_payload(None)
        );
        assert!(
            nomad_page_request_payload(Some("")).is_empty(),
            "{:?}",
            nomad_page_request_payload(Some(""))
        );
        assert!(
            nomad_page_request_payload(Some("not-base64!!!")).is_empty(),
            "{:?}",
            nomad_page_request_payload(Some("not-base64!!!"))
        );
    }

    #[test]
    fn link_request_value_is_map_not_binary_wrapper() {
        let mut fields = BTreeMap::new();
        fields.insert("field_q".into(), "hello".into());
        fields.insert("var_mode".into(), "search".into());
        let payload = encode_request_fields(&fields);
        let value = super::nomad_link_request_data_value(&payload);
        let rmpv::Value::Map(map) = value else {
            panic!("expected map for NomadNet parity, got {value:?}");
        };
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn link_request_value_empty_payload_is_nil() {
        assert!(matches!(
            super::nomad_link_request_data_value(&[]),
            rmpv::Value::Nil
        ));
    }

    #[test]
    fn link_request_value_forum_cat_and_thread_is_map() {
        let mut fields = BTreeMap::new();
        fields.insert("var_cat".into(), "general".into());
        fields.insert("var_thread".into(), "rns-161-released".into());
        let payload = encode_request_fields(&fields);
        let value = super::nomad_link_request_data_value(&payload);
        let rmpv::Value::Map(map) = value else {
            panic!("expected map for forum vars, got {value:?}");
        };
        let mut cat = None;
        let mut thread = None;
        for (k, v) in map {
            let name = match k {
                rmpv::Value::String(s) => s.as_str().map(str::to_owned),
                _ => None,
            };
            let text = match v {
                rmpv::Value::String(s) => s.as_str().map(str::to_owned),
                _ => None,
            };
            match name.as_deref() {
                Some("var_cat") => cat = text,
                Some("var_thread") => thread = text,
                _ => {}
            }
        }
        assert_eq!(cat.as_deref(), Some("general"));
        assert_eq!(thread.as_deref(), Some("rns-161-released"));
    }

    #[test]
    fn media_request_encodes_path_with_nil_key() {
        let payload = nomad_media_request_payload("/media/header.webp");
        assert!(!payload.is_empty(), "{payload:?}");
        let value: rmpv::Value = rmpv::decode::read_value(&mut payload.as_slice()).unwrap();
        let rmpv::Value::Map(map) = value else {
            panic!("expected map");
        };
        let mut path = None;
        let mut key_is_nil = false;
        for (k, v) in map {
            let name = match k {
                rmpv::Value::String(s) => s.as_str().map(str::to_owned),
                _ => None,
            };
            match name.as_deref() {
                Some("path") => {
                    path = match v {
                        rmpv::Value::String(s) => s.as_str().map(str::to_owned),
                        _ => None,
                    };
                }
                Some("key") => key_is_nil = matches!(v, rmpv::Value::Nil),
                _ => {}
            }
        }
        assert_eq!(path.as_deref(), Some("/media/header.webp"));
        assert!(key_is_nil, "NomadNet 1.4.1 media requests require key: Nil");
    }
}
