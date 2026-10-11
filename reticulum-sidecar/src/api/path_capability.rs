use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::api::nomad::NomadServingContentSourceBody;
use crate::api::rncp::{RncpFetchBody, RncpListenerBody, RncpSendBody};

const TOKEN_BYTES: usize = 32;
const SESSION_BYTES: usize = 16;
const CAPABILITY_TTL: Duration = Duration::from_secs(30);
const MAX_OUTSTANDING_CAPABILITIES: usize = 128;
pub(crate) const CAPABILITY_HEADER: &str = "x-mesh-path-capability";
const ISSUER_HEADER: &str = "x-mesh-capability-issuer";

#[derive(Clone)]
pub(crate) struct PathCapabilityStore {
    inner: Arc<PathCapabilityInner>,
}

struct PathCapabilityInner {
    issuer_token: Arc<[u8]>,
    session_id: Arc<str>,
    grants: Mutex<HashMap<String, Grant>>,
}

struct Grant {
    operation: PathCapabilityOperation,
    body_hash: [u8; 32],
    paths: Vec<PathIdentity>,
    expires_at: Instant,
    session_id: Arc<str>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PathCapabilityOperation {
    RncpSend,
    RncpFetch,
    RncpListener,
    NomadContentSource,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MintPathCapabilityBody {
    operation: PathCapabilityOperation,
    body: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PathKind {
    File,
    Directory,
}

struct PathIdentity {
    field: &'static str,
    original: PathBuf,
    canonical: PathBuf,
    kind: PathKind,
    handle: same_file::Handle,
}

pub(crate) struct ConsumedPathCapability {
    paths: Vec<PathIdentity>,
}

impl PathCapabilityStore {
    pub(crate) fn try_new(issuer_token: String, session_id: String) -> Result<Self, String> {
        validate_random_token(&issuer_token, TOKEN_BYTES, "capability issuer token")?;
        validate_random_token(&session_id, SESSION_BYTES, "capability session id")?;
        Ok(Self {
            inner: Arc::new(PathCapabilityInner {
                issuer_token: Arc::from(issuer_token.into_bytes()),
                session_id: Arc::from(session_id),
                grants: Mutex::new(HashMap::new()),
            }),
        })
    }

    fn authorizes_issuer(&self, headers: &HeaderMap) -> bool {
        let Some(candidate) = single_header(headers, ISSUER_HEADER) else {
            return false;
        };
        candidate.len() == self.inner.issuer_token.len()
            && bool::from(candidate.ct_eq(self.inner.issuer_token.as_ref()))
    }

    fn mint(
        &self,
        headers: &HeaderMap,
        operation: PathCapabilityOperation,
        body: &Value,
    ) -> Result<String, &'static str> {
        self.mint_with_ttl(headers, operation, body, CAPABILITY_TTL)
    }

    fn mint_with_ttl(
        &self,
        headers: &HeaderMap,
        operation: PathCapabilityOperation,
        body: &Value,
        ttl: Duration,
    ) -> Result<String, &'static str> {
        if !self.authorizes_issuer(headers) {
            return Err("capability_issuer_denied");
        }
        let body = normalize_capability_body(operation, body)?;
        let paths = capture_required_paths(operation, &body)?;
        let now = Instant::now();
        let mut grants = self
            .inner
            .grants
            .lock()
            .map_err(|_| "capability_store_failed")?;
        grants.retain(|_, grant| grant.expires_at > now);
        if grants.len() >= MAX_OUTSTANDING_CAPABILITIES {
            return Err("capability_store_full");
        }
        let mut random = [0_u8; TOKEN_BYTES];
        rand::rngs::OsRng.fill_bytes(&mut random);
        let token = URL_SAFE_NO_PAD.encode(random);
        grants.insert(
            token.clone(),
            Grant {
                operation,
                body_hash: body_hash(&body),
                paths,
                expires_at: now + ttl,
                session_id: self.inner.session_id.clone(),
            },
        );
        Ok(token)
    }

    pub(crate) fn consume(
        &self,
        headers: &HeaderMap,
        operation: PathCapabilityOperation,
        body: &Value,
    ) -> Option<ConsumedPathCapability> {
        let token = single_header(headers, CAPABILITY_HEADER)
            .and_then(|bytes| std::str::from_utf8(bytes).ok())?;
        let Ok(mut grants) = self.inner.grants.lock() else {
            return None;
        };
        let grant = grants.remove(token)?;
        let Ok(body) = normalize_capability_body(operation, body) else {
            return None;
        };
        if grant.expires_at <= Instant::now()
            || grant.operation != operation
            || grant.session_id.as_ref() != self.inner.session_id.as_ref()
            || !bool::from(grant.body_hash.ct_eq(&body_hash(&body)))
        {
            return None;
        }
        let Ok(current_paths) = capture_required_paths(operation, &body) else {
            return None;
        };
        let matches = current_paths.len() == grant.paths.len()
            && current_paths
                .iter()
                .zip(grant.paths.iter())
                .all(|(current, expected)| current.matches(expected));
        matches.then_some(ConsumedPathCapability { paths: grant.paths })
    }
}

impl ConsumedPathCapability {
    pub(crate) fn still_matches(&self) -> bool {
        self.paths.iter().all(|expected| {
            PathIdentity::capture(expected.field, &expected.original, expected.kind)
                .is_ok_and(|current| current.matches(expected))
        })
    }
}

fn normalize_capability_body(
    operation: PathCapabilityOperation,
    body: &Value,
) -> Result<Value, &'static str> {
    macro_rules! normalize_as {
        ($ty:ty) => {{
            let parsed: $ty =
                serde_json::from_value(body.clone()).map_err(|_| "capability_body_invalid")?;
            serde_json::to_value(parsed).map_err(|_| "capability_body_invalid")
        }};
    }
    match operation {
        PathCapabilityOperation::RncpSend => normalize_as!(RncpSendBody),
        PathCapabilityOperation::RncpFetch => normalize_as!(RncpFetchBody),
        PathCapabilityOperation::RncpListener => normalize_as!(RncpListenerBody),
        PathCapabilityOperation::NomadContentSource => {
            normalize_as!(NomadServingContentSourceBody)
        }
    }
}

