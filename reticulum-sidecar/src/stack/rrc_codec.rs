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
    /// Large payload announcement; body carries id/kind/size/sha256 (rrcd).
    pub const RESOURCE_ENVELOPE: u8 = 50;
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
    // Advertise the same capability set Python rrc-web / Ratspeak send so hubs
    // that gate large NOTICE delivery (RESOURCE_ENVELOPE) know we can accept it.
    let caps = Value::Map(vec![
        (Value::Integer(0u64.into()), Value::Bool(true)), // CAP_RESOURCE_ENVELOPE
        (Value::Integer(1u64.into()), Value::Bool(true)), // CAP_ACTION
        (Value::Integer(2u64.into()), Value::Bool(true)), // CAP_DIRECT_NOTICE
    ]);
    Value::Map(vec![
        (Value::Integer(0.into()), Value::Text(client_name.into())),
        (Value::Integer(1.into()), Value::Text(client_version.into())),
        (Value::Integer(2.into()), caps),
    ])
}

pub fn text_body(text: &str) -> Value {
    Value::Text(text.to_string())
}

pub fn parse_welcome_hub_name(body: Option<&Value>) -> Option<String> {
    welcome_map_text(body, 0)
}

/// WELCOME body key 1 (`B_WELCOME_VER`).
pub fn parse_welcome_hub_version(body: Option<&Value>) -> Option<String> {
    welcome_map_text(body, 1)
}

fn welcome_map_text(body: Option<&Value>, key: u64) -> Option<String> {
    let Some(Value::Map(entries)) = body else {
        return None;
    };
    for (k, v) in entries {
        if integer_key(k) == Some(key) {
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

/// WELCOME body key 3 (`B_WELCOME_LIMITS`) — EX1-RRCD hub operational limits.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RrcWelcomeLimits {
    pub max_nick_bytes: Option<u64>,
    pub max_room_name_bytes: Option<u64>,
    pub max_msg_body_bytes: Option<u64>,
    pub max_rooms_per_session: Option<u64>,
    pub rate_limit_msgs_per_minute: Option<u64>,
}

/// Parse WELCOME body key 3 (limits map with unsigned integer keys 0–4).
pub fn parse_welcome_limits(body: Option<&Value>) -> RrcWelcomeLimits {
    let mut out = RrcWelcomeLimits::default();
    let Some(Value::Map(entries)) = body else {
        return out;
    };
    let Some(limits) = entries.iter().find_map(|(k, v)| {
        if integer_key(k) == Some(3) {
            Some(v)
        } else {
            None
        }
    }) else {
        return out;
    };
    let Value::Map(limits) = limits else {
        return out;
    };
    for (k, v) in limits {
        let Some(key) = integer_key(k) else { continue };
        let Some(n) = as_u64(v) else { continue };
        match key {
            0 => out.max_nick_bytes = Some(n),
            1 => out.max_room_name_bytes = Some(n),
            2 => out.max_msg_body_bytes = Some(n),
            3 => out.max_rooms_per_session = Some(n),
            4 => out.rate_limit_msgs_per_minute = Some(n),
            _ => {}
        }
    }
    out
}

/// EX1 resource envelope body (keys 0–4): id / kind / size / sha256 / encoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RrcResourceEnvelopeMeta {
    pub id: Option<Vec<u8>>,
    pub kind: String,
    pub size: u64,
    pub sha256: Option<[u8; 32]>,
    pub encoding: String,
}

pub fn parse_resource_envelope_body(body: Option<&Value>) -> Option<RrcResourceEnvelopeMeta> {
    let Value::Map(entries) = body? else {
        return None;
    };
    let mut id = None;
    let mut kind = None;
    let mut size = None;
    let mut sha256 = None;
    let mut encoding = None;
    for (k, v) in entries {
        match integer_key(k) {
            Some(0) => {
                if let Value::Bytes(b) = v {
                    id = Some(b.clone());
                }
            }
            Some(1) => kind = as_text(v).map(str::to_string),
            Some(2) => size = as_u64(v),
            Some(3) => {
                if let Value::Bytes(b) = v {
                    if b.len() == 32 {
                        let mut arr = [0u8; 32];
                        arr.copy_from_slice(b);
                        sha256 = Some(arr);
                    }
                }
            }
            Some(4) => encoding = as_text(v).map(str::to_string),
            _ => {}
        }
    }
    let kind = kind?.trim().to_ascii_lowercase();
    if kind.is_empty() {
        return None;
    }
    Some(RrcResourceEnvelopeMeta {
        id,
        kind,
        size: size.unwrap_or(0),
        sha256,
        encoding: encoding
            .unwrap_or_else(|| "utf-8".into())
            .trim()
            .to_ascii_lowercase(),
    })
}

/// Attach envelope `K_NICK` to a single-peer JOINED/PARTED fanout when body has one hash.
pub fn apply_advisory_nick(
    mut members: Vec<(String, Option<String>)>,
    nick: Option<&str>,
) -> Vec<(String, Option<String>)> {
    let Some(n) = nick.map(str::trim).filter(|s| !s.is_empty()) else {
        return members;
    };
    if members.len() == 1 && members[0].1.as_ref().is_none_or(|s| s.trim().is_empty()) {
        members[0].1 = Some(n.to_string());
    }
    members
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

fn parse_identity_hash_value(item: &Value) -> Option<(String, Option<String>)> {
    match item {
        Value::Bytes(b) if b.len() == RRC_IDENTITY_HASH_LEN => Some((hex::encode(b), None)),
        Value::Text(t) if t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()) => {
            Some((t.to_lowercase(), None))
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
                            if t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()) {
                                hash = Some(t.to_lowercase());
                            }
                        }
                    }
                    Some(1) => nick = as_text(v).map(str::to_string),
                    _ => {}
                }
            }
            hash.map(|h| (h, nick))
        }
        _ => None,
    }
}

