#[cfg(test)]
use std::cell::Cell;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const STAGING_DIR_NAME: &str = ".rncp-pending";
const DATA_DIR_NAME: &str = "data";
const OWNER_MARKER_NAME: &str = "owner-v1";
const OWNER_MARKER: &[u8] = b"mesh-client-rncp-staging-v1\n";
const MANIFEST_NAME: &str = "manifest-v1.json";
const MANIFEST_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 128 * 1024;
const MAX_REMOTE_FILENAME_BYTES: usize = 255;
pub(super) const MAX_PENDING_OFFERS: usize = 16;
pub(super) const MAX_PENDING_BYTES: u64 = 100 * 1024 * 1024;
pub(super) const MAX_PENDING_BYTES_PER_IDENTITY: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Writing,
    Pending,
    Promoting,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    transfer_id: String,
    resource_id: String,
    staged_name: String,
    file_name: String,
    bytes: u64,
    identity_hash: String,
    phase: Phase,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Manifest {
    version: u32,
    entries: Vec<Entry>,
}

impl Manifest {
    fn empty() -> Self {
        Self {
            version: MANIFEST_VERSION,
            entries: Vec::new(),
        }
    }
}

struct State {
    save_dir: PathBuf,
    staging_dir: PathBuf,
    data_dir: PathBuf,
    manifest_path: PathBuf,
    manifest: Manifest,
    #[cfg(test)]
    fail_manifest_persist_after: Cell<Option<usize>>,
    #[cfg(test)]
    fail_destination_replace: Cell<bool>,
}

#[derive(Clone)]
pub(super) struct RncpStaging {
    inner: Arc<Mutex<State>>,
}

#[derive(Debug)]
pub(super) enum StoreOutcome {
    Pending {
        transfer_id: String,
        file_name: String,
        bytes: usize,
        identity_hash: String,
    },
    Promoted {
        file_name: String,
        path: PathBuf,
        bytes: usize,
        identity_hash: String,
    },
}

#[derive(Debug)]
pub(super) struct PromotedOffer {
    pub file_name: String,
    pub path: PathBuf,
    pub bytes: usize,
    pub identity_hash: String,
}

impl RncpStaging {
    /// Reconcile crash remnants without starting an inbound listener.
    /// Only manifest-owned or exact opaque stage names are removed.
    pub(super) async fn reconcile(save_dir: PathBuf) -> Result<(), String> {
        tokio::task::spawn_blocking(move || initialize(save_dir).map(drop))
            .await
            .map_err(|e| format!("rncp staging reconcile task failed: {e}"))?
    }

    pub(super) async fn open(save_dir: PathBuf) -> Result<Self, String> {
        tokio::task::spawn_blocking(move || {
            let state = initialize(save_dir)?;
            Ok(Self {
                inner: Arc::new(Mutex::new(state)),
            })
        })
        .await
        .map_err(|e| format!("rncp staging init task failed: {e}"))?
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn store(
        &self,
        resource_id: [u8; 32],
        identity_hash: [u8; 16],
        file_name: String,
        data: Arc<[u8]>,
        pending: bool,
        overwrite: bool,
    ) -> Result<StoreOutcome, String> {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            let mut state = inner
                .lock()
                .map_err(|_| "rncp staging lock poisoned".to_string())?;
            state.store(
                resource_id,
                identity_hash,
                &file_name,
                &data,
                pending,
                overwrite,
            )
        })
        .await
        .map_err(|e| format!("rncp staging write task failed: {e}"))?
    }

    pub(super) async fn accept(
        &self,
        transfer_id: String,
        overwrite: bool,
    ) -> Result<PromotedOffer, String> {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            inner
                .lock()
                .map_err(|_| "rncp staging lock poisoned".to_string())?
                .accept(&transfer_id, overwrite)
        })
        .await
        .map_err(|e| format!("rncp staging accept task failed: {e}"))?
    }

    pub(super) async fn reject(&self, transfer_id: String) -> Result<(), String> {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            inner
                .lock()
                .map_err(|_| "rncp staging lock poisoned".to_string())?
                .reject(&transfer_id)
        })
        .await
        .map_err(|e| format!("rncp staging reject task failed: {e}"))?
    }

    pub(super) async fn cleanup(&self) -> Result<(), String> {
        let inner = Arc::clone(&self.inner);
        tokio::task::spawn_blocking(move || {
            inner
                .lock()
                .map_err(|_| "rncp staging lock poisoned".to_string())?
                .cleanup()
        })
        .await
        .map_err(|e| format!("rncp staging cleanup task failed: {e}"))?
    }
}

