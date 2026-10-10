//! Session event types pushed on WS / broadcast.

use serde::Serialize;

use super::error::GattError;
use super::profile::GattProfile;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum GattSessionEvent {
    Bytes {
        session_id: String,
        profile: GattProfile,
        /// Base64-encoded GATT payload.
        data_b64: String,
    },
    Disconnected {
        session_id: String,
        profile: GattProfile,
        reason: String,
    },
    Mtu {
        session_id: String,
        mtu: u16,
    },
    Rssi {
        session_id: String,
        rssi: i16,
    },
    Error {
        session_id: Option<String>,
        code: String,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        owner: Option<String>,
    },
}

impl GattSessionEvent {
    pub fn from_error(session_id: Option<String>, err: &GattError) -> Self {
        Self::Error {
            session_id,
            code: err.code.as_str().to_string(),
            message: err.message.clone(),
            owner: err.owner.clone(),
        }
    }
}