fn validate_random_token(value: &str, expected_bytes: usize, label: &str) -> Result<(), String> {
    let decoded = URL_SAFE_NO_PAD
        .decode(value.as_bytes())
        .map_err(|_| format!("{label} is not valid base64url"))?;
    if decoded.len() != expected_bytes {
        return Err(format!(
            "{label} must contain {expected_bytes} random bytes"
        ));
    }
    Ok(())
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a [u8]> {
    let mut values = headers.get_all(name).iter();
    let first = values.next()?;
    if values.next().is_some() {
        return None;
    }
    Some(first.as_bytes())
}

fn body_hash(body: &Value) -> [u8; 32] {
    let canonical = canonical_json(body);
    Sha256::digest(serde_json::to_vec(&canonical).expect("JSON values always serialize")).into()
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        Value::Object(values) => {
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort_unstable();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonical_json(&values[key]));
            }
            Value::Object(canonical)
        }
        _ => value.clone(),
    }
}

fn capture_required_paths(
    operation: PathCapabilityOperation,
    body: &Value,
) -> Result<Vec<PathIdentity>, &'static str> {
    let object = body.as_object().ok_or("capability_body_invalid")?;
    let mut requirements = Vec::new();
    match operation {
        PathCapabilityOperation::RncpSend => requirements.push(("path", PathKind::File)),
        PathCapabilityOperation::RncpFetch => {
            requirements.push(("save_path", PathKind::Directory));
        }
        PathCapabilityOperation::RncpListener => {
            if object.get("enabled").and_then(Value::as_bool) != Some(true) {
                return Err("capability_not_required");
            }
            requirements.push(("save_dir", PathKind::Directory));
            if object.get("allow_fetch").and_then(Value::as_bool) == Some(true) {
                requirements.push(("fetch_jail", PathKind::Directory));
            }
        }
        PathCapabilityOperation::NomadContentSource => {
            requirements.push(("path", PathKind::Directory));
        }
    }
    requirements
        .into_iter()
        .map(|(field, kind)| {
            let value = object
                .get(field)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or("capability_path_missing")?;
            PathIdentity::capture(field, Path::new(value), kind)
        })
        .collect()
}

impl PathIdentity {
    fn capture(field: &'static str, original: &Path, kind: PathKind) -> Result<Self, &'static str> {
        let canonical = std::fs::canonicalize(original).map_err(|_| "capability_path_invalid")?;
        let metadata = std::fs::metadata(&canonical).map_err(|_| "capability_path_invalid")?;
        let type_matches = match kind {
            PathKind::File => metadata.is_file(),
            PathKind::Directory => metadata.is_dir(),
        };
        if !type_matches {
            return Err("capability_path_type_mismatch");
        }
        let handle =
            same_file::Handle::from_path(&canonical).map_err(|_| "capability_path_invalid")?;
        Ok(Self {
            field,
            original: original.to_path_buf(),
            canonical,
            kind,
            handle,
        })
    }

    fn matches(&self, expected: &Self) -> bool {
        if self.field != expected.field
            || self.original != expected.original
            || self.canonical != expected.canonical
            || self.kind != expected.kind
        {
            return false;
        }
        self.handle == expected.handle
    }
}

pub(crate) async fn mint_path_capability(
    Extension(store): Extension<PathCapabilityStore>,
    headers: HeaderMap,
    Json(body): Json<MintPathCapabilityBody>,
) -> Response {
    match store.mint(&headers, body.operation, &body.body) {
        Ok(capability) => {
            Json(serde_json::json!({ "ok": true, "capability": capability })).into_response()
        }
        Err("capability_issuer_denied") => capability_denied().into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": error })),
        )
            .into_response(),
    }
}