impl State {
    fn store(
        &mut self,
        resource_id: [u8; 32],
        identity_hash: [u8; 16],
        file_name: &str,
        data: &[u8],
        pending: bool,
        overwrite: bool,
    ) -> Result<StoreOutcome, String> {
        let file_name = validate_remote_filename(file_name)?;
        let identity_hex = hex::encode(identity_hash);
        if pending {
            self.check_pending_quota(&identity_hex, data.len() as u64)?;
        }

        let transfer_id = Uuid::new_v4().to_string();
        let writing_name = format!("{transfer_id}.write");
        self.manifest.entries.push(Entry {
            transfer_id: transfer_id.clone(),
            resource_id: hex::encode(resource_id),
            staged_name: writing_name.clone(),
            file_name: file_name.clone(),
            bytes: data.len() as u64,
            identity_hash: identity_hex.clone(),
            phase: Phase::Writing,
        });
        if let Err(error) = self.persist_manifest() {
            self.remove_manifest_entry(&transfer_id);
            return Err(error);
        }

        let writing_path = self.data_dir.join(&writing_name);
        let part_name = format!("{transfer_id}.part");
        let part_path = self.data_dir.join(&part_name);
        let write_result = (|| {
            let mut file = create_private_file(&writing_path)?;
            file.write_all(data)
                .map_err(|e| format!("write RNCP staged payload: {e}"))?;
            file.sync_all()
                .map_err(|e| format!("sync RNCP staged payload: {e}"))?;
            drop(file);
            fs::rename(&writing_path, &part_path)
                .map_err(|e| format!("seal RNCP staged payload: {e}"))?;
            sync_dir(&self.data_dir)?;
            Ok::<(), String>(())
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&writing_path);
            let _ = fs::remove_file(&part_path);
            self.remove_manifest_entry(&transfer_id);
            let _ = self.persist_manifest();
            return Err(error);
        }

        let entry = self
            .manifest
            .entries
            .iter_mut()
            .find(|entry| entry.transfer_id == transfer_id)
            .ok_or_else(|| "RNCP staging manifest entry disappeared".to_string())?;
        entry.staged_name = part_name;
        entry.phase = Phase::Pending;
        if let Err(error) = self.persist_manifest() {
            let _ = remove_owned_regular_file(&part_path);
            self.remove_manifest_entry(&transfer_id);
            if let Err(persist_error) = self.persist_manifest() {
                tracing::warn!("rncp pending rollback persist failed: {persist_error}");
            }
            return Err(error);
        }

        if pending {
            return Ok(StoreOutcome::Pending {
                transfer_id,
                file_name,
                bytes: data.len(),
                identity_hash: identity_hex,
            });
        }

        let promoted = match self.promote(&transfer_id, overwrite) {
            Ok(promoted) => promoted,
            Err(error) => {
                let _ =
                    remove_owned_regular_file(&self.data_dir.join(format!("{transfer_id}.part")));
                self.remove_manifest_entry(&transfer_id);
                if let Err(persist_error) = self.persist_manifest() {
                    tracing::warn!(
                        "rncp direct-promotion rollback persist failed: {persist_error}"
                    );
                }
                return Err(error);
            }
        };
        Ok(StoreOutcome::Promoted {
            file_name: promoted.file_name,
            path: promoted.path,
            bytes: promoted.bytes,
            identity_hash: promoted.identity_hash,
        })
    }

    fn accept(&mut self, transfer_id: &str, overwrite: bool) -> Result<PromotedOffer, String> {
        self.promote(transfer_id, overwrite)
    }

