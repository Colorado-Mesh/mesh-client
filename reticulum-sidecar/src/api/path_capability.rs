use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(all(unix, not(target_os = "macos")))]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt as _;
#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt as _;

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
pub(crate) const MAX_AUTHORIZED_FILE_BYTES: usize = 25 * 1024 * 1024;
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
    target: PathBuf,
    canonical: PathBuf,
    runtime_suffix: PathBuf,
    kind: PathKind,
    handle: same_file::Handle,
    #[cfg(windows)]
    ancestor_handles: Vec<same_file::Handle>,
}

pub(crate) struct ConsumedPathCapability {
    paths: Vec<PathIdentity>,
}

impl PathCapabilityStore {
    pub(crate) fn try_new(issuer_token: String, session_id: String) -> Result<Self, String> {
        validate_random_token(&issuer_token, TOKEN_BYTES, "capability issuer token")?;
        validate_random_token(&session_id, SESSION_BYTES, "capability session id")?;
        let store = Self {
            inner: Arc::new(PathCapabilityInner {
                issuer_token: Arc::from(issuer_token.into_bytes()),
                session_id: Arc::from(session_id),
                grants: Mutex::new(HashMap::new()),
            }),
        };
        store.spawn_expiry_sweeper();
        Ok(store)
    }

    fn spawn_expiry_sweeper(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let inner = Arc::downgrade(&self.inner);
        runtime.spawn(async move {
            loop {
                tokio::time::sleep(CAPABILITY_TTL).await;
                let Some(inner) = inner.upgrade() else {
                    break;
                };
                let Ok(mut grants) = inner.grants.lock() else {
                    break;
                };
                let now = Instant::now();
                grants.retain(|_, grant| grant.expires_at > now);
            }
        });
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
        let grant = {
            let Ok(mut grants) = self.inner.grants.lock() else {
                return None;
            };
            grants.remove(token)?
        };
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
            PathIdentity::capture_target(
                expected.field,
                &expected.original,
                &expected.target,
                expected.kind,
            )
            .is_ok_and(|current| current.matches(expected))
        })
    }

    /// Return a path that resolves through the already-open capability handle.
    ///
    /// macOS resolves the opened directory through `/.vol`, while Linux uses
    /// `/proc/self/fd`; later filesystem operations therefore cannot be
    /// redirected by renaming the selected path. Windows keeps the canonical
    /// target and every ancestor open without delete sharing, which prevents
    /// replacement for the lifetime of this guard.
    pub(crate) fn runtime_path(&self, field: &str) -> Option<PathBuf> {
        let identity = self.paths.iter().find(|path| path.field == field)?;
        if identity.kind != PathKind::Directory {
            return None;
        }
        if !self.still_matches() {
            return None;
        }
        Some(identity.runtime_path())
    }

    pub(crate) fn read_file(&self, field: &str, max_bytes: usize) -> Result<Vec<u8>, &'static str> {
        let identity = self
            .paths
            .iter()
            .find(|path| path.field == field && path.kind == PathKind::File)
            .ok_or("capability_path_missing")?;
        if !self.still_matches() {
            return Err("capability_path_changed");
        }
        let metadata = identity
            .handle
            .as_file()
            .metadata()
            .map_err(|_| "capability_path_invalid")?;
        if !metadata.is_file() || metadata.len() > max_bytes as u64 {
            return Err("capability_file_too_large");
        }
        let mut file = identity
            .handle
            .as_file()
            .try_clone()
            .map_err(|_| "capability_path_invalid")?;
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "capability_path_invalid")?;
        let mut data = Vec::with_capacity(metadata.len() as usize);
        file.take(max_bytes as u64 + 1)
            .read_to_end(&mut data)
            .map_err(|_| "capability_path_invalid")?;
        if data.len() > max_bytes {
            return Err("capability_file_too_large");
        }
        Ok(data)
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
        PathCapabilityOperation::NomadContentSource => {}
    }
    let mut captured: Vec<PathIdentity> = requirements
        .into_iter()
        .map(|(field, kind)| {
            let value = object
                .get(field)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or("capability_path_missing")?;
            PathIdentity::capture(field, Path::new(value), kind)
        })
        .collect::<Result<_, _>>()?;
    if operation == PathCapabilityOperation::NomadContentSource {
        let value = object
            .get("path")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or("capability_path_missing")?;
        let selected = Path::new(value);
        let resolved = crate::stack::nomad_content_source::resolve_content_roots(selected)
            .map_err(|_| "capability_path_invalid")?;
        // Pin the exact directory the user selected. For the pages-directory
        // layout, pin its parent separately because Nomad also serves the
        // sibling `files/` tree from there. A parent handle alone would still
        // allow the selected `pages/` entry to be replaced after approval.
        captured.push(PathIdentity::capture(
            "path",
            selected,
            PathKind::Directory,
        )?);
        if resolved.layout == crate::stack::nomad_content_source::NomadContentLayout::PagesDir {
            captured.push(PathIdentity::capture(
                "content_root",
                &resolved.content_root,
                PathKind::Directory,
            )?);
        }
    }
    Ok(captured)
}

