//! Ratspeak `.rsi` and official Reticulum raw identity backup/restore.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::identity_apply;
use super::identity_import::{self, RNS_PRIVATE_KEY_LEN};
use super::persistence::PersistedState;
use super::ratspeak_vault;
use super::types::StackIdentity;

pub const RATSPEAK_IDENTITY_V2: &str = "ratspeak.identity.v2";
pub const RATSPEAK_IDENTITY_V1: &str = "ratspeak.identity.v1";
pub const RAW_PRIVATE_KEY_FORMAT: &str = "reticulum.raw-private-key";
pub const MIN_BACKUP_PIN_LEN: usize = 6;
pub const MAX_BACKUP_PIN_LEN: usize = 128;
/// Reject crafted `.rsi` vaults that would DoS via Argon2 (Ratspeak desktop default is 47 MiB).
const MAX_VAULT_M_COST: u32 = 128 * 1024;
const MAX_VAULT_T_COST: u32 = 10;
const MAX_VAULT_P_COST: u32 = 4;

#[derive(Debug, Deserialize, Serialize)]
pub struct EncryptedIdentityBackupV2 {
    pub format: String,
    pub kind: String,
    pub vault: ratspeak_vault::EncryptedVault,
    pub identity_hash: String,
    pub lxmf_hash: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub nickname: String,
    pub exported_at: f64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LegacyIdentityBackupV1 {
    pub format: String,
    pub kind: String,
    pub private_key: String,
    pub identity_hash: String,
    pub lxmf_hash: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub nickname: String,
    pub exported_at: f64,
}

fn now_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

pub fn validate_backup_pin(passphrase: &str) -> Result<&str, String> {
    let pin = passphrase.trim();
    if pin.len() < MIN_BACKUP_PIN_LEN {
        return Err(format!(
            "Backup PIN must be at least {MIN_BACKUP_PIN_LEN} characters"
        ));
    }
    if pin.len() > MAX_BACKUP_PIN_LEN {
        return Err(format!(
            "Backup PIN must be at most {MAX_BACKUP_PIN_LEN} characters"
        ));
    }
    Ok(pin)
}

/// Identity fields needed for `.rsi` / raw export after releasing the stack read lock.
#[derive(Clone)]
pub struct IdentityExportSnapshot {
    pub configured: bool,
    pub display_name: Option<String>,
    pub mnemonic: Option<String>,
}

impl IdentityExportSnapshot {
    pub fn from_state(state: &PersistedState) -> Self {
        Self {
            configured: state.identity.configured,
            display_name: state.identity.display_name.clone(),
            mnemonic: state.identity.mnemonic.clone(),
        }
    }
}

fn file_name_prefix(identity_hash: &str) -> &str {
    if identity_hash.len() >= 16 {
        &identity_hash[..16]
    } else {
        identity_hash
    }
}

/// Build a Ratspeak `.rsi` (`ratspeak.identity.v2`) from the on-disk working identity.
pub fn export_rsi_backup(
    config_dir: &std::path::Path,
    snapshot: &IdentityExportSnapshot,
    passphrase: &str,
) -> Result<serde_json::Value, String> {
    let pin = validate_backup_pin(passphrase)?;
    if !snapshot.configured {
        return Err("no identity configured".into());
    }
    let identity = identity_apply::load_identity_from_file(config_dir)?;
    let key = identity
        .get_private_key()
        .ok_or_else(|| "identity has no exportable private key".to_string())?;
    let key_array = Zeroizing::new(*key);
    let stack_id =
        identity_apply::stack_identity_from_rns(&identity, snapshot.display_name.clone(), None);
    let mnemonic = snapshot.mnemonic.as_deref();
    let vault = ratspeak_vault::encrypt_identity(pin, &key_array, mnemonic)
        .map_err(|e| format!("failed to encrypt identity backup: {e}"))?;
    let backup = EncryptedIdentityBackupV2 {
        format: RATSPEAK_IDENTITY_V2.to_string(),
        kind: "private".to_string(),
        vault,
        identity_hash: stack_id.identity_hash.clone(),
        lxmf_hash: stack_id.lxmf_hash.clone(),
        display_name: stack_id.display_name.clone().unwrap_or_default(),
        status: String::new(),
        nickname: String::new(),
        exported_at: now_ts(),
    };
    let mut value = serde_json::to_value(&backup).map_err(|e| format!("encode backup: {e}"))?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "file_name".to_string(),
            serde_json::Value::String(format!(
                "{}-ratspeak-identity.rsi",
                file_name_prefix(&stack_id.identity_hash)
            )),
        );
    }
    Ok(value)
}

