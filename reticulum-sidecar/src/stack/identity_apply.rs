//! Unified Reticulum identity: one write path for file + persisted metadata.

use std::path::{Path, PathBuf};

use super::persistence::PersistedState;
use super::types::StackIdentity;

pub const IDENTITY_FILE_NAME: &str = "identity";
pub const LXMF_APP_NAME: &str = "lxmf.delivery";

pub fn identity_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join(IDENTITY_FILE_NAME)
}

#[cfg(feature = "rns-stack")]
pub fn identity_requires_rns_stack() -> Result<(), String> {
    Ok(())
}

#[cfg(not(feature = "rns-stack"))]
pub fn identity_requires_rns_stack() -> Result<(), String> {
    Err("identity operations require an rns-stack sidecar build".into())
}

#[cfg(feature = "rns-stack")]
mod rns {
    use rns_identity::destination::Destination;
    use rns_identity::identity::Identity;
    use rns_ratkey::seed;

    use super::*;

    pub fn stack_identity_from_rns(
        identity: &Identity,
        display_name: Option<String>,
        mnemonic: Option<String>,
    ) -> StackIdentity {
        StackIdentity {
            configured: true,
            identity_hash: hex::encode(identity.hash),
            lxmf_hash: hex::encode(Destination::hash_from_name_and_identity(
                LXMF_APP_NAME,
                Some(&identity.hash),
            )),
            display_name,
            mnemonic,
        }
    }

    pub fn identity_from_private_bytes(bytes: &[u8; 64]) -> Result<Identity, String> {
        Identity::from_private_key(bytes).map_err(|e| format!("invalid private key: {e}"))
    }

    pub fn identity_from_mnemonic(mnemonic: &str) -> Result<(Identity, String), String> {
        if !seed::validate_mnemonic(mnemonic) {
            return Err("invalid seed phrase: expected 12 valid BIP-39 English words".into());
        }
        let derived = seed::derive_identity(mnemonic)
            .map_err(|e| format!("failed to derive identity from mnemonic: {e}"))?;
        let mut wire = [0u8; 64];
        wire[..32].copy_from_slice(&derived.x25519_secret);
        wire[32..].copy_from_slice(&derived.ed25519_seed);
        let identity = identity_from_private_bytes(&wire)?;
        Ok((identity, mnemonic.trim().to_string()))
    }

    pub fn generate_identity_with_mnemonic() -> Result<(Identity, String), String> {
        let mnemonic = seed::generate_mnemonic()
            .map_err(|e| format!("mnemonic generation failed: {e}"))?;
        let (identity, _) = identity_from_mnemonic(&mnemonic)?;
        Ok((identity, mnemonic))
    }

    pub fn load_identity_from_file(config_dir: &Path) -> Result<Identity, String> {
        let path = identity_file_path(config_dir);
        if !path.exists() {
            return Err("identity file missing; re-import or generate identity".into());
        }
        Identity::from_file(&path).map_err(|e| format!("load identity: {e}"))
    }

    pub fn apply_unified_identity(
        state: &mut PersistedState,
        config_dir: &Path,
        storage_dir: &Path,
        identity: Identity,
        display_name: Option<String>,
        mnemonic: Option<String>,
    ) -> Result<StackIdentity, String> {
        identity
            .to_file(&identity_file_path(config_dir))
            .map_err(|e| format!("save identity: {e}"))?;
        state.identity = stack_identity_from_rns(&identity, display_name, mnemonic);
        state.rns_ready = true;
        state.lxmf_ready = true;
        state.sync_local_propagation_hash();
        state.save(config_dir, storage_dir)?;
        Ok(state.identity.clone())
    }

    /// Reconcile persisted metadata from the on-disk identity file (file wins).
    pub fn reconcile_persisted_identity_from_file(
        state: &mut PersistedState,
        config_dir: &Path,
        storage_dir: &Path,
    ) -> Result<Option<StackIdentity>, String> {
        let path = identity_file_path(config_dir);
        if !path.exists() {
            return Ok(None);
        }
        let identity = load_identity_from_file(config_dir)?;
        let from_file = stack_identity_from_rns(
            &identity,
            state.identity.display_name.clone(),
            state.identity.mnemonic.clone(),
        );
        if state.identity.configured
            && state.identity.identity_hash == from_file.identity_hash
            && state.identity.lxmf_hash == from_file.lxmf_hash
        {
            return Ok(None);
        }
        state.identity = from_file.clone();
        state.rns_ready = true;
        state.lxmf_ready = true;
        state.sync_local_propagation_hash();
        state.save(config_dir, storage_dir)?;
        Ok(Some(from_file))
    }