impl PathIdentity {
    fn capture(field: &'static str, original: &Path, kind: PathKind) -> Result<Self, &'static str> {
        Self::capture_target(field, original, original, kind)
    }

    fn capture_target(
        field: &'static str,
        original: &Path,
        target: &Path,
        kind: PathKind,
    ) -> Result<Self, &'static str> {
        if std::fs::symlink_metadata(original)
            .map_err(|_| "capability_path_invalid")?
            .file_type()
            .is_symlink()
        {
            return Err("capability_path_symlink_denied");
        }
        if std::fs::symlink_metadata(target)
            .map_err(|_| "capability_path_invalid")?
            .file_type()
            .is_symlink()
        {
            return Err("capability_path_symlink_denied");
        }
        let selected_canonical =
            std::fs::canonicalize(original).map_err(|_| "capability_path_invalid")?;
        let canonical = std::fs::canonicalize(target).map_err(|_| "capability_path_invalid")?;
        let runtime_suffix = selected_canonical
            .strip_prefix(&canonical)
            .map_err(|_| "capability_path_invalid")?
            .to_path_buf();
        let file = open_pinned(&canonical, kind)?;
        let metadata = file.metadata().map_err(|_| "capability_path_invalid")?;
        let type_matches = match kind {
            PathKind::File => metadata.is_file(),
            PathKind::Directory => metadata.is_dir(),
        };
        if !type_matches {
            return Err("capability_path_type_mismatch");
        }
        let handle = same_file::Handle::from_file(file).map_err(|_| "capability_path_invalid")?;

        // Close the canonicalize/open race before accepting the handle. The
        // second handle is intentionally short-lived; `handle` is retained.
        let reselected = std::fs::canonicalize(original).map_err(|_| "capability_path_invalid")?;
        let recanonical = std::fs::canonicalize(target).map_err(|_| "capability_path_invalid")?;
        if reselected != selected_canonical || recanonical != canonical {
            return Err("capability_path_changed");
        }
        let verification = same_file::Handle::from_file(open_pinned(&recanonical, kind)?)
            .map_err(|_| "capability_path_invalid")?;
        if verification != handle {
            return Err("capability_path_changed");
        }

        #[cfg(windows)]
        let ancestor_handles = pin_windows_ancestors(&canonical)?;
        Ok(Self {
            field,
            original: original.to_path_buf(),
            target: target.to_path_buf(),
            canonical,
            runtime_suffix,
            kind,
            handle,
            #[cfg(windows)]
            ancestor_handles,
        })
    }

    fn matches(&self, expected: &Self) -> bool {
        if self.field != expected.field
            || self.original != expected.original
            || self.target != expected.target
            || self.canonical != expected.canonical
            || self.runtime_suffix != expected.runtime_suffix
            || self.kind != expected.kind
        {
            return false;
        }
        self.handle == expected.handle
    }