pub(crate) fn capability_denied() -> (StatusCode, Json<Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({
            "ok": false,
            "error": "picker_capability_denied"
        })),
    )
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    const ISSUER: &str = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
    const SESSION: &str = "MDEyMzQ1Njc4OWFiY2RlZg";

    fn issuer_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(ISSUER_HEADER, ISSUER.parse().unwrap());
        headers
    }

    fn capability_headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CAPABILITY_HEADER, token.parse().unwrap());
        headers
    }

    #[test]
    fn capability_is_exact_one_use_and_body_bound() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("send.txt");
        std::fs::write(&file, b"payload").unwrap();
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "path": file
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
            .unwrap();
        let changed = serde_json::json!({
            "destination_hash": "ffeeddccbbaa99887766554433221100",
            "path": body["path"]
        });
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpSend,
                    &changed
                )
                .is_none()
        );
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpSend,
                    &body
                )
                .is_none()
        );

        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
            .unwrap();
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpFetch,
                    &body
                )
                .is_none()
        );
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpSend,
                    &body
                )
                .is_none()
        );

        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
            .unwrap();
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpSend,
                    &body
                )
                .is_some()
        );
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpSend,
                    &body
                )
                .is_none()
        );
    }

    #[test]
    fn rejects_missing_issuer_expiry_and_previous_session() {
        let dir = tempdir().unwrap();
        let body = serde_json::json!({ "path": dir.path() });
        let first = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        assert!(
            first
                .mint(
                    &HeaderMap::new(),
                    PathCapabilityOperation::NomadContentSource,
                    &body
                )
                .is_err()
        );
        let expired = first
            .mint_with_ttl(
                &issuer_headers(),
                PathCapabilityOperation::NomadContentSource,
                &body,
                Duration::ZERO,
            )
            .unwrap();
        assert!(
            first
                .consume(
                    &capability_headers(&expired),
                    PathCapabilityOperation::NomadContentSource,
                    &body
                )
                .is_none()
        );

        let live = first
            .mint(
                &issuer_headers(),
                PathCapabilityOperation::NomadContentSource,
                &body,
            )
            .unwrap();
        let second =
            PathCapabilityStore::try_new(ISSUER.into(), "ZmVkY2JhOTg3NjU0MzIxMA".into()).unwrap();
        assert!(
            second
                .consume(
                    &capability_headers(&live),
                    PathCapabilityOperation::NomadContentSource,
                    &body
                )
                .is_none()
        );
    }

    #[test]
    fn normalizes_omitted_listener_fields_before_binding() {
        let dir = tempdir().unwrap();
        let mint_body = serde_json::json!({
            "enabled": true,
            "save_dir": dir.path(),
            "allow_fetch": false
        });
        let handler_body = serde_json::json!({
            "enabled": true,
            "save_dir": dir.path(),
            "allow_fetch": false,
            "fetch_jail": null,
            "overwrite": false,
            "allowed": [],
            "blocked": []
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(
                &issuer_headers(),
                PathCapabilityOperation::RncpListener,
                &mint_body,
            )
            .unwrap();
        assert!(
            store
                .consume(
                    &capability_headers(&token),
                    PathCapabilityOperation::RncpListener,
                    &handler_body
                )
                .is_some()
        );
    }

    #[test]
    fn rejects_path_replacement_after_mint() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("send.txt");
        std::fs::write(&file, b"first").unwrap();
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "path": file
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
            .unwrap();
        if std::fs::remove_file(&file).is_ok() {
            std::fs::write(&file, b"replacement").unwrap();
            assert!(
                store
                    .consume(
                        &capability_headers(&token),
                        PathCapabilityOperation::RncpSend,
                        &body
                    )
                    .is_none()
            );
        } else {
            assert!(file.exists(), "an open capability handle must pin the file");
        }
    }

    #[test]
    fn consumed_guard_revalidates_and_pins_identity_through_the_sink() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("send.txt");
        std::fs::write(&file, b"first").unwrap();
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "path": file
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
            .unwrap();
        let guard = store
            .consume(
                &capability_headers(&token),
                PathCapabilityOperation::RncpSend,
                &body,
            )
            .unwrap();

        if std::fs::remove_file(&file).is_ok() {
            std::fs::write(&file, b"replacement").unwrap();
            assert!(!guard.still_matches());
        } else {
            assert!(file.exists(), "the live guard must pin the file identity");
            assert!(guard.still_matches());
        }
    }
}
