//! RRC 0.1.3 CBOR wire codec (numeric map keys). Spec: https://rrc.kc1awv.net/

use std::collections::BTreeMap;
use std::io::Cursor;
use std::time::{SystemTime, UNIX_EPOCH};

use ciborium::value::Value;
use rand::RngCore;
use thiserror::Error;

pub const RRC_PROTOCOL_VERSION: u8 = 1;
pub const RRC_MSG_ID_LEN: usize = 8;
pub const RRC_IDENTITY_HASH_LEN: usize = 16;

pub mod msg_type {
    pub const HELLO: u8 = 1;
    pub const WELCOME: u8 = 2;
    pub const JOIN: u8 = 10;
    pub const JOINED: u8 = 11;
    pub const PART: u8 = 12;
    pub const PARTED: u8 = 13;
    pub const MSG: u8 = 20;
    pub const NOTICE: u8 = 21;
    pub const ACTION: u8 = 22;
    pub const PING: u8 = 30;
    pub const PONG: u8 = 31;
    pub const ERROR: u8 = 40;
}

/// rrcd WELCOME capability map keys (advisory bool values).
pub mod cap {
    pub const RESOURCE_ENVELOPE: u64 = 0;
    pub const ACTION: u64 = 1;
    pub const DIRECT_NOTICE: u64 = 2;
}