    pub fn backup_conflicts_with_file(
        config_dir: &Path,
        backup_identity_hash: &str,
        backup_lxmf_hash: &str,
    ) -> Result<bool, String> {
        let path = identity_file_path(config_dir);
        if !path.exists() {
            return Ok(false);
        }
        let identity = load_identity_from_file(config_dir)?;
        let file_stack = stack_identity_from_rns(&identity, None, None);
        Ok(file_stack.identity_hash.to_lowercase() != backup_identity_hash.to_lowercase()
            || file_stack.lxmf_hash.to_lowercase() != backup_lxmf_hash.to_lowercase())
    }
}

#[cfg(feature = "rns-stack")]
pub use rns::*;

#[cfg(all(test, feature = "rns-stack"))]
mod tests {
    use super::rns::*;
    use super::*;
    use std::fs;

    fn temp_dirs() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let config_dir = root.path().join("config");
        let storage_dir = root.path().join("storage");
        fs::create_dir_all(&config_dir).unwrap();
        fs::create_dir_all(&storage_dir).unwrap();
        (root, config_dir, storage_dir)
    }

    #[test]
    fn ratkey_vector_derives_expected_seeds() {
        let mnemonic = format!("{}{}", "abandon ".repeat(11), "about");
        let derived = rns_ratkey::seed::derive_identity(&mnemonic).unwrap();
        assert_eq!(
            hex::encode(derived.ed25519_seed),
            "dfbf047515deef875db5884b7d1ec625f57641adb7265153a2c3b775ed04386f"
        );
        assert_eq!(
            hex::encode(derived.x25519_secret),
            "20c92deea11650882a353b4e9928602d247b4ee689c1e0e10dc77637dbe3b33f"
        );
    }

    #[test]
    fn apply_unified_identity_writes_file_and_json() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, mnemonic) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        let stack = apply_unified_identity(
            &mut state,
            &config_dir,
            &storage_dir,
            identity,
            Some("Test".into()),
            Some(mnemonic.clone()),
        )
        .unwrap();
        assert!(identity_file_path(&config_dir).exists());
        assert_eq!(stack.identity_hash.len(), 32);
        assert_eq!(stack.lxmf_hash.len(), 32);
        assert_eq!(stack.display_name.as_deref(), Some("Test"));
        assert_eq!(stack.mnemonic.as_deref(), Some(mnemonic.as_str()));

        let reloaded = PersistedState::load(&config_dir, &storage_dir);
        assert_eq!(reloaded.identity.identity_hash, stack.identity_hash);
        assert_eq!(reloaded.identity.lxmf_hash, stack.lxmf_hash);
    }

    #[test]
    fn mnemonic_import_roundtrip_matches_generate() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, mnemonic) = generate_identity_with_mnemonic().unwrap();
        let expected = stack_identity_from_rns(&identity, None, None);

        let mut state = PersistedState::default_empty();
        let (imported, _) = identity_from_mnemonic(&mnemonic).unwrap();
        apply_unified_identity(&mut state, &config_dir, &storage_dir, imported, None, None).unwrap();

        assert_eq!(state.identity.identity_hash, expected.identity_hash);
        assert_eq!(state.identity.lxmf_hash, expected.lxmf_hash);
    }

    #[test]
    fn reconcile_fixes_stale_json() {
        let (_root, config_dir, storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        let mut state = PersistedState::default_empty();
        apply_unified_identity(
            &mut state,
            &config_dir,
            &storage_dir,
            identity,
            Some("Name".into()),
            None,
        )
        .unwrap();

        state.identity.identity_hash = "deadbeef".repeat(4);
        state.save(&config_dir, &storage_dir).unwrap();

        let mut reloaded = PersistedState::load(&config_dir, &storage_dir);
        let updated = reconcile_persisted_identity_from_file(&mut reloaded, &config_dir, &storage_dir)
            .unwrap()
            .expect("should reconcile");
        assert_ne!(updated.identity_hash, "deadbeef".repeat(4));
        assert_eq!(updated.identity_hash.len(), 32);
    }

    #[test]
    fn backup_conflicts_when_hashes_differ() {
        let (_root, config_dir, _storage_dir) = temp_dirs();
        let (identity, _) = generate_identity_with_mnemonic().unwrap();
        identity
            .to_file(&identity_file_path(&config_dir))
            .unwrap();
        let stack = stack_identity_from_rns(&identity, None, None);
        assert!(backup_conflicts_with_file(&config_dir, "00", "00").unwrap());
        assert!(
            !backup_conflicts_with_file(
                &config_dir,
                &stack.identity_hash,
                &stack.lxmf_hash
            )
            .unwrap()
        );
    }
}