/// Export the official Reticulum raw 64-byte private key (base64 + suggested filename).
pub fn export_raw_identity(
    config_dir: &std::path::Path,
    snapshot: &IdentityExportSnapshot,
) -> Result<serde_json::Value, String> {
    if !snapshot.configured {
        return Err("no identity configured".into());
    }
    let identity = identity_apply::load_identity_from_file(config_dir)?;
    let key = identity
        .get_private_key()
        .ok_or_else(|| "identity has no exportable private key".to_string())?;
    let key_bytes = Zeroizing::new(*key);
    let stack_id =
        identity_apply::stack_identity_from_rns(&identity, snapshot.display_name.clone(), None);
    Ok(serde_json::json!({
        "format": RAW_PRIVATE_KEY_FORMAT,
        "data_base64": B64.encode(key_bytes.as_ref()),
        "data_hex": hex::encode(key_bytes.as_ref()),
        "data_base32": identity_import::encode_base32_padded(key_bytes.as_ref()),
        "file_name": format!(
            "{}-reticulum-identity.identity",
            file_name_prefix(&stack_id.identity_hash)
        ),
        "identity_hash": stack_id.identity_hash,
        "lxmf_hash": stack_id.lxmf_hash,
    }))
}

#[derive(Debug)]
pub struct ParsedBackup {
    pub key_bytes: Zeroizing<[u8; RNS_PRIVATE_KEY_LEN]>,
    pub display_name: Option<String>,
    pub mnemonic: Option<String>,
}

fn validate_vault_kdf_costs(vault: &ratspeak_vault::EncryptedVault) -> Result<(), String> {
    if vault.m_cost == 0 || vault.m_cost > MAX_VAULT_M_COST {
        return Err(format!(
            "Identity backup Argon2 m_cost out of range (max {MAX_VAULT_M_COST})"
        ));
    }
    if vault.t_cost == 0 || vault.t_cost > MAX_VAULT_T_COST {
        return Err(format!(
            "Identity backup Argon2 t_cost out of range (max {MAX_VAULT_T_COST})"
        ));
    }
    if vault.p_cost == 0 || vault.p_cost > MAX_VAULT_P_COST {
        return Err(format!(
            "Identity backup Argon2 p_cost out of range (max {MAX_VAULT_P_COST})"
        ));
    }
    Ok(())
}

fn parse_v2_backup(backup: serde_json::Value, passphrase: &str) -> Result<ParsedBackup, String> {
    let pin = validate_backup_pin(passphrase)?;
    let parsed: EncryptedIdentityBackupV2 = serde_json::from_value(backup)
        .map_err(|_| "Encrypted identity backup is invalid".to_string())?;
    if parsed.kind != "private" {
        return Err("Public identity backups are not activatable identities".into());
    }
    validate_vault_kdf_costs(&parsed.vault)?;
    // Decrypt key first (one Argon2). Only re-derive when a sealed mnemonic is present.
    let key = ratspeak_vault::decrypt_key(pin, &parsed.vault)
        .map_err(|_| "Incorrect backup PIN or corrupt identity backup".to_string())?;
    let mnemonic = if parsed.vault.mnemonic_token.is_some() {
        ratspeak_vault::decrypt_mnemonic(pin, &parsed.vault)
            .map_err(|_| "Incorrect backup PIN or corrupt identity backup".to_string())?
            .map(|m| m.as_str().to_string())
    } else {
        None
    };
    let key_bytes = Zeroizing::new(identity_import::decode_private_key_bytes(key.as_ref())?);
    let identity = identity_apply::identity_from_private_bytes(&key_bytes)?;
    let hash_hex = hex::encode(identity.hash);
    if !parsed.identity_hash.is_empty() && !parsed.identity_hash.eq_ignore_ascii_case(&hash_hex) {
        return Err("Identity backup hash does not match private key".into());
    }
    let display_name = if parsed.display_name.trim().is_empty() {
        None
    } else {
        Some(parsed.display_name)
    };
    Ok(ParsedBackup {
        key_bytes,
        display_name,
        mnemonic,
    })
}