    fn promote(&mut self, transfer_id: &str, overwrite: bool) -> Result<PromotedOffer, String> {
        let entry = self
            .manifest
            .entries
            .iter()
            .find(|entry| entry.transfer_id == transfer_id && entry.phase == Phase::Pending)
            .cloned()
            .ok_or_else(|| "no pending rncp offer with that id".to_string())?;
        let staged_path = self.checked_stage_path(&entry)?;
        let final_path = final_path(&self.save_dir, &entry.file_name, overwrite)?;
        {
            let promotion_path = promotion_path(&self.save_dir, transfer_id);
            self.set_phase(transfer_id, Phase::Promoting)?;

            let replacement = (|| {
                install_staged_file(&staged_path, &promotion_path, &self.save_dir)?;
                if overwrite && final_path.exists() {
                    self.replace_destination(&promotion_path, &final_path)?;
                } else {
                    publish_file_without_replacing(&promotion_path, &final_path)?;
                }
                if let Err(error) = sync_dir(&self.save_dir) {
                    tracing::warn!("sync committed RNCP replacement failed: {error}");
                }
                Ok::<(), String>(())
            })();
            if let Err(error) = replacement {
                if let Err(cleanup_error) = remove_owned_regular_file(&promotion_path) {
                    tracing::warn!("remove failed RNCP promotion temp failed: {cleanup_error}");
                }
                if let Err(sync_error) = sync_dir(&self.save_dir) {
                    tracing::warn!("sync failed RNCP promotion rollback failed: {sync_error}");
                }
                if let Err(phase_error) = self.set_phase(transfer_id, Phase::Pending) {
                    tracing::warn!("persist RNCP promotion rollback failed: {phase_error}");
                }
                return Err(error);
            }
        }

        self.remove_manifest_entry(transfer_id);
        if let Err(error) = self.persist_manifest() {
            // The destination replacement is already committed. A stale
            // on-disk manifest entry is safe: startup recovery removes only
            // application-owned stage/temp files and preserves final_path.
            tracing::warn!("persist committed RNCP promotion failed: {error}");
        }
        if let Err(error) = remove_owned_regular_file(&staged_path) {
            tracing::warn!("remove committed RNCP stage failed: {error}");
        }
        if let Err(error) = sync_dir(&self.data_dir) {
            tracing::warn!("sync committed RNCP stage removal failed: {error}");
        }
        Ok(PromotedOffer {
            file_name: final_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or(entry.file_name),
            path: final_path,
            bytes: entry.bytes as usize,
            identity_hash: entry.identity_hash,
        })
    }

    fn reject(&mut self, transfer_id: &str) -> Result<(), String> {
        let entry = self
            .manifest
            .entries
            .iter()
            .find(|entry| entry.transfer_id == transfer_id && entry.phase == Phase::Pending)
            .cloned()
            .ok_or_else(|| "no pending rncp offer with that id".to_string())?;
        let staged_path = self.checked_stage_path(&entry)?;
        fs::remove_file(&staged_path).map_err(|e| format!("delete RNCP staged payload: {e}"))?;
        sync_dir(&self.data_dir)?;
        self.remove_manifest_entry(transfer_id);
        self.persist_manifest()
    }

    fn cleanup(&mut self) -> Result<(), String> {
        for entry in &self.manifest.entries {
            remove_owned_regular_file(&self.data_dir.join(&entry.staged_name))?;
            if entry.phase == Phase::Promoting {
                remove_owned_regular_file(&promotion_path(&self.save_dir, &entry.transfer_id))?;
            }
        }
        cleanup_opaque_stage_files(&self.data_dir)?;
        sync_dir(&self.data_dir)?;
        sync_dir(&self.save_dir)?;
        self.manifest = Manifest::empty();
        self.persist_manifest()
    }

    fn check_pending_quota(&self, identity_hash: &str, incoming: u64) -> Result<(), String> {
        let pending: Vec<&Entry> = self
            .manifest
            .entries
            .iter()
            .filter(|entry| entry.phase == Phase::Pending)
            .collect();
        if pending.len() >= MAX_PENDING_OFFERS {
            return Err("too_many_pending".into());
        }
        let total = pending
            .iter()
            .try_fold(incoming, |total, entry| total.checked_add(entry.bytes))
            .ok_or_else(|| "pending_bytes_exceeded".to_string())?;
        if total > MAX_PENDING_BYTES {
            return Err("pending_bytes_exceeded".into());
        }
        let peer_total = pending
            .iter()
            .filter(|entry| entry.identity_hash == identity_hash)
            .try_fold(incoming, |total, entry| total.checked_add(entry.bytes))
            .ok_or_else(|| "sender_pending_bytes_exceeded".to_string())?;
        if peer_total > MAX_PENDING_BYTES_PER_IDENTITY {
            return Err("sender_pending_bytes_exceeded".into());
        }
        Ok(())
    }

    fn checked_stage_path(&self, entry: &Entry) -> Result<PathBuf, String> {
        validate_staged_name(&entry.staged_name, &entry.transfer_id, entry.phase)?;
        let path = self.data_dir.join(&entry.staged_name);
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| format!("stat RNCP staged payload: {e}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("RNCP staged payload is not a regular file".into());
        }
        if metadata.len() != entry.bytes {
            return Err("RNCP staged payload size changed".into());
        }
        Ok(path)
    }

    fn remove_manifest_entry(&mut self, transfer_id: &str) {
        self.manifest
            .entries
            .retain(|entry| entry.transfer_id != transfer_id);
    }

    fn set_phase(&mut self, transfer_id: &str, phase: Phase) -> Result<(), String> {
        let entry = self
            .manifest
            .entries
            .iter_mut()
            .find(|entry| entry.transfer_id == transfer_id)
            .ok_or_else(|| "RNCP staging manifest entry disappeared".to_string())?;
        let previous = entry.phase;
        entry.phase = phase;
        if let Err(error) = self.persist_manifest() {
            if let Some(entry) = self
                .manifest
                .entries
                .iter_mut()
                .find(|entry| entry.transfer_id == transfer_id)
            {
                entry.phase = previous;
            }
            return Err(error);
        }
        Ok(())
    }

