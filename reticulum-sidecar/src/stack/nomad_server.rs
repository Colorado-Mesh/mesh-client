//! Local Nomad Network page/file hosting via `nomad-core` / rsNomad.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use nomad_core::{
    DEFAULT_CONVERSION_MAX_DIMENSION, DEFAULT_CONVERSION_QUALITY, MediaCacheConfig,
    NomadContentRoots, NomadContentStore, NomadError, NomadNode, NomadNodeConfig,
    normalize_file_route, normalize_page_route,
};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::{Mutex, mpsc};

#[cfg(test)]
use tokio::sync::Notify;

use crate::api::path_capability::ConsumedPathCapability;

use super::nomad_content_source::{
    ContentSourceError, ResolvedNomadContentRoots, layout_label, resolve_content_roots,
    resolve_pinned_content_roots,
};
use super::types::{NomadServeStatsRow, NomadServingStatus};

const DEFAULT_ANNOUNCE_INTERVAL_SECS: u64 = 3600;
const WATCHER_DEBOUNCE: Duration = Duration::from_millis(200);
const WATCHER_RECONCILE: Duration = Duration::from_secs(45);
const WATCHER_WARN_INTERVAL: Duration = Duration::from_secs(60);

struct WatcherState {
    _watcher: RecommendedWatcher,
    cancel: tokio::sync::watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

struct ContentSourceSelection {
    runtime_path: PathBuf,
    runtime_content_root: Option<PathBuf>,
    display_path: PathBuf,
    display_content_root: PathBuf,
    capability: Option<ConsumedPathCapability>,
    capability_required: bool,
}

/// Stable snake_case code for a page storage error, for renderer translation.
///
/// `NomadError`'s `Display` is free-form English and interpolates paths and byte
/// counts (`not found: index.mu`), so it is neither translatable nor safe to
/// pattern-match downstream. Callers log the original error for diagnostics.
fn page_error_code(err: &NomadError) -> &'static str {
    match err {
        NomadError::TooLarge { .. } => "page_too_large",
        NomadError::NotFound(_) => "page_not_found",
        // Symlink rejection also surfaces as PathTraversal and is not separable.
        NomadError::PathTraversal | NomadError::InvalidPath(_) => "invalid_page_path",
        NomadError::Io(_) => "page_io_error",
        NomadError::Message(_) | NomadError::TransportClosed => "page_write_failed",
    }
}

/// Log the underlying storage failure and return its translatable code.
fn page_error(op: &str, rel: &str, err: &NomadError) -> String {
    let code = page_error_code(err);
    tracing::warn!("[nomad-serving] {op} page {rel} failed ({code}): {err}");
    code.to_string()
}

pub struct NomadServerHandle {
    /// Serializes start/stop/reconfigure so concurrent callers cannot double-spawn.
    lifecycle: Mutex<()>,
    inner: Mutex<Option<NomadNode>>,
    content_source: Mutex<Option<ContentSourceSelection>>,
    /// Opt-in CGI for `+x` pages (applied at next `NomadNode::spawn`).
    allow_executable_pages: Mutex<bool>,
    last_error: Mutex<Option<String>>,
    watcher_status: Mutex<String>,
    watcher: Mutex<Option<WatcherState>>,
    last_watcher_warn: Mutex<Option<Instant>>,
    watcher_warn_suppressed: Mutex<u32>,
    #[cfg(test)]
    start_test_gate: Mutex<Option<Arc<NomadStartTestGate>>>,
    #[cfg(test)]
    stop_test_gate: Mutex<Option<Arc<NomadStopTestGate>>>,
}

#[cfg(test)]
#[derive(Default)]
struct NomadStartTestGate {
    entered: Notify,
    release: Notify,
}

#[cfg(test)]
#[derive(Default)]
struct NomadStopTestGate {
    entered: Notify,
    release: Notify,
}