#[derive(Debug, Error)]
pub enum RrcCodecError {
    #[error("cbor encode failed: {0}")]
    Encode(String),
    #[error("cbor decode failed: {0}")]
    Decode(String),
    #[error("envelope missing required field {0}")]
    MissingField(&'static str),
    #[error("invalid field type for {0}")]
    BadType(&'static str),
}

#[derive(Debug, Clone, PartialEq)]
pub struct RrcEnvelope {
    pub version: u8,
    pub msg_type: u8,
    pub msg_id: [u8; RRC_MSG_ID_LEN],
    pub timestamp: u64,
    pub sender_identity: [u8; RRC_IDENTITY_HASH_LEN],
    pub room_name: Option<String>,
    pub body: Option<Value>,
    pub nickname: Option<String>,
    /// rrcd extension: K_DST = 8 — direct NOTICE destination identity.
    pub dst_identity: Option<[u8; RRC_IDENTITY_HASH_LEN]>,
}

impl RrcEnvelope {
    pub fn new(
        msg_type: u8,
        sender_identity: [u8; RRC_IDENTITY_HASH_LEN],
        room_name: Option<String>,
        body: Option<Value>,
        nickname: Option<String>,
    ) -> Self {
        let mut msg_id = [0u8; RRC_MSG_ID_LEN];
        rand::thread_rng().fill_bytes(&mut msg_id);
        Self {
            version: RRC_PROTOCOL_VERSION,
            msg_type,
            msg_id,
            timestamp: now_ms(),
            sender_identity,
            room_name,
            body,
            nickname,
            dst_identity: None,
        }
    }

    pub fn with_dst(mut self, dst: [u8; RRC_IDENTITY_HASH_LEN]) -> Self {
        self.dst_identity = Some(dst);
        self
    }
}

pub fn encode_envelope(env: &RrcEnvelope) -> Result<Vec<u8>, RrcCodecError> {
    let mut map = vec![
        (Value::Integer(0.into()), Value::Integer(env.version.into())),
        (
            Value::Integer(1.into()),
            Value::Integer(env.msg_type.into()),
        ),
        (Value::Integer(2.into()), Value::Bytes(env.msg_id.to_vec())),
        (
            Value::Integer(3.into()),
            Value::Integer(env.timestamp.into()),
        ),
        (
            Value::Integer(4.into()),
            Value::Bytes(env.sender_identity.to_vec()),
        ),
    ];
    if let Some(room) = &env.room_name {
        map.push((Value::Integer(5.into()), Value::Text(room.clone())));
    }
    if let Some(body) = &env.body {
        map.push((Value::Integer(6.into()), body.clone()));
    }
    if let Some(nick) = &env.nickname {
        map.push((Value::Integer(7.into()), Value::Text(nick.clone())));
    }
    if let Some(dst) = &env.dst_identity {
        map.push((Value::Integer(8.into()), Value::Bytes(dst.to_vec())));
    }
    let mut out = Vec::new();
    ciborium::into_writer(&Value::Map(map), &mut out)
        .map_err(|e| RrcCodecError::Encode(e.to_string()))?;
    Ok(out)
}

pub fn decode_envelope(bytes: &[u8]) -> Result<RrcEnvelope, RrcCodecError> {
    let value: Value = ciborium::from_reader(Cursor::new(bytes))
        .map_err(|e| RrcCodecError::Decode(e.to_string()))?;
    let Value::Map(entries) = value else {
        return Err(RrcCodecError::Decode("top-level must be a map".into()));
    };
    let mut fields: BTreeMap<u64, Value> = BTreeMap::new();
    for (k, v) in entries {
        if let Some(key) = integer_key(&k) {
            fields.insert(key, v);
        }
        // Unknown non-integer keys ignored per forward-compat rules.
    }

    let version = take_u8(&fields, 0, "version")?;
    let msg_type = take_u8(&fields, 1, "msg_type")?;
    let msg_id = take_fixed_bytes::<RRC_MSG_ID_LEN>(&fields, 2, "msg_id")?;
    let timestamp = take_u64(&fields, 3, "timestamp")?;
    let sender_identity = take_fixed_bytes::<RRC_IDENTITY_HASH_LEN>(&fields, 4, "sender_identity")?;
    let room_name = fields.get(&5).and_then(as_text).map(str::to_string);
    let body = fields.get(&6).cloned();
    let nickname = fields.get(&7).and_then(as_text).map(str::to_string);
    let dst_identity = fields.get(&8).and_then(|v| match v {
        Value::Bytes(b) if b.len() == RRC_IDENTITY_HASH_LEN => {
            let mut arr = [0u8; RRC_IDENTITY_HASH_LEN];
            arr.copy_from_slice(b);
            Some(arr)
        }
        _ => None,
    });

    Ok(RrcEnvelope {
        version,
        msg_type,
        msg_id,
        timestamp,
        sender_identity,
        room_name,
        body,
        nickname,
        dst_identity,
    })
}

pub fn hello_body(client_name: &str, client_version: &str) -> Value {
    Value::Map(vec![
        (Value::Integer(0.into()), Value::Text(client_name.into())),
        (Value::Integer(1.into()), Value::Text(client_version.into())),
    ])
}

pub fn text_body(text: &str) -> Value {
    Value::Text(text.to_string())
}

pub fn parse_welcome_hub_name(body: Option<&Value>) -> Option<String> {
    let Some(Value::Map(entries)) = body else {
        return None;
    };
    for (k, v) in entries {
        if integer_key(k) == Some(0) {
            return as_text(v).map(str::to_string);
        }
    }
    None
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RrcWelcomeCapabilities {
    pub direct_notice: bool,
    pub action: bool,
    pub resource_envelope: bool,
}

/// Parse WELCOME body key 2 (capabilities map with integer keys).
pub fn parse_welcome_capabilities(body: Option<&Value>) -> RrcWelcomeCapabilities {
    let mut out = RrcWelcomeCapabilities::default();
    let Some(Value::Map(entries)) = body else {
        return out;
    };
    let caps_value = entries.iter().find_map(|(k, v)| {
        if integer_key(k) == Some(2) {
            Some(v)
        } else {
            None
        }
    });
    let Some(caps_value) = caps_value else {
        return out;
    };
    match caps_value {
        Value::Map(caps) => {
            for (k, v) in caps {
                let Some(key) = integer_key(k) else { continue };
                let enabled = match v {
                    Value::Bool(b) => *b,
                    Value::Integer(i) => u64::try_from(*i).ok().unwrap_or(0) != 0,
                    _ => false,
                };
                if !enabled {
                    continue;
                }
                match key {
                    cap::DIRECT_NOTICE => out.direct_notice = true,
                    cap::ACTION => out.action = true,
                    cap::RESOURCE_ENVELOPE => out.resource_envelope = true,
                    _ => {}
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                if let Some(name) = as_text(item) {
                    match name.to_ascii_lowercase().as_str() {
                        "direct_notice" | "cap_direct_notice" => out.direct_notice = true,
                        "action" | "cap_action" => out.action = true,
                        "resource_envelope" | "cap_resource_envelope" => {
                            out.resource_envelope = true;
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }
    out
}

pub fn parse_joined_members(body: Option<&Value>) -> Vec<(String, Option<String>)> {
    let Some(Value::Array(items)) = body else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        match item {
            Value::Bytes(b) if b.len() == RRC_IDENTITY_HASH_LEN => {
                out.push((hex::encode(b), None));
            }
            Value::Text(t) if t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()) => {
                out.push((t.to_lowercase(), None));
            }
            Value::Map(entries) => {
                let mut hash = None;
                let mut nick = None;
                for (k, v) in entries {
                    match integer_key(k) {
                        Some(0) => {
                            if let Value::Bytes(b) = v {
                                if b.len() == RRC_IDENTITY_HASH_LEN {
                                    hash = Some(hex::encode(b));
                                }
                            } else if let Some(t) = as_text(v) {
                                hash = Some(t.to_lowercase());
                            }
                        }
                        Some(1) => nick = as_text(v).map(str::to_string),
                        _ => {}
                    }
                }
                if let Some(h) = hash {
                    out.push((h, nick));
                }
            }
            _ => {}
        }
    }
    out
}

pub fn body_as_text(body: Option<&Value>) -> Option<String> {
    match body {
        Some(Value::Text(t)) => Some(t.clone()),
        Some(Value::Map(entries)) => {
            for (k, v) in entries {
                if integer_key(k) == Some(0) {
                    return as_text(v).map(str::to_string);
                }
            }
            None
        }
        _ => None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn integer_key(v: &Value) -> Option<u64> {
    match v {
        Value::Integer(i) => u64::try_from(*i).ok(),
        _ => None,
    }
}

fn as_text(v: &Value) -> Option<&str> {
    match v {
        Value::Text(t) => Some(t.as_str()),
        _ => None,
    }
}

fn take_u8(
    fields: &BTreeMap<u64, Value>,
    key: u64,
    name: &'static str,
) -> Result<u8, RrcCodecError> {
    let v = fields.get(&key).ok_or(RrcCodecError::MissingField(name))?;
    match v {
        Value::Integer(i) => u8::try_from(*i).map_err(|_| RrcCodecError::BadType(name)),
        _ => Err(RrcCodecError::BadType(name)),
    }
}

fn take_u64(
    fields: &BTreeMap<u64, Value>,
    key: u64,
    name: &'static str,
) -> Result<u64, RrcCodecError> {
    let v = fields.get(&key).ok_or(RrcCodecError::MissingField(name))?;
    match v {
        Value::Integer(i) => u64::try_from(*i).map_err(|_| RrcCodecError::BadType(name)),
        _ => Err(RrcCodecError::BadType(name)),
    }
}

fn take_fixed_bytes<const N: usize>(
    fields: &BTreeMap<u64, Value>,
    key: u64,
    name: &'static str,
) -> Result<[u8; N], RrcCodecError> {
    let v = fields.get(&key).ok_or(RrcCodecError::MissingField(name))?;
    match v {
        Value::Bytes(b) if b.len() == N => {
            let mut out = [0u8; N];
            out.copy_from_slice(b);
            Ok(out)
        }
        _ => Err(RrcCodecError::BadType(name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_msg_envelope() {
        let sender = [0x9cu8; 16];
        let env = RrcEnvelope::new(
            msg_type::MSG,
            sender,
            Some("#lobby".into()),
            Some(text_body("Hello, world!")),
            Some("alice".into()),
        );
        let bytes = encode_envelope(&env).unwrap();
        let decoded = decode_envelope(&bytes).unwrap();
        assert_eq!(decoded.version, RRC_PROTOCOL_VERSION);
        assert_eq!(decoded.msg_type, msg_type::MSG);
        assert_eq!(decoded.sender_identity, sender);
        assert_eq!(decoded.room_name.as_deref(), Some("#lobby"));
        assert_eq!(decoded.nickname.as_deref(), Some("alice"));
        assert_eq!(
            body_as_text(decoded.body.as_ref()).as_deref(),
            Some("Hello, world!")
        );
    }

    #[test]
    fn ignores_unknown_envelope_keys() {
        let map = vec![
            (Value::Integer(0.into()), Value::Integer(1.into())),
            (Value::Integer(1.into()), Value::Integer(20.into())),
            (Value::Integer(2.into()), Value::Bytes(vec![1; 8])),
            (Value::Integer(3.into()), Value::Integer(1.into())),
            (Value::Integer(4.into()), Value::Bytes(vec![2; 16])),
            (Value::Integer(50.into()), Value::Text("ext".into())),
        ];
        let mut bytes = Vec::new();
        ciborium::into_writer(&Value::Map(map), &mut bytes).unwrap();
        let decoded = decode_envelope(&bytes).unwrap();
        assert_eq!(decoded.msg_type, msg_type::MSG);
    }

    #[test]
    fn hello_body_has_client_name() {
        let body = hello_body("mesh-client", "0.0.0");
        let Value::Map(entries) = body else {
            panic!("expected map");
        };
        assert_eq!(entries[0].1, Value::Text("mesh-client".into()));
    }
}