    #[allow(clippy::unused_self)] // `self` owns the test-only replacement fault injector.
    fn replace_destination(&self, source: &Path, destination: &Path) -> Result<(), String> {
        #[cfg(test)]
        if self.fail_destination_replace.replace(false) {
            return Err("injected RNCP destination replacement failure".into());
        }
        replace_promoted_file(source, destination)
    }

    fn persist_manifest(&self) -> Result<(), String> {
        #[cfg(test)]
        if let Some(remaining) = self.fail_manifest_persist_after.get() {
            if remaining == 0 {
                self.fail_manifest_persist_after.set(None);
                return Err("injected RNCP manifest persistence failure".into());
            }
            self.fail_manifest_persist_after.set(Some(remaining - 1));
        }
        let bytes = serde_json::to_vec(&self.manifest)
            .map_err(|e| format!("serialize RNCP staging manifest: {e}"))?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err("RNCP staging manifest exceeds size limit".into());
        }
        let tmp = self
            .staging_dir
            .join(format!("{MANIFEST_NAME}.tmp-{}", Uuid::new_v4()));
        let result = (|| {
            let mut file = create_private_file(&tmp)?;
            file.write_all(&bytes)
                .map_err(|e| format!("write RNCP staging manifest: {e}"))?;
            file.sync_all()
                .map_err(|e| format!("sync RNCP staging manifest: {e}"))?;
            drop(file);
            replace_file(&tmp, &self.manifest_path)?;
            sync_dir(&self.staging_dir)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result
    }
}

fn initialize(save_dir: PathBuf) -> Result<State, String> {
    ensure_safe_dir(&save_dir)?;
    let staging_dir = save_dir.join(STAGING_DIR_NAME);
    ensure_private_dir(&staging_dir)?;
    let data_dir = staging_dir.join(DATA_DIR_NAME);
    ensure_private_dir(&data_dir)?;
    let marker_path = staging_dir.join(OWNER_MARKER_NAME);
    let manifest_path = staging_dir.join(MANIFEST_NAME);

    let marker_valid = read_owner_marker(&marker_path)?;
    if !marker_valid {
        write_owner_marker(&marker_path)?;
    }

    let manifest = match read_manifest(&manifest_path) {
        Ok(Some(manifest)) => manifest,
        Ok(None) if marker_valid => {
            // A valid owner marker makes the opaque UUID stage names ours.
            // This also closes the crash window where the manifest was lost
            // between two atomic replacements.
            cleanup_opaque_stage_files(&data_dir)?;
            Manifest::empty()
        }
        Ok(None) => Manifest::empty(),
        Err(error) if marker_valid => {
            tracing::warn!("invalid RNCP staging manifest; cleaning owned opaque files: {error}");
            cleanup_opaque_stage_files(&data_dir)?;
            Manifest::empty()
        }
        Err(error) => return Err(error),
    };
    if marker_valid {
        for entry in &manifest.entries {
            remove_owned_regular_file(&data_dir.join(&entry.staged_name))?;
            if entry.phase == Phase::Promoting {
                remove_owned_regular_file(&promotion_path(&save_dir, &entry.transfer_id))?;
            }
        }
        // Exact UUID stage names are also application-owned. Clean any that
        // were sealed after the old manifest was synced but before its phase
        // update reached disk.
        cleanup_opaque_stage_files(&data_dir)?;
        sync_dir(&data_dir)?;
        cleanup_manifest_temps(&staging_dir)?;
    }

    let state = State {
        save_dir,
        staging_dir,
        data_dir,
        manifest_path,
        manifest: Manifest::empty(),
        #[cfg(test)]
        fail_manifest_persist_after: Cell::new(None),
        #[cfg(test)]
        fail_destination_replace: Cell::new(false),
    };
    state.persist_manifest()?;
    Ok(state)
}

fn read_owner_marker(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("RNCP staging owner marker is not a regular file".into());
            }
            let bytes = fs::read(path).map_err(|e| format!("read RNCP owner marker: {e}"))?;
            if bytes != OWNER_MARKER {
                return Err("RNCP staging owner marker is invalid".into());
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("stat RNCP owner marker: {error}")),
    }
}

