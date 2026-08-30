//! Local Nomad Network page/file hosting via `nomad-core` / rsNomad.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use nomad_core::{
    NomadContentRoots, NomadContentStore, NomadError, NomadNode, NomadNodeConfig,
    normalize_file_route, normalize_page_route,
};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::{Mutex, mpsc};

use super::nomad_content_source::{
    ContentSourceError, ResolvedNomadContentRoots, layout_label, resolve_content_roots,
};
use super::types::{NomadServeStatsRow, NomadServingStatus};

const DEFAULT_ANNOUNCE_INTERVAL_SECS: u64 = 3600;
const WATCHER_DEBOUNCE: Duration = Duration::from_millis(200);
const WATCHER_RECONCILE: Duration = Duration::from_secs(45);
const WATCHER_WARN_INTERVAL: Duration = Duration::from_secs(60);

struct WatcherState {
    _watcher: RecommendedWatcher,
    cancel: tokio::sync::watch::Sender<bool>,
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
    content_source: Mutex<Option<PathBuf>>,
    last_error: Mutex<Option<String>>,
    watcher_status: Mutex<String>,
    watcher: Mutex<Option<WatcherState>>,
    last_watcher_warn: Mutex<Option<Instant>>,
    watcher_warn_suppressed: Mutex<u32>,
}

impl NomadServerHandle {
    pub fn new() -> Self {
        Self {
            lifecycle: Mutex::new(()),
            inner: Mutex::new(None),
            content_source: Mutex::new(None),
            last_error: Mutex::new(None),
            watcher_status: Mutex::new("ok".into()),
            watcher: Mutex::new(None),
            last_watcher_warn: Mutex::new(None),
            watcher_warn_suppressed: Mutex::new(0),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    /// Configure the required external content source path (watched folder).
    pub async fn set_content_source_path(
        self: &Arc<Self>,
        path: PathBuf,
    ) -> Result<ResolvedNomadContentRoots, String> {
        let resolved = resolve_content_roots(&path).map_err(|e| e.as_str().to_string())?;
        {
            let mut guard = self.content_source.lock().await;
            *guard = Some(resolved.content_source.clone());
        }
        {
            let mut err = self.last_error.lock().await;
            if err
                .as_deref()
                .is_some_and(|e| e.starts_with("content_source") || e == "invalid_content_source")
            {
                *err = None;
            }
        }
        // Roots are bound into NomadContentStore at start — callers must restart
        // the host node when serving is already running (see set_nomad_content_source).
        if !self.is_running().await {
            // Keep watcher stopped while offline.
            self.stop_watcher().await;
        }
        Ok(resolved)
    }

    /// Restore a previously persisted content source without validating restart.
    pub async fn load_content_source_path(&self, path: Option<PathBuf>) {
        *self.content_source.lock().await = path;
    }

    pub async fn set_last_error(&self, code: Option<String>) {
        *self.last_error.lock().await = code;
    }

    pub async fn resolve_roots(&self) -> Result<ResolvedNomadContentRoots, String> {
        let src = self.content_source.lock().await.clone();
        let Some(path) = src else {
            return Err(ContentSourceError::Required.as_str().to_string());
        };
        resolve_content_roots(&path).map_err(|e| e.as_str().to_string())
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
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            return self.status_from_node(node, true).await;
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
            .map(|p| p.display().to_string());
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
                content_root: meta.content_root.display().to_string(),
                content_source: Some(meta.content_source.display().to_string()),
                content_layout: Some(layout_label(meta.layout).into()),
                watcher_status: Some(watcher_status),
                last_error,
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

        let store = NomadContentStore::new(Self::roots_from_resolved(&resolved)).map_err(|e| {
            tracing::error!("[nomad-serving] content store open failed: {e}");
            e.to_string()
        })?;
        store
            .ensure_default_index(&display_name)
            .map_err(|e| e.to_string())?;

        let node = NomadNode::spawn(
            transport_tx,
            identity,
            store,
            NomadNodeConfig {
                display_name: display_name.clone(),
                announce_interval: Some(Duration::from_secs(DEFAULT_ANNOUNCE_INTERVAL_SECS)),
                announce_at_start: true,
            },
        )
        .await
        .map_err(|e| {
            tracing::warn!("[nomad-serving] start failed: {e}");
            e.to_string()
        })?;

        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            node.shutdown();
            return Err("nomad serving already running".into());
        }
        let status = self.status_from_resolved_node(&node, true, &resolved).await;
        *guard = Some(node);
        drop(guard);

        self.set_last_error(None).await;
        *self.watcher_status.lock().await = "ok".into();
        self.start_watcher().await;
        Ok(status)
    }

    pub async fn stop(&self) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().await;
        self.stop_watcher().await;
        let mut guard = self.inner.lock().await;
        if let Some(node) = guard.take() {
            node.shutdown();
        }
        *self.watcher_status.lock().await = "ok".into();
        Ok(())
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

    async fn status_from_node(&self, node: &NomadNode, enabled: bool) -> NomadServingStatus {
        if let Ok(resolved) = self.resolve_roots().await {
            return self
                .status_from_resolved_node(node, enabled, &resolved)
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
            .map(|p| p.display().to_string());
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
        }
    }

    async fn status_from_resolved_node(
        &self,
        node: &NomadNode,
        enabled: bool,
        resolved: &ResolvedNomadContentRoots,
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
            content_root: resolved.content_root.display().to_string(),
            content_source: Some(resolved.content_source.display().to_string()),
            content_layout: Some(layout_label(resolved.layout).into()),
            watcher_status: Some(watcher_status),
            last_error,
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
        if let Some(ref files) = files_dir {
            if files.exists() {
                if let Err(e) = watcher.watch(files, RecursiveMode::Recursive) {
                    tracing::warn!("[nomad-serving] watcher init failed on files: {e}");
                    degraded = true;
                }
            }
        }
        // Keep degraded when pages watch succeeded but files watch failed — do not
        // overwrite with "ok" (UI relies on watcher_status for Reload from disk).
        *self.watcher_status.lock().await = initial_watcher_status_after_watches(degraded).into();

        *self.watcher.lock().await = Some(WatcherState {
            _watcher: watcher,
            cancel: cancel_tx,
        });

        let this = Arc::clone(self);
        tokio::spawn(async move {
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
            .set_content_source_path(site.clone())
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
        assert!(status.content_root.is_empty());
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
            .set_content_source_path(site)
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
            .set_content_source_path(site2)
            .await
            .expect("set second source");
        let status2 = handle.status(false, "N").await;
        // Unrelated last_error codes are preserved across content-source updates.
        assert_eq!(status2.last_error.as_deref(), Some("watcher_init_failed"));
        assert_eq!(status2.content_layout.as_deref(), Some("site_root"));
    }
}
