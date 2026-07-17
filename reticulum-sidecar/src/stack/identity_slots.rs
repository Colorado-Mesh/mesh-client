//! Multi-slot local identity storage under `config/identities/<id>/`.
//!
//! Working key remains `{config_dir}/identity` (what the live stack loads).
//! Each slot mirrors that file plus `slot.json` metadata. `active_identity`
//! points at the current slot id. Switch = sync working → old slot, copy
//! target → working, update pointer, then stack restart (caller).

use std::fs;
use std::path::{Path, PathBuf};

use super::identity_apply::IDENTITY_FILE_NAME;
use super::types::StackIdentity;

pub const ACTIVE_IDENTITY_FILE: &str = "active_identity";
pub const IDENTITIES_DIR: &str = "identities";
pub const SLOT_META_FILE: &str = "slot.json";
pub const DEFAULT_SLOT_ID: &str = "default";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IdentitySlotMeta {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub identity_hash: Option<String>,
    #[serde(default)]
    pub lxmf_hash: Option<String>,
}

pub fn is_safe_slot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn identities_root(config_dir: &Path) -> PathBuf {
    config_dir.join(IDENTITIES_DIR)
}

pub fn slot_dir(config_dir: &Path, id: &str) -> PathBuf {
    identities_root(config_dir).join(id)
}

pub fn slot_identity_path(config_dir: &Path, id: &str) -> PathBuf {
    slot_dir(config_dir, id).join(IDENTITY_FILE_NAME)
}

pub fn active_identity_path(config_dir: &Path) -> PathBuf {
    config_dir.join(ACTIVE_IDENTITY_FILE)
}

pub fn working_identity_path(config_dir: &Path) -> PathBuf {
    config_dir.join(IDENTITY_FILE_NAME)
}

pub fn read_active_id(config_dir: &Path) -> String {
    let path = active_identity_path(config_dir);
    if let Ok(s) = fs::read_to_string(&path) {
        let id = s.trim();
        if is_safe_slot_id(id) {
            return id.to_string();
        }
    }
    DEFAULT_SLOT_ID.to_string()
}

pub fn write_active_id(config_dir: &Path, id: &str) -> Result<(), String> {
    if !is_safe_slot_id(id) {
        return Err("invalid identity_id".into());
    }
    let path = active_identity_path(config_dir);
    let tmp = config_dir.join(format!(
        ".{ACTIVE_IDENTITY_FILE}.{}.tmp",
        std::process::id()
    ));
    fs::write(&tmp, id).map_err(|e| format!("write active_identity temp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("write active_identity: {e}")
    })
}

fn files_differ(a: &Path, b: &Path) -> bool {
    match (fs::read(a), fs::read(b)) {
        (Ok(x), Ok(y)) => x != y,
        _ => true,
    }
}