impl NomadServerHandle {
    pub fn new() -> Self {
        Self {
            lifecycle: Mutex::new(()),
            inner: Mutex::new(None),
            content_source: Mutex::new(None),
            allow_executable_pages: Mutex::new(false),
            last_error: Mutex::new(None),
            watcher_status: Mutex::new("ok".into()),
            watcher: Mutex::new(None),
            last_watcher_warn: Mutex::new(None),
            watcher_warn_suppressed: Mutex::new(0),
            #[cfg(test)]
            start_test_gate: Mutex::new(None),
            #[cfg(test)]
            stop_test_gate: Mutex::new(None),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    pub async fn allow_executable_pages(&self) -> bool {
        *self.allow_executable_pages.lock().await
    }

    /// Update the CGI opt-in flag used on the next spawn. Does not restart a
    /// running node — callers that need the new config applied immediately
    /// should stop + start (see `StackHandle::set_nomad_serving`).
    pub async fn set_allow_executable_pages(&self, allow: bool) {
        *self.allow_executable_pages.lock().await = allow;
    }

    fn node_config(display_name: String, allow_executable_pages: bool) -> NomadNodeConfig {
        // When CGI is on, inherit host PATH so `#!/usr/bin/env …` / Homebrew works
        // (NomadNet parity). When off, `None` keeps nomad-core's sanitized PATH.
        let script_path = if allow_executable_pages {
            Some(std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into()))
        } else {
            None
        };
        NomadNodeConfig {
            display_name,
            announce_interval: Some(Duration::from_secs(DEFAULT_ANNOUNCE_INTERVAL_SECS)),
            announce_at_start: true,
            allow_executable_pages,
            script_path,
            // Match nomad-core `CGI_TIMEOUT` (not re-exported from the crate root).
            script_timeout: Duration::from_secs(10),
            // Host conversion cache for /media (NomadNet 1.4.3+); memory-only
            // until we expose an embedder-owned disk root + clear API.
            media_cache: MediaCacheConfig::memory_only(),
            media_conversion_quality: DEFAULT_CONVERSION_QUALITY,
            media_conversion_max_dimension: DEFAULT_CONVERSION_MAX_DIMENSION,
        }
    }

    /// Configure the required external content source path (watched folder).
    #[cfg(test)]
    async fn set_content_source_path(
        self: &Arc<Self>,
        path: &Path,
        capability: Option<ConsumedPathCapability>,
    ) -> Result<ResolvedNomadContentRoots, String> {
        let _lifecycle = self.lifecycle.lock().await;
        if self.inner.lock().await.is_some() {
            return Err("content_source_change_requires_stopped_server".into());
        }
        let (selection, resolved) = Self::prepare_content_source(path, capability)?;
        *self.content_source.lock().await = Some(selection);
        self.clear_content_source_error().await;
        // Keep watcher stopped while offline.
        self.stop_watcher().await;
        Ok(resolved)
    }

    fn prepare_content_source(
        path: &Path,
        capability: Option<ConsumedPathCapability>,
    ) -> Result<(ContentSourceSelection, ResolvedNomadContentRoots), String> {
        let display_resolved = resolve_content_roots(path).map_err(|e| e.as_str().to_string())?;
        let (runtime_path, runtime_content_root, resolved) = match capability.as_ref() {
            Some(capability) => {
                let runtime_path = capability
                    .runtime_path("path")
                    .ok_or_else(|| "picker_capability_denied".to_string())?;
                let runtime_content_root = capability.runtime_path("content_root");
                let resolved =
                    resolve_pinned_content_roots(&runtime_path, runtime_content_root.as_deref())
                        .map_err(|e| e.as_str().to_string())?;
                (runtime_path, runtime_content_root, resolved)
            }
            None => (path.to_path_buf(), None, display_resolved.clone()),
        };
        Ok((
            ContentSourceSelection {
                runtime_path,
                runtime_content_root,
                display_path: display_resolved.content_source.clone(),
                display_content_root: display_resolved.content_root.clone(),
                capability,
                capability_required: false,
            },
            resolved,
        ))
    }

    async fn clear_content_source_error(&self) {
        let mut err = self.last_error.lock().await;
        if err
            .as_deref()
            .is_some_and(|e| e.starts_with("content_source") || e == "invalid_content_source")
        {
            *err = None;
        }
    }

    /// Restore a user-selected source from the native process's local configuration.
    pub async fn load_content_source_path(&self, path: Option<PathBuf>) {
        let _lifecycle = self.lifecycle.lock().await;
        *self.content_source.lock().await = path.map(|path| ContentSourceSelection {
            runtime_path: path.clone(),
            runtime_content_root: None,
            display_content_root: path.clone(),
            display_path: path,
            capability: None,
            // Accepted local-state trust: remembered selections resume without
            // another picker. resolve_roots still validates the directory layout;
            // new renderer-supplied paths still require a picker capability.
            capability_required: false,
        });
    }

    pub async fn set_last_error(&self, code: Option<String>) {
        *self.last_error.lock().await = code;
    }

    pub async fn resolve_roots(&self) -> Result<ResolvedNomadContentRoots, String> {
        let source = self.content_source.lock().await;
        let Some(source) = source.as_ref() else {
            return Err(ContentSourceError::Required.as_str().to_string());
        };
        if source.capability_required {
            return Err("picker_capability_required".into());
        }
        let resolved = if source.capability.is_some() {
            resolve_pinned_content_roots(
                &source.runtime_path,
                source.runtime_content_root.as_deref(),
            )
        } else {
            resolve_content_roots(&source.runtime_path)
        };
        resolved.map_err(|e| e.as_str().to_string())
    }

    fn roots_from_resolved(resolved: &ResolvedNomadContentRoots) -> NomadContentRoots {
        // Match NomadContentRoots::under defaults (512 KiB pages / 4 MiB files).
        NomadContentRoots {
            pages_dir: resolved.pages_dir.clone(),
            files_dir: resolved.files_dir.clone(),
            max_page_bytes: 512 * 1024,
            max_file_bytes: 4 * 1024 * 1024,
        }
    }

    pub async fn status(&self, enabled_pref: bool, display_name_pref: &str) -> NomadServingStatus {
        let allow_executable_pages = self.allow_executable_pages().await;
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            return self
                .status_from_node(node, true, allow_executable_pages)
                .await;
        }
        drop(guard);
        let (page_count, file_count, content_meta) = self.content_counts_offline().await;
        let last_error = self.last_error.lock().await.clone();
        let watcher_status = self.watcher_status.lock().await.clone();
        let content_source = self
            .content_source
            .lock()
            .await
            .as_ref()
            .map(|source| source.display_path.display().to_string());
        match content_meta {
            Some(meta) => NomadServingStatus {
                enabled: enabled_pref,
                running: false,
                destination_hash: None,
                identity_hash: None,
                display_name: display_name_pref.to_string(),
                page_count,
                file_count,
                stats: NomadServeStatsRow::default(),
                content_root: self.display_content_root(&meta).await,
                content_source,
                content_layout: Some(layout_label(meta.layout).into()),
                watcher_status: Some(watcher_status),
                last_error,
                allow_executable_pages,
            },
            None => NomadServingStatus {
                enabled: enabled_pref,
                running: false,
                destination_hash: None,
                identity_hash: None,
                display_name: display_name_pref.to_string(),
                page_count: 0,
                file_count: 0,
                stats: NomadServeStatsRow::default(),
                content_root: String::new(),
                content_source,
                content_layout: None,
                watcher_status: Some(watcher_status),
                last_error,
                allow_executable_pages,
            },
        }
    }