    #[cfg(target_os = "macos")]
    fn runtime_path(&self) -> PathBuf {
        PathBuf::from(format!("/.vol/{}/{}", self.handle.dev(), self.handle.ino()))
            .join(&self.runtime_suffix)
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    fn runtime_path(&self) -> PathBuf {
        PathBuf::from(format!("/proc/self/fd/{}", self.handle.as_raw_fd()))
            .join(&self.runtime_suffix)
    }

    #[cfg(windows)]
    fn runtime_path(&self) -> PathBuf {
        // `handle` and `ancestor_handles` deny delete sharing, so this exact
        // canonical path cannot be swapped while the capability is alive.
        let _ = &self.ancestor_handles;
        self.canonical.join(&self.runtime_suffix)
    }

    #[cfg(not(any(unix, windows)))]
    fn runtime_path(&self) -> PathBuf {
        self.canonical.join(&self.runtime_suffix)
    }
}

#[cfg(unix)]
fn open_pinned(path: &Path, kind: PathKind) -> Result<File, &'static str> {
    let mut flags = libc::O_NOFOLLOW | libc::O_CLOEXEC;
    if kind == PathKind::Directory {
        flags |= libc::O_DIRECTORY;
    } else {
        // Type validation happens after open; never block here on a FIFO or device.
        flags |= libc::O_NONBLOCK;
    }
    OpenOptions::new()
        .read(true)
        .custom_flags(flags)
        .open(path)
        .map_err(|_| "capability_path_invalid")
}

#[cfg(windows)]
fn open_pinned(path: &Path, _kind: PathKind) -> Result<File, &'static str> {
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| "capability_path_invalid")
}

#[cfg(not(any(unix, windows)))]
fn open_pinned(path: &Path, _kind: PathKind) -> Result<File, &'static str> {
    File::open(path).map_err(|_| "capability_path_invalid")
}