pub fn read_slot_meta(config_dir: &Path, id: &str) -> Option<IdentitySlotMeta> {
    let path = slot_dir(config_dir, id).join(SLOT_META_FILE);
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_slot_meta(
    config_dir: &Path,
    id: &str,
    display_name: Option<&str>,
    identity_hash: Option<&str>,
    lxmf_hash: Option<&str>,
) -> Result<(), String> {
    if !is_safe_slot_id(id) {
        return Err("invalid identity_id".into());
    }
    let dir = slot_dir(config_dir, id);
    fs::create_dir_all(&dir).map_err(|e| format!("create slot dir: {e}"))?;
    let meta = IdentitySlotMeta {
        id: id.to_string(),
        display_name: display_name.map(str::to_string).filter(|s| !s.is_empty()),
        identity_hash: identity_hash.map(str::to_string).filter(|s| !s.is_empty()),
        lxmf_hash: lxmf_hash.map(str::to_string).filter(|s| !s.is_empty()),
    };
    let path = dir.join(SLOT_META_FILE);
    let json = serde_json::to_vec_pretty(&meta).map_err(|e| format!("serialize slot meta: {e}"))?;
    fs::write(path, json).map_err(|e| format!("write slot meta: {e}"))
}

/// Migrate flat `{config}/identity` into `identities/default/` and keep working file in sync.
pub fn ensure_slot_layout(config_dir: &Path) -> Result<(), String> {
    let root = identities_root(config_dir);
    fs::create_dir_all(&root).map_err(|e| format!("create identities dir: {e}"))?;

    let working = working_identity_path(config_dir);
    let default_identity = slot_identity_path(config_dir, DEFAULT_SLOT_ID);

    if working.exists() && !default_identity.exists() {
        fs::create_dir_all(slot_dir(config_dir, DEFAULT_SLOT_ID))
            .map_err(|e| format!("create default slot: {e}"))?;
        fs::copy(&working, &default_identity).map_err(|e| format!("migrate identity: {e}"))?;
    }

    if !active_identity_path(config_dir).exists() {
        write_active_id(config_dir, DEFAULT_SLOT_ID)?;
    }

    let active = read_active_id(config_dir);
    let active_path = slot_identity_path(config_dir, &active);
    if working.exists() {
        if let Some(parent) = active_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create active slot: {e}"))?;
        }
        if !active_path.exists() || files_differ(&working, &active_path) {
            fs::copy(&working, &active_path).map_err(|e| format!("sync active slot: {e}"))?;
        }
    } else if active_path.exists() {
        fs::copy(&active_path, &working).map_err(|e| format!("restore working identity: {e}"))?;
    }

    Ok(())
}

/// Mirror the working identity file + hashes into a specific slot (not necessarily active).
pub fn sync_slot_from_working(
    config_dir: &Path,
    slot_id: &str,
    display_name: Option<&str>,
    identity_hash: Option<&str>,
    lxmf_hash: Option<&str>,
) -> Result<(), String> {
    if !is_safe_slot_id(slot_id) {
        return Err("invalid identity_id".into());
    }
    ensure_slot_layout(config_dir)?;
    let working = working_identity_path(config_dir);
    if !working.exists() {
        return Ok(());
    }
    let dest = slot_identity_path(config_dir, slot_id);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create slot: {e}"))?;
    }
    fs::copy(&working, &dest).map_err(|e| format!("copy to slot: {e}"))?;
    write_slot_meta(config_dir, slot_id, display_name, identity_hash, lxmf_hash)?;
    Ok(())
}

/// Mirror the working identity file + hashes into the active slot.
pub fn sync_active_slot_from_working(
    config_dir: &Path,
    display_name: Option<&str>,
    identity_hash: Option<&str>,
    lxmf_hash: Option<&str>,
) -> Result<(), String> {
    let active = read_active_id(config_dir);
    sync_slot_from_working(config_dir, &active, display_name, identity_hash, lxmf_hash)
}

fn new_slot_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("id-{ms}")
}

pub fn list_slot_rows(
    config_dir: &Path,
    active_identity: &StackIdentity,
) -> Vec<serde_json::Value> {
    if let Err(e) = ensure_slot_layout(config_dir) {
        tracing::warn!("identity slot layout before list failed: {e}");
    }
    let active_id = read_active_id(config_dir);
    let mut rows: Vec<serde_json::Value> = Vec::new();
    let root = identities_root(config_dir);
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            if !is_safe_slot_id(&id) || !entry.path().is_dir() {
                continue;
            }
            let meta = read_slot_meta(config_dir, &id);
            let configured = slot_identity_path(config_dir, &id).exists();
            let is_active = id == active_id;
            let display_name = meta
                .as_ref()
                .and_then(|m| m.display_name.clone())
                .or_else(|| {
                    if is_active {
                        active_identity.display_name.clone()
                    } else {
                        None
                    }
                });
            let identity_hash = meta
                .as_ref()
                .and_then(|m| m.identity_hash.clone())
                .or_else(|| {
                    if is_active && active_identity.configured {
                        Some(active_identity.identity_hash.clone())
                    } else {
                        None
                    }
                });
            let lxmf_hash = meta.as_ref().and_then(|m| m.lxmf_hash.clone()).or_else(|| {
                if is_active && active_identity.configured {
                    Some(active_identity.lxmf_hash.clone())
                } else {
                    None
                }
            });
            rows.push(serde_json::json!({
                "id": id,
                "display_name": display_name,
                "identity_hash": identity_hash,
                "lxmf_hash": lxmf_hash,
                "active": is_active,
                "configured": configured,
            }));
        }
    }

    if rows.is_empty() {
        rows.push(serde_json::json!({
            "id": DEFAULT_SLOT_ID,
            "display_name": active_identity.display_name,
            "identity_hash": if active_identity.configured {
                serde_json::Value::String(active_identity.identity_hash.clone())
            } else {
                serde_json::Value::Null
            },
            "lxmf_hash": if active_identity.configured {
                serde_json::Value::String(active_identity.lxmf_hash.clone())
            } else {
                serde_json::Value::Null
            },
            "active": true,
            "configured": active_identity.configured,
        }));
    }

    rows.sort_by(|a, b| {
        let a_id = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let b_id = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
        a_id.cmp(b_id)
    });
    rows
}