/// EX1-RRCD: JOINED body may be a full member list (array) or a single hash
/// (array of one, or bare bytes/text). PARTED is a single hash in the same shapes.
pub fn parse_joined_members(body: Option<&Value>) -> Vec<(String, Option<String>)> {
    let Some(body) = body else {
        return Vec::new();
    };
    match body {
        Value::Array(items) => items.iter().filter_map(parse_identity_hash_value).collect(),
        // Bare single hash (client-implementation note in EX1-RRCD.md).
        other => parse_identity_hash_value(other).into_iter().collect(),
    }
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

fn as_u64(v: &Value) -> Option<u64> {
    match v {
        Value::Integer(i) => u64::try_from(*i).ok(),
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
        let caps_entry = entries
            .iter()
            .find(|(k, _)| integer_key(k) == Some(2))
            .map(|(_, v)| v)
            .expect("HELLO key 2 capabilities");
        let Value::Map(caps) = caps_entry else {
            panic!("expected capabilities map");
        };
        for key in [0u64, 1, 2] {
            let flag = caps
                .iter()
                .find(|(k, _)| integer_key(k) == Some(key))
                .map(|(_, v)| v)
                .unwrap_or_else(|| panic!("missing capability key {key}"));
            assert_eq!(flag, &Value::Bool(true), "capability {key} must be true");
        }
    }

    #[test]
    fn parse_joined_members_rejects_malformed_text_hash_in_map() {
        let body = Value::Map(vec![
            (Value::Integer(0.into()), Value::Text("alice".into())),
            (Value::Integer(1.into()), Value::Text("Alice".into())),
        ]);
        assert!(parse_joined_members(Some(&body)).is_empty());
    }

    #[test]
    fn parse_joined_members_array_and_bare_hash() {
        let h1 = [0x11u8; 16];
        let h2 = [0x22u8; 16];
        let arr = Value::Array(vec![Value::Bytes(h1.to_vec()), Value::Bytes(h2.to_vec())]);
        let parsed = parse_joined_members(Some(&arr));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, hex::encode(h1));
        assert_eq!(parsed[1].0, hex::encode(h2));

        let bare = Value::Bytes(h1.to_vec());
        let one = parse_joined_members(Some(&bare));
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].0, hex::encode(h1));

        let with_nick = apply_advisory_nick(one, Some("alice"));
        assert_eq!(with_nick[0].1.as_deref(), Some("alice"));
    }

    #[test]
    fn parse_welcome_limits_and_resource_meta() {
        let body = Value::Map(vec![
            (Value::Integer(0.into()), Value::Text("Hub".into())),
            (Value::Integer(1.into()), Value::Text("0.3.2".into())),
            (
                Value::Integer(3.into()),
                Value::Map(vec![
                    (Value::Integer(0.into()), Value::Integer(32.into())),
                    (Value::Integer(2.into()), Value::Integer(4096.into())),
                ]),
            ),
        ]);
        assert_eq!(
            parse_welcome_hub_version(Some(&body)).as_deref(),
            Some("0.3.2")
        );
        let limits = parse_welcome_limits(Some(&body));
        assert_eq!(limits.max_nick_bytes, Some(32));
        assert_eq!(limits.max_msg_body_bytes, Some(4096));

        let res_body = Value::Map(vec![
            (Value::Integer(0.into()), Value::Bytes(vec![1; 8])),
            (Value::Integer(1.into()), Value::Text("notice".into())),
            (Value::Integer(2.into()), Value::Integer(12.into())),
            (Value::Integer(3.into()), Value::Bytes(vec![9; 32])),
            (Value::Integer(4.into()), Value::Text("utf-8".into())),
        ]);
        let meta = parse_resource_envelope_body(Some(&res_body)).expect("meta");
        assert_eq!(meta.kind, "notice");
        assert_eq!(meta.size, 12);
        assert!(meta.sha256.is_some());
    }
}