fn write_owner_marker(path: &Path) -> Result<(), String> {
    let mut file = create_private_file(path)?;
    file.write_all(OWNER_MARKER)
        .map_err(|e| format!("write RNCP owner marker: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("sync RNCP owner marker: {e}"))
}

fn read_manifest(path: &Path) -> Result<Option<Manifest>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("stat RNCP staging manifest: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("RNCP staging manifest is not a regular file".into());
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err("RNCP staging manifest exceeds size limit".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|e| format!("read RNCP staging manifest: {e}"))?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse RNCP staging manifest: {e}"))?;
    validate_manifest(&manifest)?;
    Ok(Some(manifest))
}

fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.version != MANIFEST_VERSION || manifest.entries.len() > MAX_PENDING_OFFERS + 3 {
        return Err("RNCP staging manifest schema is invalid".into());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for entry in &manifest.entries {
        Uuid::parse_str(&entry.transfer_id)
            .map_err(|_| "RNCP staging manifest has an invalid transfer id".to_string())?;
        if hex::decode(&entry.resource_id).map_or(true, |bytes| bytes.len() != 32)
            || hex::decode(&entry.identity_hash).map_or(true, |bytes| bytes.len() != 16)
        {
            return Err("RNCP staging manifest has an invalid hash".into());
        }
        validate_remote_filename(&entry.file_name)?;
        validate_staged_name(&entry.staged_name, &entry.transfer_id, entry.phase)?;
        if !ids.insert(&entry.transfer_id) || !names.insert(&entry.staged_name) {
            return Err("RNCP staging manifest has duplicate entries".into());
        }
    }
    Ok(())
}

fn validate_remote_filename(name: &str) -> Result<String, String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > MAX_REMOTE_FILENAME_BYTES
        || name.chars().any(char::is_control)
        || Path::new(name).components().count() != 1
        || !matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
    {
        return Err("invalid_remote_filename".into());
    }
    Ok(name.to_string())
}

fn validate_staged_name(name: &str, transfer_id: &str, phase: Phase) -> Result<(), String> {
    let suffix = match phase {
        Phase::Writing => ".write",
        Phase::Pending | Phase::Promoting => ".part",
    };
    if name != format!("{transfer_id}{suffix}") {
        return Err("RNCP staging manifest has an invalid staged name".into());
    }
    Ok(())
}

fn promotion_path(save_dir: &Path, transfer_id: &str) -> PathBuf {
    save_dir.join(format!(".mesh-rncp-{transfer_id}.promote"))
}

fn final_path(save_dir: &Path, file_name: &str, overwrite: bool) -> Result<PathBuf, String> {
    let file_name = validate_remote_filename(file_name)?;
    let base = save_dir.join(&file_name);
    if overwrite || !base.exists() {
        return Ok(base);
    }
    for index in 1..=10_000 {
        let candidate = save_dir.join(format!("{file_name}.{index}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("could not allocate RNCP destination filename".into())
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    ensure_safe_dir(path)?;
    set_private_dir_permissions(path)
}

fn ensure_safe_dir(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(format!("{} is not a safe directory", path.display()));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path)
                .map_err(|e| format!("create private directory {}: {e}", path.display()))?;
        }
        Err(error) => {
            return Err(format!(
                "stat private directory {}: {error}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    atomic_replace_file(source, destination)
        .map_err(|e| format!("replace RNCP staging manifest: {e}"))
}

fn replace_promoted_file(source: &Path, destination: &Path) -> Result<(), String> {
    atomic_replace_file(source, destination).map_err(|e| format!("replace RNCP destination: {e}"))
}

fn atomic_replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    // `TempPath::persist` uses the platform's atomic replace primitive (rename
    // on Unix and MoveFileExW with REPLACE_EXISTING on Windows) without
    // introducing unsafe code into this crate. This path is owned by the RNCP
    // staging directory and was created with create_new, so treating it as a
    // temporary path cannot adopt an attacker-controlled file.
    let source = tempfile::TempPath::try_from_path(source.to_path_buf())?;
    match source.persist(destination) {
        Ok(()) => Ok(()),
        Err(mut error) => {
            // A failed persistence must leave the source available for retry.
            // TempPath otherwise removes its path when the error is dropped.
            error.path.disable_cleanup(true);
            Err(error.error)
        }
    }
}

fn publish_file_without_replacing(source: &Path, destination: &Path) -> Result<(), String> {
    // Publish a complete, synced promotion file. Copy fallbacks never write the
    // visible destination, and persist_noclobber preserves an existing file.
    let source = tempfile::TempPath::try_from_path(source.to_path_buf())
        .map_err(|error| format!("open RNCP promotion temp: {error}"))?;
    match source.persist_noclobber(destination) {
        Ok(()) => Ok(()),
        Err(mut error) => {
            error.path.disable_cleanup(true);
            Err(format!("publish RNCP destination: {}", error.error))
        }
    }
}

fn create_private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|e| format!("create private file {}: {e}", path.display()))
}

fn install_staged_file(
    staged_path: &Path,
    final_path: &Path,
    save_dir: &Path,
) -> Result<(), String> {
    install_staged_file_with_link(staged_path, final_path, save_dir, |source, destination| {
        fs::hard_link(source, destination)
    })
}

fn install_staged_file_with_link<F>(
    staged_path: &Path,
    final_path: &Path,
    save_dir: &Path,
    link: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    if let Err(link_error) = link(staged_path, final_path) {
        if !matches!(
            link_error.kind(),
            io::ErrorKind::Unsupported
                | io::ErrorKind::PermissionDenied
                | io::ErrorKind::CrossesDevices
        ) {
            return Err(format!("promote RNCP staged payload: {link_error}"));
        }

        let mut input = File::open(staged_path).map_err(|copy_error| {
            format!("promote RNCP staged payload: {link_error}; open copy source: {copy_error}")
        })?;
        let mut output = create_private_file(final_path).map_err(|copy_error| {
            format!(
                "promote RNCP staged payload: {link_error}; create copy destination: {copy_error}"
            )
        })?;
        let copy_result = io::copy(&mut input, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|copy_error| {
                format!("promote RNCP staged payload: {link_error}; copy fallback: {copy_error}")
            });
        if let Err(error) = copy_result {
            let _ = fs::remove_file(final_path);
            return Err(error);
        }
    }

    if let Err(error) = sync_dir(save_dir) {
        let _ = fs::remove_file(final_path);
        return Err(error);
    }
    Ok(())
}

fn set_private_dir_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("set private directory permissions: {e}"))?;
    }
    Ok(())
}