/// Create an empty slot directory and return its id (does not switch).
pub fn create_empty_slot(config_dir: &Path, display_name: Option<&str>) -> Result<String, String> {
    ensure_slot_layout(config_dir)?;
    if count_slot_dirs(config_dir) >= MAX_IDENTITY_SLOTS {
        return Err("identity_slot_limit_reached".into());
    }
    let mut id = new_slot_id();
    while slot_dir(config_dir, &id).exists() {
        id = new_slot_id();
    }
    fs::create_dir_all(slot_dir(config_dir, &id)).map_err(|e| format!("create slot: {e}"))?;
    write_slot_meta(config_dir, &id, display_name, None, None)?;
    Ok(id)
}

/// Persist working identity into the current active slot (before switch/create).
pub fn stash_working_into_active_slot(
    config_dir: &Path,
    identity: &StackIdentity,
) -> Result<(), String> {
    ensure_slot_layout(config_dir)?;
    let active = read_active_id(config_dir);
    let working = working_identity_path(config_dir);
    if working.exists() {
        let dest = slot_identity_path(config_dir, &active);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create slot: {e}"))?;
        }
        fs::copy(&working, &dest).map_err(|e| format!("stash identity: {e}"))?;
    }
    if identity.configured {
        write_slot_meta(
            config_dir,
            &active,
            identity.display_name.as_deref(),
            Some(identity.identity_hash.as_str()),
            Some(identity.lxmf_hash.as_str()),
        )?;
    }
    Ok(())
}

/// Copy a configured slot's key into the working identity path (does not change the active pointer).
pub fn install_slot_to_working(config_dir: &Path, identity_id: &str) -> Result<(), String> {
    if !is_safe_slot_id(identity_id) {
        return Err("invalid identity_id".into());
    }
    ensure_slot_layout(config_dir)?;
    let src = slot_identity_path(config_dir, identity_id);
    if !src.exists() {
        return Err("identity_slot_not_configured".into());
    }
    let working = working_identity_path(config_dir);
    fs::copy(&src, &working).map_err(|e| format!("activate identity: {e}"))?;
    Ok(())
}

/// Activate a configured slot by copying its key into the working identity path, then committing the pointer.
pub fn activate_slot(config_dir: &Path, identity_id: &str) -> Result<(), String> {
    install_slot_to_working(config_dir, identity_id)?;
    write_active_id(config_dir, identity_id)?;
    Ok(())
}

/// Soft cap on stored identity slots (create refuses beyond this).
pub const MAX_IDENTITY_SLOTS: usize = 16;

pub fn count_slot_dirs(config_dir: &Path) -> usize {
    let root = identities_root(config_dir);
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            is_safe_slot_id(&id) && e.path().is_dir()
        })
        .count()
}

/// Remove a slot directory without active/last-configured checks (rollback helper).
pub fn remove_slot_dir_force(config_dir: &Path, identity_id: &str) -> Result<(), String> {
    if !is_safe_slot_id(identity_id) {
        return Err("invalid identity_id".into());
    }
    let dir = slot_dir(config_dir, identity_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("delete identity: {e}"))?;
    }
    Ok(())
}