    pub async fn start(
        self: &Arc<Self>,
        transport_tx: tokio::sync::mpsc::Sender<TransportMessage>,
        identity: Identity,
        display_name: String,
    ) -> Result<NomadServingStatus, String> {
        let _lifecycle = self.lifecycle.lock().await;
        self.start_locked(transport_tx, identity, display_name)
            .await
    }

    async fn start_locked(
        self: &Arc<Self>,
        transport_tx: tokio::sync::mpsc::Sender<TransportMessage>,
        identity: Identity,
        display_name: String,
    ) -> Result<NomadServingStatus, String> {
        {
            let guard = self.inner.lock().await;
            if guard.is_some() {
                return Err("nomad serving already running".into());
            }
        }

        let resolved = match self.resolve_roots().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("[nomad-serving] content source unavailable before start: {e}");
                self.set_last_error(Some(e.clone())).await;
                *self.watcher_status.lock().await = "unavailable".into();
                return Err(e);
            }
        };

        #[cfg(test)]
        if let Some(gate) = self.start_test_gate.lock().await.take() {
            gate.entered.notify_one();
            gate.release.notified().await;
        }

        let store = NomadContentStore::new(Self::roots_from_resolved(&resolved)).map_err(|e| {
            tracing::error!("[nomad-serving] content store open failed: {e}");
            e.to_string()
        })?;
        store
            .ensure_default_index(&display_name)
            .map_err(|e| e.to_string())?;

        let allow_executable_pages = self.allow_executable_pages().await;
        let node = NomadNode::spawn(
            transport_tx,
            identity,
            store,
            Self::node_config(display_name.clone(), allow_executable_pages),
        )
        .await
        .map_err(|e| {
            tracing::warn!("[nomad-serving] start failed: {e}");
            e.to_string()
        })?;

        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            node.shutdown().await;
            return Err("nomad serving already running".into());
        }
        let status = self
            .status_from_resolved_node(&node, true, &resolved, allow_executable_pages)
            .await;
        *guard = Some(node);
        drop(guard);

        self.set_last_error(None).await;
        *self.watcher_status.lock().await = "ok".into();
        self.start_watcher().await;
        Ok(status)
    }

    pub async fn stop(&self) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_locked().await
    }

    async fn stop_locked(&self) -> Result<(), String> {
        #[cfg(test)]
        if let Some(gate) = self.stop_test_gate.lock().await.take() {
            gate.entered.notify_one();
            gate.release.notified().await;
        }
        self.stop_watcher().await;
        let mut guard = self.inner.lock().await;
        if let Some(node) = guard.take() {
            node.shutdown().await;
        }
        *self.watcher_status.lock().await = "ok".into();
        Ok(())
    }

    /// Replace the content capability and optionally restart the server as one
    /// lifecycle transaction. The old capability remains owned until its node
    /// and watcher have fully stopped; failed starts restore the old selection.
    pub async fn reconfigure_content_source(
        self: &Arc<Self>,
        path: PathBuf,
        capability: Option<ConsumedPathCapability>,
        transport_tx: tokio::sync::mpsc::Sender<TransportMessage>,
        identity: Identity,
        display_name: String,
    ) -> Result<(bool, Option<NomadServingStatus>), String> {
        let _lifecycle = self.lifecycle.lock().await;
        let (new_selection, _resolved) = Self::prepare_content_source(&path, capability)?;
        let was_running = self.inner.lock().await.is_some();

        if was_running {
            self.stop_locked().await?;
        }

        let old_selection = {
            let mut source = self.content_source.lock().await;
            source.replace(new_selection)
        };
        self.clear_content_source_error().await;

        if !was_running {
            self.stop_watcher().await;
            return Ok((false, None));
        }
        let rollback_name = display_name.clone();

        match self
            .start_locked(transport_tx.clone(), identity.clone(), display_name)
            .await
        {
            Ok(status) => Ok((true, Some(status))),
            Err(start_error) => {
                // No partially installed node may outlive the failed selection.
                if let Err(error) = self.stop_locked().await {
                    tracing::warn!(
                        "[nomad-serving] stop after failed content reconfigure: {error}"
                    );
                }
                let failed_selection = {
                    let mut source = self.content_source.lock().await;
                    std::mem::replace(&mut *source, old_selection)
                };

                let rollback_error = if was_running {
                    self.start_locked(transport_tx, identity, rollback_name)
                        .await
                        .err()
                } else {
                    None
                };
                drop(failed_selection);

                if let Some(rollback_error) = rollback_error {
                    return Err(format!(
                        "{start_error}; rollback_restart_failed:{rollback_error}"
                    ));
                }
                Err(start_error)
            }
        }
    }

    pub async fn set_display_name(&self, name: &str) {
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            node.set_display_name(name.to_string());
        }
    }

    pub async fn announce_now(&self) -> Result<(), String> {
        let guard = self.inner.lock().await;
        let Some(node) = guard.as_ref() else {
            return Err("nomad serving is not running".into());
        };
        node.announce_now().await.map_err(|e| e.to_string())
    }

    pub async fn try_read_local_route(
        &self,
        dest_hash: &str,
        path: &str,
    ) -> Option<Result<Vec<u8>, String>> {
        let guard = self.inner.lock().await;
        let node = guard.as_ref()?;
        let local = node.destination_hash_hex();
        let clean = dest_hash
            .chars()
            .filter(char::is_ascii_hexdigit)
            .collect::<String>();
        if !local.eq_ignore_ascii_case(&clean) {
            return None;
        }
        let trimmed = path.trim();
        let read = if trimmed.starts_with("/file/") {
            match normalize_file_route(trimmed) {
                Ok(route) => node.store().read_file_route(&route),
                Err(e) => return Some(Err(e.to_string())),
            }
        } else {
            match normalize_page_route(trimmed) {
                Ok(route) => node.store().read_page_route(&route),
                Err(e) => return Some(Err(e.to_string())),
            }
        };
        Some(read.map_err(|e| e.to_string()))
    }

    /// Local preview for NomadNet `/media` WebP under `pages/` (same jail as remote serve).
    pub async fn try_read_local_media(
        &self,
        dest_hash: &str,
        media_path: &str,
    ) -> Option<Result<Vec<u8>, String>> {
        let guard = self.inner.lock().await;
        let node = guard.as_ref()?;
        let local = node.destination_hash_hex();
        let clean = dest_hash
            .chars()
            .filter(char::is_ascii_hexdigit)
            .collect::<String>();
        if !local.eq_ignore_ascii_case(&clean) {
            return None;
        }
        let rel = media_path
            .trim()
            .strip_prefix("/media/")
            .unwrap_or(media_path.trim())
            .trim_start_matches('/');
        if rel.is_empty() {
            return Some(Err("invalid_media_path".into()));
        }
        Some(node.store().read_media_rel(rel).map_err(|e| e.to_string()))
    }

    pub async fn list_pages(&self) -> Result<Vec<nomad_core::NomadPageEntry>, String> {
        self.with_store(|store| store.list_pages().map_err(|e| e.to_string()))
            .await
    }

    pub async fn list_files(&self) -> Result<Vec<nomad_core::NomadPageEntry>, String> {
        self.with_store(|store| store.list_files().map_err(|e| e.to_string()))
            .await
    }

    pub async fn read_page(&self, rel: &str) -> Result<String, String> {
        self.with_store(|store| {
            let bytes = store
                .read_page_rel(rel)
                .map_err(|e| page_error("read", rel, &e))?;
            String::from_utf8(bytes).map_err(|e| {
                tracing::warn!("[nomad-serving] read page {rel} failed (page_not_utf8): {e}");
                "page_not_utf8".to_string()
            })
        })
        .await
    }

    pub async fn write_page(&self, rel: &str, content: &str) -> Result<(), String> {
        self.mutate_store(|store| {
            store
                .write_page_rel(rel, content.as_bytes())
                .map_err(|e| page_error("write", rel, &e))
        })
        .await
    }

    pub async fn delete_page(&self, rel: &str) -> Result<(), String> {
        self.mutate_store(|store| {
            store
                .delete_page_rel(rel)
                .map_err(|e| page_error("delete", rel, &e))
        })
        .await
    }

    pub async fn read_page_acl(&self, page_rel: &str) -> Result<Option<String>, String> {
        let resolved = self.resolve_roots().await?;
        super::nomad_page_acl::read_page_acl(&resolved.pages_dir, page_rel)
    }

    pub async fn write_page_acl(&self, page_rel: &str, content: &str) -> Result<(), String> {
        let resolved = self.resolve_roots().await?;
        super::nomad_page_acl::write_page_acl(&resolved.pages_dir, page_rel, content)?;
        self.reload_routes_if_running().await
    }

    pub async fn delete_page_acl(&self, page_rel: &str) -> Result<(), String> {
        let resolved = self.resolve_roots().await?;
        super::nomad_page_acl::delete_page_acl(&resolved.pages_dir, page_rel)?;
        self.reload_routes_if_running().await
    }

    pub async fn write_file_base64(&self, rel: &str, content_base64: &str) -> Result<(), String> {
        let bytes = BASE64
            .decode(content_base64)
            .map_err(|e| format!("invalid base64: {e}"))?;
        self.mutate_store(|store| store.write_file_rel(rel, &bytes).map_err(|e| e.to_string()))
            .await
    }

    pub async fn delete_file(&self, rel: &str) -> Result<(), String> {
        self.mutate_store(|store| store.delete_file_rel(rel).map_err(|e| e.to_string()))
            .await
    }

    async fn status_from_node(
        &self,
        node: &NomadNode,
        enabled: bool,
        allow_executable_pages: bool,
    ) -> NomadServingStatus {
        if let Ok(resolved) = self.resolve_roots().await {
            return self
                .status_from_resolved_node(node, enabled, &resolved, allow_executable_pages)
                .await;
        }
        let page_count = node.store().list_pages().map(|p| p.len()).unwrap_or(0);
        let file_count = node.store().list_files().map(|f| f.len()).unwrap_or(0);
        let last_error = self.last_error.lock().await.clone();
        let watcher_status = self.watcher_status.lock().await.clone();
        let content_source = self
            .content_source
            .lock()
            .await
            .as_ref()
            .map(|source| source.display_path.display().to_string());
        NomadServingStatus {
            enabled,
            running: true,
            destination_hash: Some(node.destination_hash_hex()),
            identity_hash: Some(node.identity_hash_hex()),
            display_name: node.display_name(),
            page_count,
            file_count,
            stats: stats_row(&node.stats()),
            content_root: content_source.clone().unwrap_or_default(),
            content_source,
            content_layout: None,
            watcher_status: Some(watcher_status),
            last_error,
            allow_executable_pages,
        }
    }

    async fn status_from_resolved_node(
        &self,
        node: &NomadNode,
        enabled: bool,
        resolved: &ResolvedNomadContentRoots,
        allow_executable_pages: bool,
    ) -> NomadServingStatus {
        let page_count = node.store().list_pages().map(|p| p.len()).unwrap_or(0);
        let file_count = node.store().list_files().map(|f| f.len()).unwrap_or(0);
        let last_error = self.last_error.lock().await.clone();
        let watcher_status = self.watcher_status.lock().await.clone();
        NomadServingStatus {
            enabled,
            running: true,
            destination_hash: Some(node.destination_hash_hex()),
            identity_hash: Some(node.identity_hash_hex()),
            display_name: node.display_name(),
            page_count,
            file_count,
            stats: stats_row(&node.stats()),
            content_root: self.display_content_root(resolved).await,
            content_source: self
                .content_source
                .lock()
                .await
                .as_ref()
                .map(|source| source.display_path.display().to_string()),
            content_layout: Some(layout_label(resolved.layout).into()),
            watcher_status: Some(watcher_status),
            last_error,
            allow_executable_pages,
        }
    }

    /// Offline page/file counts without opening NomadContentStore (avoids creating
    /// a missing sibling `files/` directory during status polls).
    async fn content_counts_offline(&self) -> (usize, usize, Option<ResolvedNomadContentRoots>) {
        let Ok(resolved) = self.resolve_roots().await else {
            return (0, 0, None);
        };
        let page_count = count_entries_if_dir(&resolved.pages_dir);
        let file_count = count_entries_if_dir(&resolved.files_dir);
        (page_count, file_count, Some(resolved))
    }

    async fn display_content_root(&self, resolved: &ResolvedNomadContentRoots) -> String {
        self.content_source
            .lock()
            .await
            .as_ref()
            .map(|source| source.display_content_root.display().to_string())
            .unwrap_or_else(|| resolved.content_root.display().to_string())
    }

    async fn mutate_store(
        &self,
        f: impl FnOnce(&NomadContentStore) -> Result<(), String>,
    ) -> Result<(), String> {
        let resolved = self.resolve_roots().await?;
        let store = NomadContentStore::new(Self::roots_from_resolved(&resolved))
            .map_err(|e| e.to_string())?;
        f(&store)?;
        self.reload_routes_if_running().await
    }

    async fn reload_routes_if_running(&self) -> Result<(), String> {
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            node.reload_routes().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    async fn with_store<T>(
        &self,
        f: impl FnOnce(&NomadContentStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            return f(node.store());
        }
        drop(guard);
        let resolved = self.resolve_roots().await?;
        let store = NomadContentStore::new(Self::roots_from_resolved(&resolved))
            .map_err(|e| e.to_string())?;
        f(&store)
    }

    async fn stop_watcher(&self) {
        let mut guard = self.watcher.lock().await;
        if let Some(state) = guard.take() {
            let _ = state.cancel.send(true);
            let _ = state.task.await;
        }
    }

    async fn start_watcher(self: &Arc<Self>) {
        self.stop_watcher().await;

        let Ok(resolved) = self.resolve_roots().await else {
            return;
        };

        let pages_dir = resolved.pages_dir.clone();
        let files_dir = resolved
            .files_dir
            .exists()
            .then(|| resolved.files_dir.clone());

        // Capacity-1 so filesystem floods coalesce instead of growing unbounded.
        let (event_tx, mut event_rx) = mpsc::channel::<()>(1);
        let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);

        let event_tx_cb = event_tx.clone();
        let watcher_result = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Err(e) = &res {
                    // Avoid dumping absolute paths / hostile filenames at warn level.
                    tracing::debug!("[nomad-serving] watcher event error: {e}");
                }
                let _ = event_tx_cb.try_send(());
            },
            notify::Config::default(),
        );

        let mut watcher = match watcher_result {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!("[nomad-serving] watcher init failed: {e}");
                *self.watcher_status.lock().await = "degraded".into();
                self.set_last_error(Some("watcher_init_failed".into()))
                    .await;
                return;
            }
        };

        if let Err(e) = watcher.watch(&pages_dir, RecursiveMode::Recursive) {
            tracing::warn!("[nomad-serving] watcher init failed on pages: {e}");
            *self.watcher_status.lock().await = "degraded".into();
            self.set_last_error(Some("watcher_init_failed".into()))
                .await;
            return;
        }
        let mut degraded = false;
        if let Some(ref files) = files_dir
            && files.exists()
            && let Err(e) = watcher.watch(files, RecursiveMode::Recursive)
        {
            tracing::warn!("[nomad-serving] watcher init failed on files: {e}");
            degraded = true;
        }
        // Keep degraded when pages watch succeeded but files watch failed — do not
        // overwrite with "ok" (UI relies on watcher_status for Reload from disk).
        *self.watcher_status.lock().await = initial_watcher_status_after_watches(degraded).into();

        let this = Arc::clone(self);
        let task = tokio::spawn(async move {
            let mut pending = false;
            let mut debounce = tokio::time::interval(WATCHER_DEBOUNCE);
            debounce.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let mut reconcile = tokio::time::interval(WATCHER_RECONCILE);
            reconcile.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            break;
                        }
                    }
                    msg = event_rx.recv() => {
                        if msg.is_none() {
                            break;
                        }
                        pending = true;
                    }
                    _ = debounce.tick() => {
                        if pending {
                            pending = false;
                            if let Err(e) = this.reload_routes_if_running().await {
                                this.warn_watcher_rate_limited(&format!(
                                    "[nomad-serving] route reload after FS change failed: {e}"
                                ))
                                .await;
                                *this.watcher_status.lock().await = "degraded".into();
                            }
                        }
                    }
                    _ = reconcile.tick() => {
                        if !this.is_running().await {
                            continue;
                        }
                        if let Err(e) = this.reload_routes_if_running().await {
                            this.warn_watcher_rate_limited(&format!(
                                "[nomad-serving] route reconcile failed: {e}"
                            ))
                            .await;
                            *this.watcher_status.lock().await = "degraded".into();
                            continue;
                        }
                        match this.resolve_roots().await {
                            Ok(r) if !r.pages_dir.exists() => {
                                this.warn_watcher_rate_limited(
                                    "[nomad-serving] content source unavailable (pages missing)",
                                )
                                .await;
                                this.set_last_error(Some("content_source_unavailable".into()))
                                    .await;
                                *this.watcher_status.lock().await = "unavailable".into();
                            }
                            Ok(_) => {
                                *this.watcher_status.lock().await = "ok".into();
                            }
                            Err(e) => {
                                this.warn_watcher_rate_limited(&format!(
                                    "[nomad-serving] content source unavailable: {e}"
                                ))
                                .await;
                                this.set_last_error(Some(e)).await;
                                *this.watcher_status.lock().await = "unavailable".into();
                            }
                        }
                    }
                }
            }
        });
        *self.watcher.lock().await = Some(WatcherState {
            _watcher: watcher,
            cancel: cancel_tx,
            task,
        });
    }

    async fn warn_watcher_rate_limited(&self, message: &str) {
        let now = Instant::now();
        let mut last = self.last_watcher_warn.lock().await;
        let mut suppressed = self.watcher_warn_suppressed.lock().await;
        if last.is_none_or(|t| now.duration_since(t) >= WATCHER_WARN_INTERVAL) {
            if *suppressed > 0 {
                tracing::warn!("{message} (suppressed {suppressed} similar warnings)");
            } else {
                tracing::warn!("{message}");
            }
            *last = Some(now);
            *suppressed = 0;
        } else {
            *suppressed += 1;
        }
    }
}