fn parse_v1_backup(backup: serde_json::Value) -> Result<ParsedBackup, String> {
    let parsed: LegacyIdentityBackupV1 = serde_json::from_value(backup)
        .map_err(|_| "Legacy identity backup is invalid".to_string())?;
    if parsed.kind != "private" {
        return Err("Public identity backups are not activatable identities".into());
    }
    let key_bytes = Zeroizing::new(identity_import::decode_private_key_input(
        &parsed.private_key,
    )?);
    let identity = identity_apply::identity_from_private_bytes(&key_bytes)?;
    let hash_hex = hex::encode(identity.hash);
    if !parsed.identity_hash.is_empty() && !parsed.identity_hash.eq_ignore_ascii_case(&hash_hex) {
        return Err("Identity backup hash does not match private key".into());
    }
    let display_name = if parsed.display_name.trim().is_empty() {
        None
    } else {
        Some(parsed.display_name)
    };
    Ok(ParsedBackup {
        key_bytes,
        display_name,
        mnemonic: None,
    })
}

/// Parse a Ratspeak backup JSON into private-key material (does not write disk).
/// Callers should run this outside the stack write lock (Argon2 is CPU/memory heavy).
pub fn parse_identity_backup(
    backup: serde_json::Value,
    passphrase: &str,
) -> Result<ParsedBackup, String> {
    let format = backup.get("format").and_then(|v| v.as_str()).unwrap_or("");
    match format {
        RATSPEAK_IDENTITY_V2 => parse_v2_backup(backup, passphrase),
        RATSPEAK_IDENTITY_V1 => parse_v1_backup(backup),
        "mesh-client.identity.v1" => Err(
            "mesh-client.identity.v1 metadata-only backups are no longer supported; use a Ratspeak .rsi or raw Reticulum identity file"
                .into(),
        ),
        _ => Err("unsupported backup format".into()),
    }
}

/// Apply an already-parsed backup under the stack write lock.
pub fn apply_parsed_backup(
    state: &mut PersistedState,
    config_dir: &std::path::Path,
    storage_dir: &std::path::Path,
    parsed: ParsedBackup,
    display_name_override: Option<String>,
) -> Result<StackIdentity, String> {
    let identity = identity_apply::identity_from_private_bytes(&parsed.key_bytes)?;
    let display_name = display_name_override.or(parsed.display_name);
    identity_apply::apply_unified_identity(
        state,
        config_dir,
        storage_dir,
        &identity,
        display_name,
        parsed.mnemonic,
    )
}

/// Import backup → apply private key to working identity file.
#[cfg(all(test, feature = "rns-stack"))]
pub fn import_and_apply_backup(
    state: &mut PersistedState,
    config_dir: &std::path::Path,
    storage_dir: &std::path::Path,
    backup: serde_json::Value,
    passphrase: &str,
    display_name_override: Option<String>,
) -> Result<StackIdentity, String> {
    let parsed = parse_identity_backup(backup, passphrase)?;
    apply_parsed_backup(
        state,
        config_dir,
        storage_dir,
        parsed,
        display_name_override,
    )
}