#[cfg(windows)]
fn pin_windows_ancestors(path: &Path) -> Result<Vec<same_file::Handle>, &'static str> {
    let mut handles = Vec::new();
    let mut current = path.parent();
    while let Some(ancestor) = current {
        handles.push(
            same_file::Handle::from_file(open_pinned(ancestor, PathKind::Directory)?)
                .map_err(|_| "capability_path_invalid")?,
        );
        current = ancestor.parent();
    }
    Ok(handles)
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
        std::fs::create_dir(dir.path().join("pages")).unwrap();
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

    #[cfg(unix)]
    #[test]
    fn rejects_selected_symlink() {
        use std::os::unix::fs::symlink;

        let dir = tempdir().unwrap();
        let target = dir.path().join("target.txt");
        let selected = dir.path().join("selected.txt");
        std::fs::write(&target, b"payload").unwrap();
        symlink(&target, &selected).unwrap();
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "path": selected
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        assert_eq!(
            store
                .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
                .unwrap_err(),
            "capability_path_symlink_denied"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_fifo_without_waiting_for_a_writer() {
        let dir = tempdir().unwrap();
        let fifo = dir.path().join("selected.fifo");
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "path": fifo
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();

        assert_eq!(
            store
                .mint(&issuer_headers(), PathCapabilityOperation::RncpSend, &body)
                .unwrap_err(),
            "capability_path_type_mismatch"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn expiry_sweeper_releases_abandoned_grants() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join("pages")).unwrap();
        let body = serde_json::json!({ "path": dir.path() });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        store
            .mint_with_ttl(
                &issuer_headers(),
                PathCapabilityOperation::NomadContentSource,
                &body,
                Duration::ZERO,
            )
            .unwrap();
        assert_eq!(store.inner.grants.lock().unwrap().len(), 1);

        tokio::task::yield_now().await;
        tokio::time::advance(CAPABILITY_TTL + Duration::from_millis(1)).await;
        tokio::task::yield_now().await;

        assert!(store.inner.grants.lock().unwrap().is_empty());
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

    #[test]
    fn runtime_file_path_cannot_be_redirected_after_consume() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("send.txt");
        std::fs::write(&file, b"picked").unwrap();
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
        match std::fs::remove_file(&file) {
            Ok(()) => {
                std::fs::write(&file, b"replacement").unwrap();
                match guard.read_file("path", MAX_AUTHORIZED_FILE_BYTES) {
                    Ok(data) => assert_eq!(data, b"picked"),
                    Err(error) => assert_eq!(error, "capability_path_changed"),
                }
            }
            Err(_) => {
                assert_eq!(
                    guard.read_file("path", MAX_AUTHORIZED_FILE_BYTES).unwrap(),
                    b"picked"
                );
            }
        }
    }

    #[test]
    fn runtime_directory_path_cannot_be_redirected_after_consume() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("selected");
        std::fs::create_dir(&selected).unwrap();
        std::fs::write(selected.join("marker"), b"picked").unwrap();
        let body = serde_json::json!({
            "destination_hash": "00112233445566778899aabbccddeeff",
            "remote_path": "remote.txt",
            "save_path": selected
        });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(&issuer_headers(), PathCapabilityOperation::RncpFetch, &body)
            .unwrap();
        let guard = store
            .consume(
                &capability_headers(&token),
                PathCapabilityOperation::RncpFetch,
                &body,
            )
            .unwrap();
        let runtime_path = guard.runtime_path("save_path").unwrap();
        let moved = dir.path().join("moved");

        match std::fs::rename(&selected, &moved) {
            Ok(()) => {
                std::fs::create_dir(&selected).unwrap();
                std::fs::write(selected.join("marker"), b"replacement").unwrap();
                assert_eq!(
                    std::fs::read(runtime_path.join("marker")).unwrap(),
                    b"picked"
                );
            }
            Err(_) => {
                assert_eq!(std::fs::read(selected.join("marker")).unwrap(), b"picked");
            }
        }
    }

    #[test]
    fn nomad_runtime_path_stays_bound_to_selected_tree_after_consume() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("selected");
        std::fs::create_dir_all(selected.join("pages")).unwrap();
        std::fs::write(selected.join("pages/index.mu"), b"picked").unwrap();
        let body = serde_json::json!({ "path": selected });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(
                &issuer_headers(),
                PathCapabilityOperation::NomadContentSource,
                &body,
            )
            .unwrap();
        let guard = store
            .consume(
                &capability_headers(&token),
                PathCapabilityOperation::NomadContentSource,
                &body,
            )
            .unwrap();
        let runtime_path = guard.runtime_path("path").unwrap();
        let moved = dir.path().join("moved");

        match std::fs::rename(&selected, &moved) {
            Ok(()) => {
                std::fs::create_dir_all(selected.join("pages")).unwrap();
                std::fs::write(selected.join("pages/index.mu"), b"replacement").unwrap();
                let roots = crate::stack::nomad_content_source::resolve_pinned_content_roots(
                    &runtime_path,
                    None,
                )
                .unwrap();
                assert_eq!(
                    std::fs::read(roots.pages_dir.join("index.mu")).unwrap(),
                    b"picked"
                );
            }
            Err(_) => {
                assert_eq!(
                    std::fs::read(selected.join("pages/index.mu")).unwrap(),
                    b"picked"
                );
            }
        }
    }

    #[test]
    fn nomad_pages_selection_pins_pages_and_parent_independently() {
        let dir = tempdir().unwrap();
        let site = dir.path().join("site");
        let pages = site.join("pages");
        std::fs::create_dir_all(&pages).unwrap();
        std::fs::write(pages.join("index.mu"), b"picked").unwrap();
        let body = serde_json::json!({ "path": pages });
        let store = PathCapabilityStore::try_new(ISSUER.into(), SESSION.into()).unwrap();
        let token = store
            .mint(
                &issuer_headers(),
                PathCapabilityOperation::NomadContentSource,
                &body,
            )
            .unwrap();
        let guard = store
            .consume(
                &capability_headers(&token),
                PathCapabilityOperation::NomadContentSource,
                &body,
            )
            .unwrap();
        let pinned_pages = guard.runtime_path("path").unwrap();
        let pinned_site = guard.runtime_path("content_root").unwrap();
        let moved = site.join("picked-pages");

        match std::fs::rename(&pages, &moved) {
            Ok(()) => {
                std::fs::create_dir(&pages).unwrap();
                std::fs::write(pages.join("index.mu"), b"replacement").unwrap();
                let roots = crate::stack::nomad_content_source::resolve_pinned_content_roots(
                    &pinned_pages,
                    Some(&pinned_site),
                )
                .unwrap();
                assert_eq!(
                    std::fs::read(roots.pages_dir.join("index.mu")).unwrap(),
                    b"picked"
                );
                assert_eq!(roots.files_dir, pinned_site.join("files"));
            }
            Err(_) => {
                assert_eq!(std::fs::read(pages.join("index.mu")).unwrap(), b"picked");
            }
        }
    }
}