fn stats_row(stats: &nomad_core::NomadServeStats) -> NomadServeStatsRow {
    NomadServeStatsRow {
        request_count: stats.request_count,
        page_hits: stats.page_hits,
        file_hits: stats.file_hits,
        not_found_count: stats.not_found_count,
        last_request_ms: stats.last_request_ms,
        visitors: stats.visitors,
    }
}

#[cfg(test)]
mod stats_row_tests {
    use super::stats_row;

    #[test]
    fn stats_row_copies_visitors() {
        let stats = nomad_core::NomadServeStats {
            request_count: 3,
            page_hits: 2,
            file_hits: 1,
            media_hits: 0,
            not_found_count: 0,
            last_request_ms: Some(1),
            visitors: 7,
        };
        let row = stats_row(&stats);
        assert_eq!(row.visitors, 7);
        assert_eq!(row.request_count, 3);
        assert_eq!(row.page_hits, 2);
        assert_eq!(row.file_hits, 1);
    }
}

/// Initial watcher status after pages watch succeeded.
/// Files-dir watch failure must leave the status degraded (not silently ok).
fn initial_watcher_status_after_watches(files_watch_failed: bool) -> &'static str {
    if files_watch_failed { "degraded" } else { "ok" }
}

fn count_entries_if_dir(dir: &Path) -> usize {
    fn walk(path: &Path, depth: usize) -> usize {
        if depth > 32 {
            return 0;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            return 0;
        };
        let mut n = 0;
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                n += walk(&p, depth + 1);
            } else if p.is_file() {
                n += 1;
            }
        }
        n
    }
    if !dir.is_dir() {
        return 0;
    }
    walk(dir, 0)
}