#[cfg(all(test, feature = "rns-stack"))]
mod tests {
    use super::*;
    use crate::stack::identity_apply::{
        apply_unified_identity, generate_identity_with_mnemonic, identity_file_path,
        load_identity_from_file, stack_identity_from_rns,
    };
    use crate::stack::persistence::PersistedState;
    use std::fs;

    fn temp_dirs() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let config_dir = root.path().join("config");
        let storage_dir = root.path().join("storage");
        fs::create_dir_all(&config_dir).unwrap();
        fs::create_dir_all(&storage_dir).unwrap();
        (root, config_dir, storage_dir)
    }

    fn snapshot(state: &PersistedState) -> IdentityExportSnapshot {
        IdentityExportSnapshot::from_state(state)
    }

    #[test]
    fn rsi_export_import_round_trip() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, mnemonic) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(
            &mut state,
            &config_dir,
            &storage_dir,
            &identity,
            Some("Test Node".into()),
            Some(mnemonic),
        )
        .unwrap();

        let pin = "123456";
        let backup = export_rsi_backup(&config_dir, &snapshot(&state), pin).unwrap();
        assert_eq!(
            backup.get("format").and_then(|v| v.as_str()),
            Some(RATSPEAK_IDENTITY_V2)
        );
        assert_eq!(backup.get("kind").and_then(|v| v.as_str()), Some("private"));
        assert!(backup.get("vault").is_some());
        assert!(
            backup
                .get("file_name")
                .and_then(|v| v.as_str())
                .unwrap()
                .ends_with(".rsi")
        );
        assert_ne!(
            backup.get("format").and_then(|v| v.as_str()),
            Some("mesh-client.identity.v1")
        );

        let vault = backup.get("vault").cloned().unwrap();
        let enc: ratspeak_vault::EncryptedVault = serde_json::from_value(vault).unwrap();
        let key = identity.get_private_key().unwrap();
        let decrypted = ratspeak_vault::decrypt_key(pin, &enc).unwrap();
        assert_eq!(decrypted.as_ref(), key.as_ref());

        // Wipe and re-import.
        fs::remove_file(identity_file_path(&config_dir)).unwrap();
        let mut state2 = PersistedState::default_empty();
        let restored =
            import_and_apply_backup(&mut state2, &config_dir, &storage_dir, backup, pin, None)
                .unwrap();
        assert_eq!(restored.identity_hash, state.identity.identity_hash);
        assert_eq!(restored.lxmf_hash, state.identity.lxmf_hash);
        assert_eq!(restored.display_name.as_deref(), Some("Test Node"));
        let loaded = load_identity_from_file(&config_dir).unwrap();
        assert_eq!(hex::encode(loaded.hash), state.identity.identity_hash);
    }

    #[test]
    fn rsi_wrong_pin_fails() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();
        let backup = export_rsi_backup(&config_dir, &snapshot(&state), "123456").unwrap();
        let err = import_and_apply_backup(
            &mut PersistedState::default_empty(),
            &config_dir,
            &storage_dir,
            backup,
            "654321",
            None,
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("pin") || err.to_lowercase().contains("corrupt"));
    }

    #[test]
    fn rsi_missing_pin_fails() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();
        let backup = export_rsi_backup(&config_dir, &snapshot(&state), "123456").unwrap();
        assert!(parse_identity_backup(backup, "").is_err());
    }

    #[test]
    fn pin_over_max_reports_upper_bound() {
        let err = validate_backup_pin(&"x".repeat(MAX_BACKUP_PIN_LEN + 1)).unwrap_err();
        assert!(err.contains(&MAX_BACKUP_PIN_LEN.to_string()));
        assert!(err.to_lowercase().contains("at most"));
    }

    #[test]
    fn legacy_v1_import_applies_key() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let key = identity.get_private_key().unwrap();
        let stack = stack_identity_from_rns(&identity, Some("Legacy".into()), None);
        let backup = serde_json::json!({
            "format": RATSPEAK_IDENTITY_V1,
            "kind": "private",
            "private_key": B64.encode(key.as_ref()),
            "identity_hash": stack.identity_hash,
            "lxmf_hash": stack.lxmf_hash,
            "display_name": "Legacy",
            "status": "",
            "nickname": "",
            "exported_at": 1.0,
        });
        let mut state = PersistedState::default_empty();
        let restored =
            import_and_apply_backup(&mut state, &config_dir, &storage_dir, backup, "", None)
                .unwrap();
        assert_eq!(restored.identity_hash, stack.identity_hash);
        assert_eq!(restored.display_name.as_deref(), Some("Legacy"));
    }

    #[test]
    fn rejects_mesh_client_v1_metadata() {
        let backup = serde_json::json!({
            "format": "mesh-client.identity.v1",
            "identity_hash": "aa",
            "lxmf_hash": "bb",
            "display_name": "x",
            "exported_at": 1,
        });
        let err = parse_identity_backup(backup, "123456").unwrap_err();
        assert!(err.contains("no longer supported"));
    }

    #[test]
    fn raw_export_import_round_trip() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();

        let raw = export_raw_identity(&config_dir, &snapshot(&state)).unwrap();
        assert_eq!(
            raw.get("format").and_then(|v| v.as_str()),
            Some(RAW_PRIVATE_KEY_FORMAT)
        );
        assert!(raw.get("data_hex").and_then(|v| v.as_str()).is_some());
        assert!(raw.get("data_base32").and_then(|v| v.as_str()).is_some());
        let b64 = raw.get("data_base64").and_then(|v| v.as_str()).unwrap();
        let bytes = B64.decode(b64).unwrap();
        assert_eq!(bytes.len(), RNS_PRIVATE_KEY_LEN);
        assert!(
            raw.get("file_name")
                .and_then(|v| v.as_str())
                .unwrap()
                .ends_with(".identity")
        );

        fs::remove_file(identity_file_path(&config_dir)).unwrap();
        let key = identity_import::decode_private_key_bytes(&bytes).unwrap();
        let restored_id = identity_apply::identity_from_private_bytes(&key).unwrap();
        let mut state2 = PersistedState::default_empty();
        let applied = apply_unified_identity(
            &mut state2,
            &config_dir,
            &storage_dir,
            &restored_id,
            None,
            None,
        )
        .unwrap();
        assert_eq!(applied.identity_hash, state.identity.identity_hash);
    }

    #[test]
    fn hash_mismatch_rejected() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();
        let mut backup = export_rsi_backup(&config_dir, &snapshot(&state), "123456").unwrap();
        backup.as_object_mut().unwrap().insert(
            "identity_hash".into(),
            serde_json::Value::String("00".repeat(32)),
        );
        let err = parse_identity_backup(backup, "123456").unwrap_err();
        assert!(err.contains("does not match"));
    }

    #[test]
    fn uppercase_identity_hash_imports() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();
        let mut backup = export_rsi_backup(&config_dir, &snapshot(&state), "123456").unwrap();
        let lower = backup
            .get("identity_hash")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        backup.as_object_mut().unwrap().insert(
            "identity_hash".into(),
            serde_json::Value::String(lower.to_ascii_uppercase()),
        );
        fs::remove_file(identity_file_path(&config_dir)).unwrap();
        let restored = import_and_apply_backup(
            &mut PersistedState::default_empty(),
            &config_dir,
            &storage_dir,
            backup,
            "123456",
            None,
        )
        .unwrap();
        assert_eq!(restored.identity_hash, state.identity.identity_hash);
    }

    #[test]
    fn rejects_excessive_argon2_costs() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, &identity, None, None)
            .unwrap();
        let mut backup = export_rsi_backup(&config_dir, &snapshot(&state), "123456").unwrap();
        backup
            .as_object_mut()
            .unwrap()
            .get_mut("vault")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("m_cost".into(), serde_json::json!(MAX_VAULT_M_COST + 1));
        let err = parse_identity_backup(backup, "123456").unwrap_err();
        assert!(err.contains("m_cost"));
    }
}