/// Point the active pointer at `identity_id` without requiring a key file yet.
pub fn set_active_slot_pointer(config_dir: &Path, identity_id: &str) -> Result<(), String> {
    if !is_safe_slot_id(identity_id) {
        return Err("invalid identity_id".into());
    }
    ensure_slot_layout(config_dir)?;
    if !slot_dir(config_dir, identity_id).exists() {
        return Err("identity_not_found".into());
    }
    write_active_id(config_dir, identity_id)
}

pub fn delete_slot(config_dir: &Path, identity_id: &str) -> Result<(), String> {
    if !is_safe_slot_id(identity_id) {
        return Err("invalid identity_id".into());
    }
    ensure_slot_layout(config_dir)?;
    let active = read_active_id(config_dir);
    if identity_id == active {
        return Err("cannot_delete_active_identity".into());
    }
    let configured_count = list_configured_slot_ids(config_dir).len();
    let target_configured = slot_identity_path(config_dir, identity_id).exists();
    if target_configured && configured_count <= 1 {
        return Err("cannot_delete_last_identity".into());
    }
    let dir = slot_dir(config_dir, identity_id);
    if !dir.exists() {
        return Err("identity_not_found".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("delete identity: {e}"))?;
    Ok(())
}

fn list_configured_slot_ids(config_dir: &Path) -> Vec<String> {
    let mut ids = Vec::new();
    let root = identities_root(config_dir);
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            if is_safe_slot_id(&id) && slot_identity_path(config_dir, &id).exists() {
                ids.push(id);
            }
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempConfig {
        root: PathBuf,
    }

    impl Drop for TempConfig {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn temp_config() -> (TempConfig, PathBuf) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("mesh-id-slots-{}-{}", std::process::id(), nanos));
        let config_dir = root.join("config");
        fs::create_dir_all(&config_dir).unwrap();
        (TempConfig { root }, config_dir)
    }

    fn write_fake_identity(path: &Path, marker: u8) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        let bytes = vec![marker; 64];
        f.write_all(&bytes).unwrap();
    }

    #[test]
    fn migrate_legacy_identity_into_default_slot() {
        let (_root, config_dir) = temp_config();
        write_fake_identity(&working_identity_path(&config_dir), 1);
        ensure_slot_layout(&config_dir).unwrap();
        assert!(slot_identity_path(&config_dir, DEFAULT_SLOT_ID).exists());
        assert_eq!(read_active_id(&config_dir), DEFAULT_SLOT_ID);
    }

    #[test]
    fn switch_copies_target_into_working() {
        let (_root, config_dir) = temp_config();
        write_fake_identity(&working_identity_path(&config_dir), 1);
        ensure_slot_layout(&config_dir).unwrap();

        let other = "alt";
        write_fake_identity(&slot_identity_path(&config_dir, other), 2);
        write_slot_meta(&config_dir, other, Some("Alt"), Some("aa"), Some("bb")).unwrap();

        stash_working_into_active_slot(
            &config_dir,
            &StackIdentity {
                configured: true,
                identity_hash: "11".into(),
                lxmf_hash: "22".into(),
                display_name: Some("Default".into()),
                mnemonic: None,
            },
        )
        .unwrap();
        activate_slot(&config_dir, other).unwrap();
        assert_eq!(read_active_id(&config_dir), other);
        assert_eq!(fs::read(working_identity_path(&config_dir)).unwrap()[0], 2);
    }

    #[test]
    fn delete_refuses_active_and_allows_other() {
        let (_root, config_dir) = temp_config();
        write_fake_identity(&working_identity_path(&config_dir), 1);
        ensure_slot_layout(&config_dir).unwrap();
        let other = create_empty_slot(&config_dir, Some("Other")).unwrap();
        write_fake_identity(&slot_identity_path(&config_dir, &other), 3);
        assert!(delete_slot(&config_dir, DEFAULT_SLOT_ID).is_err());
        delete_slot(&config_dir, &other).unwrap();
        assert!(!slot_dir(&config_dir, &other).exists());
    }
}
