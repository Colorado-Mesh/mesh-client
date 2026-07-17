//! Local Nomad Network page/file hosting via `nomad-core` / rsNomad.

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use nomad_core::{NomadContentRoots, NomadContentStore, NomadNode, NomadNodeConfig};
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::Mutex;

use super::types::{NomadServeStatsRow, NomadServingStatus};

const DEFAULT_ANNOUNCE_INTERVAL_SECS: u64 = 3600;

pub struct NomadServerHandle {
    inner: Mutex<Option<NomadNode>>,
    content_base: PathBuf,
}

impl NomadServerHandle {
    pub fn new(storage_dir: PathBuf) -> Self {
        Self {
            inner: Mutex::new(None),
            content_base: storage_dir.join("nomadnetwork"),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    pub async fn status(&self, enabled_pref: bool, display_name_pref: &str) -> NomadServingStatus {
        let guard = self.inner.lock().await;
        if let Some(node) = guard.as_ref() {
            let stats = stats_row(&node.stats());
            let page_count = node.store().list_pages().map(|p| p.len()).unwrap_or(0);
            let file_count = node.store().list_files().map(|f| f.len()).unwrap_or(0);
            NomadServingStatus {
                enabled: true,
                running: true,
                destination_hash: Some(node.destination_hash_hex()),
                identity_hash: Some(node.identity_hash_hex()),
                display_name: node.display_name(),
                page_count,
                file_count,
                stats,
                content_root: self.content_base.display().to_string(),
            }
        } else {
            let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base)).ok();
            let page_count = store
                .as_ref()
                .and_then(|s| s.list_pages().ok())
                .map(|p| p.len())
                .unwrap_or(0);
            let file_count = store
                .as_ref()
                .and_then(|s| s.list_files().ok())
                .map(|f| f.len())
                .unwrap_or(0);
            NomadServingStatus {
                enabled: enabled_pref,
                running: false,
                destination_hash: None,
                identity_hash: None,
                display_name: display_name_pref.to_string(),
                page_count,
                file_count,
                stats: NomadServeStatsRow::default(),
                content_root: self.content_base.display().to_string(),
            }
        }
    }

    pub async fn start(
        &self,
        transport_tx: tokio::sync::mpsc::Sender<TransportMessage>,
        identity: Identity,
        display_name: String,
    ) -> Result<NomadServingStatus, String> {
        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            return Err("nomad serving already running".into());
        }
        let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
            .map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
        let status = NomadServingStatus {
            enabled: true,
            running: true,
            destination_hash: Some(node.destination_hash_hex()),
            identity_hash: Some(node.identity_hash_hex()),
            display_name: node.display_name(),
            page_count: node.store().list_pages().map(|p| p.len()).unwrap_or(0),
            file_count: node.store().list_files().map(|f| f.len()).unwrap_or(0),
            stats: stats_row(&node.stats()),
            content_root: self.content_base.display().to_string(),
        };
        *guard = Some(node);
        Ok(status)
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        if let Some(node) = guard.take() {
            node.shutdown();
        }
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
            let bytes = store.read_page_rel(rel).map_err(|e| e.to_string())?;
            String::from_utf8(bytes).map_err(|e| e.to_string())
        })
        .await
    }

    pub async fn write_page(&self, rel: &str, content: &str) -> Result<(), String> {
        {
            let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
                .map_err(|e| e.to_string())?;
            store
                .write_page_rel(rel, content.as_bytes())
                .map_err(|e| e.to_string())?;
        }
        self.reload_routes_if_running().await
    }

    pub async fn delete_page(&self, rel: &str) -> Result<(), String> {
        {
            let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
                .map_err(|e| e.to_string())?;
            store.delete_page_rel(rel).map_err(|e| e.to_string())?;
        }
        self.reload_routes_if_running().await
    }

    pub async fn write_file_base64(&self, rel: &str, content_base64: &str) -> Result<(), String> {
        let bytes = BASE64
            .decode(content_base64)
            .map_err(|e| format!("invalid base64: {e}"))?;
        {
            let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
                .map_err(|e| e.to_string())?;
            store
                .write_file_rel(rel, &bytes)
                .map_err(|e| e.to_string())?;
        }
        self.reload_routes_if_running().await
    }

    pub async fn delete_file(&self, rel: &str) -> Result<(), String> {
        {
            let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
                .map_err(|e| e.to_string())?;
            store.delete_file_rel(rel).map_err(|e| e.to_string())?;
        }
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
        let store = NomadContentStore::new(NomadContentRoots::under(&self.content_base))
            .map_err(|e| e.to_string())?;
        f(&store)
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