#[cfg(test)]
mod tests {
    use super::super::nomad_content_source::NomadContentLayout;
    use super::*;

    async fn handle_with_site() -> (tempfile::TempDir, Arc<NomadServerHandle>, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("pages")).unwrap();
        std::fs::write(site.join("pages/index.mu"), b"> hi").unwrap();
        let handle = Arc::new(NomadServerHandle::new());
        handle
            .set_content_source_path(&site, None)
            .await
            .expect("set source");
        (dir, handle, site)
    }

    #[tokio::test]
    async fn status_without_content_source_has_no_layout() {
        let handle = Arc::new(NomadServerHandle::new());
        assert!(!handle.is_running().await);
        let status = handle.status(false, "Test").await;
        assert!(!status.running);
        assert_eq!(status.display_name, "Test");
        assert!(status.content_layout.is_none());
        assert!(status.content_source.is_none());
        assert!(status.content_root.is_empty(), "{:?}", status.content_root);
    }

    #[test]
    fn invalid_base64_is_rejected() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let err = rt.block_on(async {
            let (_dir, handle, _) = handle_with_site().await;
            handle
                .write_file_base64("x.bin", "!!!not-base64!!!")
                .await
                .expect_err("invalid base64")
        });
        assert!(err.contains("invalid base64"), "{err}");
    }

    #[tokio::test]
    async fn set_content_source_site_root() {
        let (_dir, handle, _site) = handle_with_site().await;
        let status = handle.status(false, "N").await;
        assert!(status.content_source.is_some());
        assert_eq!(status.content_layout.as_deref(), Some("site_root"));
    }

    #[tokio::test]
    async fn resolve_roots_requires_content_source() {
        let handle = Arc::new(NomadServerHandle::new());
        let err = handle.resolve_roots().await.expect_err("required");
        assert_eq!(err, "content_source_required");
    }

    #[tokio::test]
    async fn restored_content_source_resumes_without_another_picker() {
        let dir = tempfile::tempdir().expect("tempdir");
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("pages")).unwrap();
        let handle = Arc::new(NomadServerHandle::new());
        handle.load_content_source_path(Some(site)).await;

        let roots = handle
            .resolve_roots()
            .await
            .expect("restore valid selection");
        assert_eq!(roots.layout, NomadContentLayout::SiteRoot);
        let status = handle.status(true, "N").await;
        assert!(!status.running);
        assert!(status.content_source.is_some());
    }

    #[test]
    fn files_watch_failure_keeps_watcher_degraded() {
        assert_eq!(initial_watcher_status_after_watches(true), "degraded");
        assert_eq!(initial_watcher_status_after_watches(false), "ok");
    }

    #[tokio::test]
    async fn page_file_round_trip_offline() {
        let (_dir, handle, _) = handle_with_site().await;
        handle
            .write_page("index.mu", "> hello")
            .await
            .expect("write page");
        let pages = handle.list_pages().await.expect("list pages");
        assert!(
            pages
                .iter()
                .any(|p| p.path == "index.mu" || p.path.ends_with("index.mu")),
            "{pages:?}"
        );
        let content = handle.read_page("index.mu").await.expect("read page");
        assert!(content.contains("hello"), "{content}");
        handle.delete_page("index.mu").await.expect("delete page");
        let pages_after = handle.list_pages().await.expect("list after delete");
        assert!(!pages_after.iter().any(|p| p.path.contains("index.mu")));

        handle
            .write_file_base64("note.txt", &BASE64.encode(b"file-bytes"))
            .await
            .expect("write file");
        let files = handle.list_files().await.expect("list files");
        assert!(
            files.iter().any(|f| f.path.contains("note.txt")),
            "{files:?}"
        );
        handle.delete_file("note.txt").await.expect("delete file");
        let status = handle.status(false, "N").await;
        assert_eq!(status.page_count, 0);
    }

    #[test]
    fn page_error_codes_are_stable_snake_case() {
        assert_eq!(
            page_error_code(&NomadError::TooLarge {
                size: 600_000,
                max: 524_288
            }),
            "page_too_large"
        );
        assert_eq!(
            page_error_code(&NomadError::NotFound("index.mu".into())),
            "page_not_found"
        );
        // Symlink rejection collapses into PathTraversal upstream.
        assert_eq!(
            page_error_code(&NomadError::PathTraversal),
            "invalid_page_path"
        );
        assert_eq!(
            page_error_code(&NomadError::InvalidPath("path too long".into())),
            "invalid_page_path"
        );
        assert_eq!(
            page_error_code(&NomadError::Io(std::io::Error::other("disk"))),
            "page_io_error"
        );
        assert_eq!(
            page_error_code(&NomadError::message("lock poisoned")),
            "page_write_failed"
        );
        assert_eq!(
            page_error_code(&NomadError::TransportClosed),
            "page_write_failed"
        );
    }

    #[tokio::test]
    async fn page_mutations_return_codes_not_english_prose() {
        let (_dir, handle, _) = handle_with_site().await;

        let err = handle
            .read_page("missing.mu")
            .await
            .expect_err("missing page");
        assert_eq!(err, "page_not_found");

        let err = handle
            .delete_page("../escape.mu")
            .await
            .expect_err("traversal");
        assert_eq!(err, "invalid_page_path");

        // 512 KiB max_page_bytes cap, enforced upstream on write.
        let oversized = "x".repeat(512 * 1024 + 1);
        let err = handle
            .write_page("big.mu", &oversized)
            .await
            .expect_err("size cap");
        assert_eq!(err, "page_too_large");
    }

    #[tokio::test]
    async fn set_content_source_clears_matching_last_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let site = dir.path().join("site");
        std::fs::create_dir_all(site.join("pages")).unwrap();
        std::fs::write(site.join("pages/index.mu"), b"> hi").unwrap();
        let handle = Arc::new(NomadServerHandle::new());
        handle
            .set_last_error(Some("content_source_unavailable".into()))
            .await;
        let resolved = handle
            .set_content_source_path(&site, None)
            .await
            .expect("set source");
        assert_eq!(resolved.layout, NomadContentLayout::SiteRoot);
        let status = handle.status(false, "N").await;
        assert!(status.last_error.is_none());

        handle
            .set_last_error(Some("watcher_init_failed".into()))
            .await;
        let site2 = dir.path().join("site2");
        std::fs::create_dir_all(site2.join("pages")).unwrap();
        std::fs::write(site2.join("pages/index.mu"), b"> hi").unwrap();
        handle
            .set_content_source_path(&site2, None)
            .await
            .expect("set second source");
        let status2 = handle.status(false, "N").await;
        // Unrelated last_error codes are preserved across content-source updates.
        assert_eq!(status2.last_error.as_deref(), Some("watcher_init_failed"));
        assert_eq!(status2.content_layout.as_deref(), Some("site_root"));
    }

    #[tokio::test]
    async fn start_and_content_reconfigure_are_one_serial_lifecycle() {
        let dir = tempfile::tempdir().expect("tempdir");
        let site_a = dir.path().join("site-a");
        let site_b = dir.path().join("site-b");
        std::fs::create_dir_all(site_a.join("pages")).unwrap();
        std::fs::create_dir_all(site_b.join("pages")).unwrap();
        std::fs::write(site_a.join("pages/index.mu"), b"> A").unwrap();
        std::fs::write(site_b.join("pages/index.mu"), b"> B").unwrap();
        let site_b_assert = site_b.clone();

        let handle = Arc::new(NomadServerHandle::new());
        handle
            .set_content_source_path(&site_a, None)
            .await
            .expect("set A");
        let gate = Arc::new(NomadStartTestGate::default());
        *handle.start_test_gate.lock().await = Some(gate.clone());

        let (transport_tx, _transport_rx) = mpsc::channel(32);
        let start_handle = handle.clone();
        let start_tx = transport_tx.clone();
        let start = tokio::spawn(async move {
            start_handle
                .start(start_tx, Identity::new(), "A node".into())
                .await
        });
        gate.entered.notified().await;

        let reconfigure_handle = handle.clone();
        let reconfigure_tx = transport_tx.clone();
        let mut reconfigure = tokio::spawn(async move {
            reconfigure_handle
                .reconfigure_content_source(
                    site_b,
                    None,
                    reconfigure_tx,
                    Identity::new(),
                    "B node".into(),
                )
                .await
        });

        // Reconfiguration cannot replace A while start owns the lifecycle.
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut reconfigure)
                .await
                .is_err()
        );
        gate.release.notify_one();

        let started = start.await.expect("start task").expect("start A");
        assert_eq!(started.display_name, "A node");
        let (was_running, reconfigured) = reconfigure
            .await
            .expect("reconfigure task")
            .expect("reconfigure B");
        assert!(was_running);
        let reconfigured = reconfigured.expect("B restarted");
        assert_eq!(reconfigured.display_name, "B node");
        assert_eq!(handle.read_page("index.mu").await.expect("read B"), "> B");
        let status = handle.status(true, "fallback").await;
        let reported_source = PathBuf::from(status.content_source.expect("reported B source"));
        assert_eq!(
            reported_source
                .canonicalize()
                .expect("canonical reported B"),
            site_b_assert.canonicalize().expect("canonical selected B")
        );
        assert_eq!(status.display_name, "B node");
        handle.stop().await.expect("stop B");
    }

    #[tokio::test]
    async fn stopped_server_is_not_resurrected_by_queued_reconfigure() {
        let dir = tempfile::tempdir().expect("tempdir");
        let site_a = dir.path().join("site-a");
        let site_b = dir.path().join("site-b");
        std::fs::create_dir_all(site_a.join("pages")).unwrap();
        std::fs::create_dir_all(site_b.join("pages")).unwrap();
        std::fs::write(site_a.join("pages/index.mu"), b"> A").unwrap();
        std::fs::write(site_b.join("pages/index.mu"), b"> B").unwrap();

        let handle = Arc::new(NomadServerHandle::new());
        handle
            .set_content_source_path(&site_a, None)
            .await
            .expect("set A");
        let (transport_tx, _transport_rx) = mpsc::channel(32);
        handle
            .start(transport_tx.clone(), Identity::new(), "A node".into())
            .await
            .expect("start A");

        let gate = Arc::new(NomadStopTestGate::default());
        *handle.stop_test_gate.lock().await = Some(gate.clone());
        let stop_handle = handle.clone();
        let stop = tokio::spawn(async move { stop_handle.stop().await });
        gate.entered.notified().await;

        let reconfigure_handle = handle.clone();
        let reconfigure_tx = transport_tx.clone();
        let mut reconfigure = tokio::spawn(async move {
            reconfigure_handle
                .reconfigure_content_source(
                    site_b,
                    None,
                    reconfigure_tx,
                    Identity::new(),
                    "B node".into(),
                )
                .await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut reconfigure)
                .await
                .is_err()
        );
        gate.release.notify_one();

        stop.await.expect("stop task").expect("stop A");
        let (was_running, status) = reconfigure
            .await
            .expect("reconfigure task")
            .expect("reconfigure B while stopped");
        assert!(!was_running);
        assert!(status.is_none());
        assert!(!handle.is_running().await);
        assert_eq!(handle.read_page("index.mu").await.expect("read B"), "> B");
    }
}