fn sync_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| format!("sync directory {}: {e}", path.display()))?;
    }
    Ok(())
}

fn remove_owned_regular_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::remove_file(path)
                .map_err(|e| format!("remove owned RNCP stage {}: {e}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("stat owned RNCP stage {}: {error}", path.display())),
    }
}

fn cleanup_opaque_stage_files(data_dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(data_dir).map_err(|e| format!("read RNCP data dir: {e}"))? {
        let entry = entry.map_err(|e| format!("read RNCP data entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let owned = name
            .strip_suffix(".write")
            .or_else(|| name.strip_suffix(".part"))
            .is_some_and(|id| Uuid::parse_str(id).is_ok());
        if owned {
            remove_owned_regular_file(&entry.path())?;
        }
    }
    Ok(())
}

fn cleanup_manifest_temps(staging_dir: &Path) -> Result<(), String> {
    for entry in fs::read_dir(staging_dir).map_err(|e| format!("read RNCP staging dir: {e}"))? {
        let entry = entry.map_err(|e| format!("read RNCP staging entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_prefix(&format!("{MANIFEST_NAME}.tmp-"))
            && Uuid::parse_str(id).is_ok()
        {
            remove_owned_regular_file(&entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_entry(identity_hash: &str, bytes: u64) -> Entry {
        let transfer_id = Uuid::new_v4().to_string();
        Entry {
            resource_id: hex::encode([1; 32]),
            staged_name: format!("{transfer_id}.part"),
            transfer_id,
            file_name: "pending.bin".into(),
            bytes,
            identity_hash: identity_hash.into(),
            phase: Phase::Pending,
        }
    }

    #[test]
    fn manifest_persist_failures_leave_no_unreachable_stage_or_quota_entry() {
        for fail_after in [0, 1] {
            let dir = tempfile::tempdir().expect("tempdir");
            let mut state = initialize(dir.path().to_path_buf()).expect("state");
            state.fail_manifest_persist_after.set(Some(fail_after));

            let error = state
                .store([42; 32], [43; 16], "payload.bin", b"payload", true, false)
                .expect_err("injected manifest failure");

            assert_eq!(error, "injected RNCP manifest persistence failure");
            assert!(state.manifest.entries.is_empty());
            assert!(
                fs::read_dir(&state.data_dir)
                    .expect("data dir")
                    .next()
                    .is_none(),
                "fail_after={fail_after} left staged bytes"
            );
            let persisted = read_manifest(&state.manifest_path)
                .expect("manifest")
                .expect("present");
            assert!(persisted.entries.is_empty());
        }
    }

    #[test]
    fn promotion_copies_without_clobber_when_hard_links_are_unsupported() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staged = dir.path().join("payload.part");
        let final_path = dir.path().join("payload.bin");
        let promotion = promotion_path(dir.path(), &Uuid::new_v4().to_string());
        fs::write(&staged, b"payload").expect("stage");

        install_staged_file_with_link(&staged, &promotion, dir.path(), |_, _| {
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "hard links disabled for test",
            ))
        })
        .expect("copy fallback");

        assert!(!final_path.exists());
        publish_file_without_replacing(&promotion, &final_path).expect("atomic publication");
        assert_eq!(fs::read(&final_path).expect("promoted"), b"payload");
        assert_eq!(fs::read(&staged).expect("stage retained"), b"payload");
    }

    #[test]
    fn startup_removes_interrupted_promotion_without_exposing_partial_destination() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut state = initialize(dir.path().to_path_buf()).expect("staging");
        let mut entry = test_entry(&hex::encode([1; 16]), 7);
        entry.phase = Phase::Promoting;
        fs::write(state.data_dir.join(&entry.staged_name), b"payload").expect("stage");
        let promotion = promotion_path(dir.path(), &entry.transfer_id);
        fs::write(&promotion, b"part").expect("interrupted copy");
        let destination = dir.path().join(&entry.file_name);
        state.manifest.entries.push(entry);
        state.persist_manifest().expect("manifest");
        drop(state);
        let recovered = initialize(dir.path().to_path_buf()).expect("recover");
        assert!(!destination.exists());
        assert!(!promotion.exists());
        assert!(recovered.manifest.entries.is_empty());
    }

    #[tokio::test]
    async fn pending_payload_is_manifest_owned_then_accepts() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let outcome = staging
            .store(
                [1; 32],
                [2; 16],
                "hello.txt".into(),
                Arc::from(&b"hello"[..]),
                true,
                false,
            )
            .await
            .expect("store");
        let StoreOutcome::Pending { transfer_id, .. } = outcome else {
            panic!("expected pending")
        };
        let promoted = staging.accept(transfer_id, false).await.expect("accept");
        assert_eq!(fs::read(promoted.path).expect("read"), b"hello");
        let manifest = read_manifest(&dir.path().join(STAGING_DIR_NAME).join(MANIFEST_NAME))
            .expect("manifest")
            .expect("present");
        assert!(manifest.entries.is_empty());
    }

    #[tokio::test]
    async fn failed_overwrite_replacement_preserves_original_and_pending_offer() {
        let dir = tempfile::tempdir().expect("tempdir");
        let destination = dir.path().join("payload.bin");
        fs::write(&destination, b"original").expect("existing destination");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let StoreOutcome::Pending { transfer_id, .. } = staging
            .store(
                [21; 32],
                [22; 16],
                "payload.bin".into(),
                Arc::from(&b"replacement"[..]),
                true,
                true,
            )
            .await
            .expect("store")
        else {
            panic!("expected pending")
        };

        let mut state = staging.inner.lock().expect("state");
        state.fail_destination_replace.set(true);
        let error = state
            .accept(&transfer_id, true)
            .expect_err("injected replacement failure");

        assert_eq!(error, "injected RNCP destination replacement failure");
        assert_eq!(
            fs::read(&destination).expect("original retained"),
            b"original"
        );
        assert!(!promotion_path(dir.path(), &transfer_id).exists());
        let entry = state
            .manifest
            .entries
            .iter()
            .find(|entry| entry.transfer_id == transfer_id)
            .expect("pending entry retained");
        assert_eq!(entry.phase, Phase::Pending);
        assert!(state.checked_stage_path(entry).is_ok());
    }

    #[tokio::test]
    async fn committed_overwrite_survives_manifest_cleanup_failure_and_recovery() {
        let dir = tempfile::tempdir().expect("tempdir");
        let destination = dir.path().join("payload.bin");
        fs::write(&destination, b"original").expect("existing destination");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let StoreOutcome::Pending { transfer_id, .. } = staging
            .store(
                [23; 32],
                [24; 16],
                "payload.bin".into(),
                Arc::from(&b"replacement"[..]),
                true,
                true,
            )
            .await
            .expect("store")
        else {
            panic!("expected pending")
        };

        {
            let mut state = staging.inner.lock().expect("state");
            // Persisting Promoting succeeds; removing the committed entry fails.
            state.fail_manifest_persist_after.set(Some(1));
            state
                .accept(&transfer_id, true)
                .expect("committed replacement");
            assert!(state.manifest.entries.is_empty());
            let persisted = read_manifest(&state.manifest_path)
                .expect("manifest")
                .expect("present");
            assert_eq!(persisted.entries.len(), 1);
            assert_eq!(persisted.entries[0].phase, Phase::Promoting);
        }

        assert_eq!(fs::read(&destination).expect("replacement"), b"replacement");
        drop(staging);
        RncpStaging::reconcile(dir.path().to_path_buf())
            .await
            .expect("reconcile");
        assert_eq!(
            fs::read(&destination).expect("replacement retained"),
            b"replacement"
        );
        assert!(!promotion_path(dir.path(), &transfer_id).exists());
    }

    #[tokio::test]
    async fn startup_deletes_only_manifest_owned_payloads() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let outcome = staging
            .store(
                [3; 32],
                [4; 16],
                "pending.bin".into(),
                Arc::from(&b"pending"[..]),
                true,
                false,
            )
            .await
            .expect("store");
        let StoreOutcome::Pending { .. } = outcome else {
            panic!("expected pending")
        };
        let neighbor = dir
            .path()
            .join(STAGING_DIR_NAME)
            .join(DATA_DIR_NAME)
            .join("keep.me");
        fs::write(&neighbor, b"neighbor").expect("neighbor");
        drop(staging);

        RncpStaging::reconcile(dir.path().to_path_buf())
            .await
            .expect("reconcile");
        assert_eq!(fs::read(neighbor).expect("neighbor retained"), b"neighbor");
        let owned: Vec<_> = fs::read_dir(dir.path().join(STAGING_DIR_NAME).join(DATA_DIR_NAME))
            .expect("data dir")
            .flatten()
            .filter(|entry| entry.file_name() != "keep.me")
            .collect();
        assert!(owned.is_empty());
    }

    #[tokio::test]
    async fn invalid_remote_filename_never_creates_payload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let error = staging
            .store(
                [5; 32],
                [6; 16],
                "../escape".into(),
                Arc::from(&b"bad"[..]),
                true,
                false,
            )
            .await
            .expect_err("rejected");
        assert_eq!(error, "invalid_remote_filename");
    }

    #[test]
    fn pending_quota_is_global_and_per_identity() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut state = initialize(dir.path().to_path_buf()).expect("state");
        let identity = hex::encode([7; 16]);
        state.manifest.entries = vec![test_entry(&identity, MAX_PENDING_BYTES_PER_IDENTITY)];
        assert_eq!(
            state.check_pending_quota(&identity, 1),
            Err("sender_pending_bytes_exceeded".into())
        );

        state.manifest.entries = vec![
            test_entry(&hex::encode([8; 16]), MAX_PENDING_BYTES / 2),
            test_entry(&hex::encode([9; 16]), MAX_PENDING_BYTES / 2),
        ];
        assert_eq!(
            state.check_pending_quota(&hex::encode([10; 16]), 1),
            Err("pending_bytes_exceeded".into())
        );
    }

    #[tokio::test]
    async fn promotion_never_clobbers_when_overwrite_is_false() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("hello.txt"), b"original").expect("existing");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        let StoreOutcome::Promoted { path, .. } = staging
            .store(
                [11; 32],
                [12; 16],
                "hello.txt".into(),
                Arc::from(&b"received"[..]),
                false,
                false,
            )
            .await
            .expect("promote")
        else {
            panic!("expected promotion")
        };
        assert_eq!(fs::read(dir.path().join("hello.txt")).unwrap(), b"original");
        assert_eq!(path, dir.path().join("hello.txt.1"));
        assert_eq!(fs::read(path).unwrap(), b"received");
    }

    #[tokio::test]
    async fn missing_manifest_cleans_only_exact_owned_stage_names() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staging = RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("staging");
        drop(staging);
        let stage_dir = dir.path().join(STAGING_DIR_NAME);
        let data_dir = stage_dir.join(DATA_DIR_NAME);
        let owned = data_dir.join(format!("{}.part", Uuid::new_v4()));
        let neighbor = data_dir.join("keep.part");
        fs::write(&owned, b"owned").expect("owned");
        fs::write(&neighbor, b"neighbor").expect("neighbor");
        fs::remove_file(stage_dir.join(MANIFEST_NAME)).expect("remove manifest");

        RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("reopen");
        assert!(!owned.exists());
        assert_eq!(fs::read(neighbor).expect("neighbor retained"), b"neighbor");
    }

    #[tokio::test]
    async fn unmarked_legacy_directory_preserves_all_existing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stage_dir = dir.path().join(STAGING_DIR_NAME);
        fs::create_dir(&stage_dir).expect("legacy stage dir");
        let uuid_prefixed = stage_dir.join(format!("{}-notes.txt", Uuid::new_v4()));
        let neighbor = stage_dir.join("not-owned.txt");
        fs::write(&uuid_prefixed, b"user notes").expect("uuid-prefixed user file");
        fs::write(&neighbor, b"neighbor").expect("neighbor");

        RncpStaging::open(dir.path().to_path_buf())
            .await
            .expect("open");
        assert_eq!(
            fs::read(uuid_prefixed).expect("uuid-prefixed file retained"),
            b"user notes"
        );
        assert_eq!(fs::read(neighbor).expect("neighbor retained"), b"neighbor");
    }
}
