// Vendored from ratspeak/Ratspeak crates/ratspeak-runtime/src/vault.rs
// Upstream commit: b0451ef8afb424b5151258c248ea1e82d5ebfe5f
// Do not edit by hand — refresh via scripts/sync-ratspeak-releases.mjs.
//! Bounded passcode encryption and recoverable identity-file transitions.
//!
//! Version-one Argon2id + HKDF + token bytes remain unchanged. Every derivation
//! holds one process-wide job permit, including work detached by async cancellation.

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use zeroize::Zeroizing;

use rns_crypto::{hkdf, random, token};
use rns_identity::identity::Identity;
use rns_identity::persistence::{
    DurableFileReceipt, durable_remove, durable_write, read_file_bounded,
};

const VERSION: u32 = 1;
const PRK_LEN: usize = 32;
const KEK_LEN: usize = 64;
pub const MAX_VAULT_JSON_BYTES: usize = 64 * 1024;
pub const MAX_IDENTITY_IMPORT_BYTES: usize = 1024 * 1024;
pub const MAX_BASE64_IMPORT_BYTES: usize = 1_398_104;
pub const MAX_HEX_IMPORT_BYTES: usize = 2 * MAX_IDENTITY_IMPORT_BYTES;
pub const MAX_OUTER_WHITESPACE_BYTES: usize = 4096;
pub const MAX_PASSCODE_BYTES: usize = 1024;
pub const MAX_SEED_BYTES: usize = 4096;
pub(crate) const SEED_FILE: &str = "identity.seed";
static JOB_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(test)]
thread_local! {
    static KDF_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static FAIL_STAGE: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) };
}
fn transition_checkpoint(stage: &'static str, published: bool) -> Result<(), VaultError> {
    #[cfg(test)]
    if FAIL_STAGE.with(|s| s.get() == Some(stage)) {
        return Err(if published {
            VaultError::RecoveryRequired("injected transition interruption".into())
        } else {
            VaultError::Io("injected transition interruption".into())
        });
    }
    let _ = (stage, published);
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct VaultParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl VaultParams {
    pub fn recommended() -> Self {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        {
            Self {
                m_cost: 19 * 1024,
                t_cost: 2,
                p_cost: 1,
            }
        }
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            Self {
                m_cost: 47 * 1024,
                t_cost: 3,
                p_cost: 1,
            }
        }
    }

    fn checked(self) -> Result<Params, VaultError> {
        if !(1..=4).contains(&self.p_cost)
            || !(1..=8).contains(&self.t_cost)
            || self.m_cost < 8 * self.p_cost
            || self.m_cost > 65_536
            || u64::from(self.m_cost) * u64::from(self.t_cost) > 262_144
        {
            return Err(VaultError::UnsupportedCost);
        }
        Params::new(self.m_cost, self.t_cost, self.p_cost, Some(PRK_LEN))
            .map_err(|_| VaultError::UnsupportedCost)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedVault {
    pub version: u32,
    pub kdf: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    pub salt: String,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mnemonic_token: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("invalid vault: {0}")]
    InvalidFormat(String),
    #[error("vault derivation cost is unsupported")]
    UnsupportedCost,
    #[error("another identity encryption operation is in progress; retry shortly")]
    Busy,
    #[error("incorrect passcode or corrupt vault")]
    Auth,
    #[error("vault io: {0}")]
    Io(String),
    #[error("vault publication may have committed; recovery copies were retained: {0}")]
    RecoveryRequired(String),
    #[error("identity change committed, but private-file cleanup remains pending: {0}")]
    CleanupPending(String),
    #[error("key derivation failed: {0}")]
    Kdf(String),
    #[error("key expansion failed")]
    Hkdf,
}

/// Non-cloneable permit. Acquire before spawn_blocking and move it into the job.
/// Its methods reuse this permit rather than recursively acquiring another one.
#[derive(Debug)]
pub struct VaultJob {
    _private: std::marker::PhantomData<std::cell::Cell<()>>,
}

impl Drop for VaultJob {
    fn drop(&mut self) {
        JOB_ACTIVE.store(false, Ordering::Release);
    }
}

pub fn try_acquire_job() -> Result<VaultJob, VaultError> {
    JOB_ACTIVE
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| VaultJob {
            _private: std::marker::PhantomData,
        })
        .map_err(|_| VaultError::Busy)
}

pub struct UnlockedVault {
    key: Zeroizing<[u8; 64]>,
    mnemonic: Option<Zeroizing<String>>,
}
impl UnlockedVault {
    pub fn key(&self) -> &[u8; 64] {
        &self.key
    }
    pub fn mnemonic(&self) -> Option<&str> {
        self.mnemonic.as_deref().map(String::as_str)
    }
}

/// Validated encryption result; construction is private and publication consumes it.
pub struct PreparedProtection {
    id_dir: PathBuf,
    previous: Option<Vec<u8>>,
    unlocked: UnlockedVault,
    bytes: Vec<u8>,
}
pub struct PreparedUnprotection {
    id_dir: PathBuf,
    previous: Vec<u8>,
    unlocked: UnlockedVault,
}

struct ValidatedVault {
    params: VaultParams,
    salt: [u8; 16],
    token: Vec<u8>,
    mnemonic: Option<Vec<u8>>,
}

impl ValidatedVault {
    fn new(v: &EncryptedVault) -> Result<Self, VaultError> {
        if v.version != VERSION || v.kdf != "argon2id" {
            return Err(VaultError::InvalidFormat(
                "unsupported version or KDF".into(),
            ));
        }
        let params = VaultParams {
            m_cost: v.m_cost,
            t_cost: v.t_cost,
            p_cost: v.p_cost,
        };
        params.checked()?;
        fn hex_value(text: &str, bytes: usize, field: &str) -> Result<Vec<u8>, VaultError> {
            if text.len() != bytes * 2 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(VaultError::InvalidFormat(format!(
                    "invalid {field} length or encoding"
                )));
            }
            hex::decode(text).map_err(|_| VaultError::InvalidFormat(format!("invalid {field}")))
        }
        // Validate all lengths before decoding any attacker-controlled token.
        if v.salt.len() != 32 || v.token.len() != 256 {
            return Err(VaultError::InvalidFormat(
                "invalid salt or identity token length".into(),
            ));
        }
        if let Some(m) = &v.mnemonic_token {
            let n = m.len() / 2;
            if m.len() % 2 != 0 || !(64..=4096).contains(&n) || (n - 48) % 16 != 0 {
                return Err(VaultError::InvalidFormat(
                    "invalid mnemonic token length".into(),
                ));
            }
        }
        let salt = hex_value(&v.salt, 16, "salt")?
            .try_into()
            .expect("validated salt length");
        let token = hex_value(&v.token, 128, "identity token")?;
        let mnemonic = v
            .mnemonic_token
            .as_ref()
            .map(|m| hex_value(m, m.len() / 2, "mnemonic token"))
            .transpose()?;
        Ok(Self {
            params,
            salt,
            token,
            mnemonic,
        })
    }
}

pub fn validate_passcode(passcode: &str) -> Result<(), VaultError> {
    if passcode.len() > MAX_PASSCODE_BYTES {
        return Err(VaultError::InvalidFormat(
            "passcode exceeds 1024 UTF-8 bytes".into(),
        ));
    }
    Ok(())
}

/// Duplicate-aware JSON entry point for bounded vault and backup documents.
/// Unknown metadata remains allowed, but duplicate properties never overwrite.
pub fn parse_unique_json(bytes: &[u8], maximum: usize) -> Result<serde_json::Value, VaultError> {
    if bytes.len() > maximum {
        return Err(VaultError::InvalidFormat("JSON exceeds size limit".into()));
    }
    struct Unique(serde_json::Value);
    impl<'de> Deserialize<'de> for Unique {
        fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct Visitor;
            impl<'de> serde::de::Visitor<'de> for Visitor {
                type Value = Unique;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("JSON with unique object properties")
                }
                fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Unique, E> {
                    Ok(Unique(
                        serde_json::Number::from_f64(v)
                            .ok_or_else(|| E::custom("invalid number"))?
                            .into(),
                    ))
                }
                fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Unique, E> {
                    Ok(Unique(v.into()))
                }
                fn visit_unit<E: serde::de::Error>(self) -> Result<Unique, E> {
                    Ok(Unique(serde_json::Value::Null))
                }
                fn visit_none<E: serde::de::Error>(self) -> Result<Unique, E> {
                    self.visit_unit()
                }
                fn visit_seq<A: serde::de::SeqAccess<'de>>(
                    self,
                    mut a: A,
                ) -> Result<Unique, A::Error> {
                    let mut values = Vec::new();
                    while let Some(Unique(v)) = a.next_element()? {
                        values.push(v);
                    }
                    Ok(Unique(values.into()))
                }
                fn visit_map<A: serde::de::MapAccess<'de>>(
                    self,
                    mut a: A,
                ) -> Result<Unique, A::Error> {
                    let mut values = serde_json::Map::new();
                    while let Some(k) = a.next_key::<String>()? {
                        if values.contains_key(&k) {
                            return Err(serde::de::Error::custom("duplicate JSON property"));
                        }
                        let Unique(v) = a.next_value()?;
                        values.insert(k, v);
                    }
                    Ok(Unique(values.into()))
                }
            }
            d.deserialize_any(Visitor)
        }
    }
    serde_json::from_slice::<Unique>(bytes)
        .map(|v| v.0)
        .map_err(|_| VaultError::InvalidFormat("malformed or duplicate JSON properties".into()))
}

fn canonical_info(p: VaultParams, salt: &[u8]) -> Vec<u8> {
    let mut v = format!(
        "ratspeak-vault-v{VERSION}|argon2id|{}|{}|{}|",
        p.m_cost, p.t_cost, p.p_cost
    )
    .into_bytes();
    v.extend_from_slice(salt);
    v
}
fn derive_kek(
    passcode: &str,
    salt: &[u8],
    p: VaultParams,
) -> Result<Zeroizing<[u8; KEK_LEN]>, VaultError> {
    validate_passcode(passcode)?;
    let params = p.checked()?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut prk = Zeroizing::new([0u8; PRK_LEN]);
    #[cfg(test)]
    KDF_CALLS.with(|count| count.set(count.get() + 1));
    argon
        .hash_password_into(passcode.as_bytes(), salt, prk.as_mut())
        .map_err(|e| VaultError::Kdf(e.to_string()))?;
    let okm = Zeroizing::new(
        hkdf::hkdf_sha256(KEK_LEN, prk.as_ref(), None, Some(&canonical_info(p, salt)))
            .map_err(|_| VaultError::Hkdf)?,
    );
    let mut kek = Zeroizing::new([0u8; KEK_LEN]);
    kek.copy_from_slice(&okm);
    Ok(kek)
}

impl VaultJob {
    pub fn decrypt_identity(
        &self,
        passcode: &str,
        v: &EncryptedVault,
    ) -> Result<UnlockedVault, VaultError> {
        validate_passcode(passcode)?;
        let validated = ValidatedVault::new(v)?;
        let kek = derive_kek(passcode, &validated.salt, validated.params)?;
        let pt = Zeroizing::new(
            token::decrypt(&validated.token, kek.as_ref()).map_err(|_| VaultError::Auth)?,
        );
        if pt.len() != 64 {
            return Err(VaultError::InvalidFormat("decrypted key length".into()));
        }
        let mut key = Zeroizing::new([0u8; 64]);
        key.copy_from_slice(&pt);
        let mnemonic = match validated.mnemonic {
            Some(blob) => {
                let plain = token::decrypt(&blob, kek.as_ref()).map_err(|_| VaultError::Auth)?;
                Some(Zeroizing::new(String::from_utf8(plain).map_err(|_| {
                    VaultError::InvalidFormat("mnemonic utf8".into())
                })?))
            }
            None => None,
        };
        Ok(UnlockedVault { key, mnemonic })
    }
    pub fn encrypt_identity(
        &self,
        passcode: &str,
        key: &[u8; 64],
        mnemonic: Option<&str>,
    ) -> Result<EncryptedVault, VaultError> {
        validate_passcode(passcode)?;
        if mnemonic.is_some_and(|m| m.len() > 4031) {
            return Err(VaultError::InvalidFormat(
                "mnemonic exceeds vault token limit".into(),
            ));
        }
        let p = VaultParams::recommended();
        let salt = random::random_16();
        let kek = derive_kek(passcode, &salt, p)?;
        let blob = token::encrypt(key, kek.as_ref())
            .map_err(|_| VaultError::InvalidFormat("identity encryption".into()))?;
        let mnemonic_token = mnemonic
            .map(|m| {
                token::encrypt(m.as_bytes(), kek.as_ref())
                    .map(hex::encode)
                    .map_err(|_| VaultError::InvalidFormat("mnemonic encryption".into()))
            })
            .transpose()?;
        let v = EncryptedVault {
            version: VERSION,
            kdf: "argon2id".into(),
            m_cost: p.m_cost,
            t_cost: p.t_cost,
            p_cost: p.p_cost,
            salt: hex::encode(salt),
            token: hex::encode(blob),
            mnemonic_token,
        };
        ValidatedVault::new(&v)?;
        Ok(v)
    }
    /// The identity in `id_dir` with its stored recovery phrase: from its vault
    /// with `passcode`, or without one from its plaintext files.
    pub fn open_identity(
        &self,
        id_dir: &Path,
        passcode: Option<&str>,
    ) -> Result<UnlockedVault, VaultError> {
        if id_dir.join("identity.hwid").exists() {
            return Err(VaultError::InvalidFormat(
                "hardware identity keeps its key on the token".into(),
            ));
        }
        let enc = id_dir.join("identity.enc");
        match passcode {
            Some(passcode) => self.decrypt_identity(passcode, &read_vault(&enc)?),
            None if enc.exists() => Err(VaultError::InvalidFormat("passcode required".into())),
            None => Ok(UnlockedVault {
                key: read_plain_identity_key(&id_dir.join("identity"))?,
                mnemonic: read_seed(&id_dir.join(SEED_FILE))?,
            }),
        }
    }
    pub fn reveal_mnemonic(
        &self,
        id_dir: &Path,
        passcode: Option<&str>,
    ) -> Result<Zeroizing<String>, VaultError> {
        if id_dir.join("identity.hwid").exists() {
            return Err(VaultError::InvalidFormat(
                "hardware identity has no stored recovery phrase".into(),
            ));
        }
        let enc = id_dir.join("identity.enc");
        if enc.exists() {
            let v = read_vault(&enc)?;
            let pc =
                passcode.ok_or_else(|| VaultError::InvalidFormat("passcode required".into()))?;
            return self
                .decrypt_identity(pc, &v)?
                .mnemonic
                .ok_or_else(|| VaultError::InvalidFormat("no recovery phrase stored".into()));
        }
        read_seed(&id_dir.join(SEED_FILE))?
            .ok_or_else(|| VaultError::InvalidFormat("no recovery phrase stored".into()))
    }
    /// Stores `mnemonic` as `id_dir`'s plaintext recovery phrase and reads it
    /// back; a passcode identity keeps its phrase in its vault instead.
    pub fn store_plaintext_seed(&self, id_dir: &Path, mnemonic: &str) -> Result<(), VaultError> {
        if id_dir.join("identity.hwid").exists() {
            return Err(VaultError::InvalidFormat(
                "hardware identity has no stored phrase".into(),
            ));
        }
        if id_dir.join("identity.enc").exists() {
            return Ok(());
        }
        write_seed_file(&id_dir.join(SEED_FILE), mnemonic.trim())
    }
    pub fn prepare_protection(
        &self,
        id_dir: &Path,
        passcode: &str,
        current: Option<&str>,
    ) -> Result<PreparedProtection, VaultError> {
        validate_passcode(passcode)?;
        if passcode.len() < 6 {
            return Err(VaultError::InvalidFormat(
                "passcode must be at least 6 characters".into(),
            ));
        }
        if id_dir.join("identity.hwid").exists() {
            return Err(VaultError::InvalidFormat(
                "hardware identity is unlocked with its PIN, not a passcode".into(),
            ));
        }
        let enc = id_dir.join("identity.enc");
        let previous = read_file_bounded(&enc, MAX_VAULT_JSON_BYTES).map_err(io_error)?;
        let unlocked = if previous.is_some() {
            self.decrypt_identity(
                current.ok_or_else(|| {
                    VaultError::InvalidFormat("current passcode required to change".into())
                })?,
                &read_vault(&enc)?,
            )?
        } else {
            UnlockedVault {
                key: read_plain_identity_key(&id_dir.join("identity"))?,
                mnemonic: read_seed(&id_dir.join(SEED_FILE))?,
            }
        };
        let v = self.encrypt_identity(passcode, unlocked.key(), unlocked.mnemonic())?;
        let bytes = encode_vault(&v)?;
        // Verify both secrets once before the short publication phase. The strict
        // backend subsequently verifies that this exact encrypted image is stored.
        let decoded = self.decrypt_identity(passcode, &v)?;
        if decoded.key() != unlocked.key() || decoded.mnemonic() != unlocked.mnemonic() {
            return Err(VaultError::InvalidFormat(
                "vault candidate verification failed".into(),
            ));
        }
        Ok(PreparedProtection {
            id_dir: id_dir.to_path_buf(),
            previous,
            unlocked,
            bytes,
        })
    }
    pub fn commit_protection(&self, prepared: PreparedProtection) -> Result<(), VaultError> {
        let PreparedProtection {
            id_dir,
            previous,
            unlocked,
            bytes,
        } = prepared;
        let enc = id_dir.join("identity.enc");
        let id = id_dir.join("identity");
        let seed = id_dir.join(SEED_FILE);
        if read_file_bounded(&enc, MAX_VAULT_JSON_BYTES).map_err(io_error)? != previous {
            return Err(VaultError::InvalidFormat(
                "identity changed during vault preparation".into(),
            ));
        }
        if previous.is_none()
            && (read_plain_identity_key(&id)?.as_ref() != unlocked.key()
                || read_seed(&seed)?.as_deref().map(String::as_str) != unlocked.mnemonic())
        {
            return Err(VaultError::InvalidFormat(
                "identity changed during vault preparation".into(),
            ));
        }
        let candidate = private_sibling(&enc, "candidate");
        transition_checkpoint("before_candidate", false)?;
        strict_write(&candidate, &bytes)?;
        transition_checkpoint("after_candidate", false)?;
        let backup = if let Some(old) = previous {
            let path = private_sibling(&enc, "previous");
            strict_write(&path, &old)?;
            Some(path)
        } else {
            None
        };
        // Never remove a live replacement on failure. Candidate and backup remain
        // recoverable through any ambiguous publication or cleanup result.
        transition_checkpoint("after_backup", false)?;
        let witness = strict_write(&enc, &bytes)?;
        transition_checkpoint("after_publish", true)?;
        cleanup(&id, &witness)?;
        transition_checkpoint("after_plaintext_cleanup", true)?;
        cleanup(&seed, &witness)?;
        transition_checkpoint("after_seed_cleanup", true)?;
        cleanup(&candidate, &witness)?;
        transition_checkpoint("before_backup_cleanup", true)?;
        if let Some(path) = backup {
            cleanup(&path, &witness)?;
        }
        Ok(())
    }
    pub fn protect_identity(
        &self,
        id_dir: &Path,
        passcode: &str,
        current: Option<&str>,
    ) -> Result<(), VaultError> {
        self.commit_protection(self.prepare_protection(id_dir, passcode, current)?)
    }
    pub fn prepare_unprotection(
        &self,
        id_dir: &Path,
        passcode: &str,
    ) -> Result<PreparedUnprotection, VaultError> {
        let enc = id_dir.join("identity.enc");
        let previous = read_file_bounded(&enc, MAX_VAULT_JSON_BYTES)
            .map_err(io_error)?
            .ok_or_else(|| {
                VaultError::InvalidFormat("identity is not passcode-protected".into())
            })?;
        let unlocked = self.decrypt_identity(passcode, &read_vault(&enc)?)?;
        Ok(PreparedUnprotection {
            id_dir: id_dir.to_path_buf(),
            previous,
            unlocked,
        })
    }
    pub fn commit_unprotection(&self, prepared: PreparedUnprotection) -> Result<(), VaultError> {
        let PreparedUnprotection {
            id_dir,
            previous,
            unlocked,
        } = prepared;
        let enc = id_dir.join("identity.enc");
        let id = id_dir.join("identity");
        let seed = id_dir.join(SEED_FILE);
        if read_file_bounded(&enc, MAX_VAULT_JSON_BYTES)
            .map_err(io_error)?
            .as_deref()
            != Some(previous.as_slice())
        {
            return Err(VaultError::InvalidFormat(
                "identity changed during vault preparation".into(),
            ));
        }
        transition_checkpoint("before_unprotect_key", false)?;
        let witness = strict_write(&id, unlocked.key())?;
        transition_checkpoint("after_unprotect_key", false)?;
        if read_plain_identity_key(&id)?.as_ref() != unlocked.key() {
            return Err(VaultError::RecoveryRequired(
                "plaintext identity verification failed".into(),
            ));
        }
        if let Some(m) = unlocked.mnemonic() {
            write_seed_file(&seed, m)?;
        } else {
            cleanup(&seed, &witness)?;
        }
        transition_checkpoint("after_unprotect_seed", false)?;
        cleanup(&enc, &witness)?;
        transition_checkpoint("after_unprotect_vault_cleanup", true)
    }
    pub fn unprotect_identity(&self, id_dir: &Path, passcode: &str) -> Result<(), VaultError> {
        self.commit_unprotection(self.prepare_unprotection(id_dir, passcode)?)
    }
}

pub fn encrypt_key(passcode: &str, key: &[u8; 64]) -> Result<EncryptedVault, VaultError> {
    encrypt_identity(passcode, key, None)
}
pub fn encrypt_identity(
    passcode: &str,
    key: &[u8; 64],
    mnemonic: Option<&str>,
) -> Result<EncryptedVault, VaultError> {
    try_acquire_job()?.encrypt_identity(passcode, key, mnemonic)
}
pub fn decrypt_identity(passcode: &str, v: &EncryptedVault) -> Result<UnlockedVault, VaultError> {
    try_acquire_job()?.decrypt_identity(passcode, v)
}
pub fn decrypt_key(passcode: &str, v: &EncryptedVault) -> Result<Zeroizing<[u8; 64]>, VaultError> {
    Ok(decrypt_identity(passcode, v)?.key)
}
pub fn decrypt_mnemonic(
    passcode: &str,
    v: &EncryptedVault,
) -> Result<Option<Zeroizing<String>>, VaultError> {
    Ok(decrypt_identity(passcode, v)?.mnemonic)
}
pub fn protect_identity(
    id_dir: &Path,
    passcode: &str,
    current: Option<&str>,
) -> Result<(), VaultError> {
    try_acquire_job()?.protect_identity(id_dir, passcode, current)
}
pub fn unprotect_identity(id_dir: &Path, passcode: &str) -> Result<(), VaultError> {
    try_acquire_job()?.unprotect_identity(id_dir, passcode)
}
pub fn reveal_mnemonic(
    id_dir: &Path,
    passcode: Option<&str>,
) -> Result<Zeroizing<String>, VaultError> {
    try_acquire_job()?.reveal_mnemonic(id_dir, passcode)
}

fn io_error(e: std::io::Error) -> VaultError {
    VaultError::Io(e.to_string())
}
fn private_sibling(path: &Path, kind: &str) -> PathBuf {
    path.with_extension(format!("enc.{kind}-{}", uuid::Uuid::new_v4()))
}
fn strict_write(path: &Path, bytes: &[u8]) -> Result<DurableFileReceipt, VaultError> {
    durable_write(path, bytes).map_err(|e| match e.phase {
        rns_identity::persistence::DurableCommitPhase::NotCommitted => {
            VaultError::Io(e.to_string())
        }
        rns_identity::persistence::DurableCommitPhase::CommitUncertain => {
            VaultError::RecoveryRequired(e.to_string())
        }
    })
}
fn cleanup(path: &Path, witness: &DurableFileReceipt) -> Result<(), VaultError> {
    durable_remove(path, witness)
        .map(|_| ())
        .map_err(|e| VaultError::CleanupPending(e.to_string()))
}
fn encode_vault(v: &EncryptedVault) -> Result<Vec<u8>, VaultError> {
    ValidatedVault::new(v)?;
    let bytes =
        serde_json::to_vec_pretty(v).map_err(|_| VaultError::InvalidFormat("vault JSON".into()))?;
    if bytes.len() > MAX_VAULT_JSON_BYTES {
        return Err(VaultError::InvalidFormat("vault JSON size".into()));
    }
    Ok(bytes)
}
pub fn write_vault(path: &Path, v: &EncryptedVault) -> Result<(), VaultError> {
    strict_write(path, &encode_vault(v)?).map(|_| ())
}
pub fn read_vault(path: &Path) -> Result<EncryptedVault, VaultError> {
    let bytes = read_file_bounded(path, MAX_VAULT_JSON_BYTES)
        .map_err(io_error)?
        .ok_or_else(|| VaultError::Io("vault not found".into()))?;
    let value = parse_unique_json(&bytes, MAX_VAULT_JSON_BYTES)?;
    let v: EncryptedVault = serde_json::from_value(value)
        .map_err(|_| VaultError::InvalidFormat("vault properties".into()))?;
    ValidatedVault::new(&v)?;
    Ok(v)
}
/// Reads a secret file of at most `max_len` bytes into one buffer allocated
/// up front and wiped on drop, so neither growth nor a refused file leaves a
/// copy behind. `None` when the file does not exist.
fn read_secret_file(path: &Path, max_len: usize) -> std::io::Result<Option<Zeroizing<Vec<u8>>>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut data = Zeroizing::new(vec![0u8; max_len + 1]);
    let mut filled = 0;
    while filled < data.len() {
        match file.read(&mut data[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    if filled > max_len {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("file exceeds {max_len}-byte limit"),
        ));
    }
    data.truncate(filled);
    Ok(Some(data))
}
/// A plain identity file holds the raw 64-byte key; larger files are refused
/// after reading at most this much.
const PLAIN_IDENTITY_MAX_BYTES: usize = 1024;
pub fn read_plain_identity_key(path: &Path) -> Result<Zeroizing<[u8; 64]>, VaultError> {
    let bytes = read_secret_file(path, PLAIN_IDENTITY_MAX_BYTES)
        .map_err(io_error)?
        .ok_or_else(|| VaultError::Io("identity not found".into()))?;
    let key = Zeroizing::new(<[u8; 64]>::try_from(bytes.as_slice()).map_err(|_| {
        VaultError::InvalidFormat("private identity must be exactly 64 bytes".into())
    })?);
    Identity::from_private_key(&key[..])
        .map_err(|_| VaultError::InvalidFormat("private identity".into()))?;
    Ok(key)
}
fn read_seed(path: &Path) -> Result<Option<Zeroizing<String>>, VaultError> {
    read_secret_file(path, MAX_SEED_BYTES)
        .map_err(io_error)?
        .map(|bytes| {
            let phrase = std::str::from_utf8(&bytes)
                .map_err(|_| VaultError::InvalidFormat("seed utf8".into()))?;
            Ok(Zeroizing::new(phrase.trim().to_string()))
        })
        .transpose()
}
fn write_seed_file(path: &Path, phrase: &str) -> Result<(), VaultError> {
    if phrase.len() > MAX_SEED_BYTES {
        return Err(VaultError::InvalidFormat("seed exceeds size limit".into()));
    }
    strict_write(path, phrase.as_bytes())?;
    if read_seed(path)?.as_deref().map(String::as_str) != Some(phrase.trim()) {
        return Err(VaultError::RecoveryRequired(
            "seed verification failed".into(),
        ));
    }
    Ok(())
}
pub fn store_plaintext_seed(id_dir: &Path, mnemonic: &str) -> Result<(), VaultError> {
    try_acquire_job()?.store_plaintext_seed(id_dir, mnemonic)
}
pub fn has_stored_mnemonic(id_dir: &Path) -> bool {
    let enc = id_dir.join("identity.enc");
    if enc.exists() {
        return read_vault(&enc)
            .map(|v| v.mnemonic_token.is_some())
            .unwrap_or(false);
    }
    read_seed(&id_dir.join(SEED_FILE)).ok().flatten().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    // Cheap params so tests run fast (real defaults are memory-hard).
    fn fast() -> VaultParams {
        VaultParams {
            m_cost: 8 * 1024,
            t_cost: 1,
            p_cost: 1,
        }
    }

    fn encrypt_with(passcode: &str, key: &[u8; 64], p: VaultParams) -> EncryptedVault {
        encrypt_with_mnemonic(passcode, key, None, p)
    }

    fn encrypt_with_mnemonic(
        passcode: &str,
        key: &[u8; 64],
        mnemonic: Option<&str>,
        p: VaultParams,
    ) -> EncryptedVault {
        let salt = random::random_16();
        let kek = derive_kek(passcode, &salt, p).unwrap();
        let blob = token::encrypt(key, kek.as_ref()).unwrap();
        let mnemonic_token =
            mnemonic.map(|m| hex::encode(token::encrypt(m.as_bytes(), kek.as_ref()).unwrap()));
        EncryptedVault {
            version: VERSION,
            kdf: "argon2id".into(),
            m_cost: p.m_cost,
            t_cost: p.t_cost,
            p_cost: p.p_cost,
            salt: hex::encode(salt),
            token: hex::encode(blob),
            mnemonic_token,
        }
    }

    #[test]
    fn roundtrip() {
        let _serial = TEST_LOCK.blocking_lock();
        let key = [7u8; 64];
        let v = encrypt_with("correct horse battery", &key, fast());
        let out = decrypt_key("correct horse battery", &v).unwrap();
        assert_eq!(out.as_ref(), &key);
    }

    #[test]
    fn wrong_passcode_fails() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with("right-passcode", &[3u8; 64], fast());
        assert!(matches!(
            decrypt_key("wrong-passcode", &v),
            Err(VaultError::Auth)
        ));
    }

    #[test]
    fn param_tamper_fails() {
        let _serial = TEST_LOCK.blocking_lock();
        // Downgrading the stored params must not yield a usable KEK, even with the
        // correct passcode (proves params are bound to the KEK).
        let v = encrypt_with("pw", &[9u8; 64], fast());
        let mut tampered = v.clone();
        tampered.t_cost = v.t_cost + 1; // valid but different
        assert!(matches!(
            decrypt_key("pw", &tampered),
            Err(VaultError::Auth)
        ));
        let mut tampered2 = v.clone();
        tampered2.m_cost = v.m_cost * 2;
        assert!(matches!(
            decrypt_key("pw", &tampered2),
            Err(VaultError::Auth)
        ));
    }

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon \
         abandon abandon abandon abandon abandon abandon abandon abandon abandon \
         abandon abandon abandon abandon abandon art";

    #[test]
    fn mnemonic_roundtrip() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with_mnemonic("pw", &[5u8; 64], Some(PHRASE), fast());
        let out = decrypt_mnemonic("pw", &v).unwrap().unwrap();
        assert_eq!(out.as_str(), PHRASE);
        // The key still decrypts independently.
        assert_eq!(decrypt_key("pw", &v).unwrap().as_ref(), &[5u8; 64]);
    }

    #[test]
    fn mnemonic_absent_is_none() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with("pw", &[5u8; 64], fast());
        assert!(decrypt_mnemonic("pw", &v).unwrap().is_none());
    }

    #[test]
    fn mnemonic_wrong_passcode_fails() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with_mnemonic("right", &[5u8; 64], Some(PHRASE), fast());
        assert!(matches!(
            decrypt_mnemonic("wrong", &v),
            Err(VaultError::Auth)
        ));
    }

    #[test]
    fn corrupt_blob_fails() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with("pw", &[1u8; 64], fast());
        let mut t = v.clone();
        // flip a byte in the ciphertext
        let mut blob = hex::decode(&t.token).unwrap();
        let n = blob.len();
        blob[n / 2] ^= 0xFF;
        t.token = hex::encode(blob);
        assert!(matches!(decrypt_key("pw", &t), Err(VaultError::Auth)));
    }

    use std::sync::atomic::{AtomicU64, Ordering};
    static REVEAL_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_id_dir(tag: &str) -> std::path::PathBuf {
        let n = REVEAL_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("ratspeak-vault-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // A passcode-protected identity must reveal from the vault even if a stale
    // plaintext `.seed` survives the verify-before-delete window: the vault is
    // authoritative, so reveal honors the passcode and never leaks the decoy seed.
    #[test]
    fn reveal_prefers_vault_over_stale_seed() {
        let _serial = TEST_LOCK.blocking_lock();
        let dir = temp_id_dir("reveal");
        let v = encrypt_with_mnemonic("pw", &[1u8; 64], Some(PHRASE), fast());
        write_vault(&dir.join("identity.enc"), &v).unwrap();
        std::fs::write(dir.join(SEED_FILE), b"decoy decoy decoy").unwrap();

        assert!(reveal_mnemonic(&dir, None).is_err()); // .enc wins → passcode required
        assert_eq!(reveal_mnemonic(&dir, Some("pw")).unwrap().as_str(), PHRASE);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reveal_reads_plaintext_seed_when_unprotected() {
        let _serial = TEST_LOCK.blocking_lock();
        let dir = temp_id_dir("seed");
        std::fs::write(dir.join(SEED_FILE), PHRASE.as_bytes()).unwrap();
        assert!(has_stored_mnemonic(&dir));
        assert_eq!(reveal_mnemonic(&dir, None).unwrap().as_str(), PHRASE);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn secret_files_are_created_0600() {
        let _serial = TEST_LOCK.blocking_lock();
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_id_dir("mode");
        let v = encrypt_with_mnemonic("pw", &[7u8; 64], Some(PHRASE), fast());
        let enc_path = dir.join("identity.enc");
        write_vault(&enc_path, &v).unwrap();
        write_seed_file(&dir.join(SEED_FILE), PHRASE).unwrap();

        let enc_mode = std::fs::metadata(&enc_path).unwrap().permissions().mode() & 0o777;
        let seed_mode = std::fs::metadata(dir.join(SEED_FILE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(enc_mode, 0o600);
        assert_eq!(seed_mode, 0o600);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn vault_validation_rejects_work_before_derivation() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with("pw", &[1; 64], fast());
        let mut cases = Vec::new();
        for (m, t, p) in [
            (0, 1, 1),
            (7, 1, 1),
            (65_537, 1, 1),
            (65_536, 5, 1),
            (8192, 0, 1),
            (8192, 9, 1),
            (8192, 1, 0),
            (8192, 1, 5),
        ] {
            let mut x = v.clone();
            x.m_cost = m;
            x.t_cost = t;
            x.p_cost = p;
            cases.push(x);
        }
        for n in [0, 30, 31, 33, 34] {
            let mut x = v.clone();
            x.salt = "a".repeat(n);
            cases.push(x);
        }
        for n in [0, 254, 255, 257, 258] {
            let mut x = v.clone();
            x.token = "a".repeat(n);
            cases.push(x);
        }
        for n in [0, 63, 65, 4097] {
            let mut x = v.clone();
            x.mnemonic_token = Some("a".repeat(n * 2));
            cases.push(x);
        }
        let mut bad = v.clone();
        bad.version = 2;
        cases.push(bad);
        let mut bad = v.clone();
        bad.kdf = "different".into();
        cases.push(bad);
        let mut bad = v.clone();
        bad.token.replace_range(..1, "z");
        cases.push(bad);
        KDF_CALLS.with(|c| c.set(0));
        for x in cases {
            assert!(decrypt_identity("pw", &x).is_err());
        }
        assert!(decrypt_identity(&"a".repeat(MAX_PASSCODE_BYTES + 1), &v).is_err());
        assert_eq!(KDF_CALLS.with(|c| c.get()), 0);
        // A missing mnemonic cannot bypass validation or authentication.
        let mut bad = v.clone();
        bad.m_cost = u32::MAX;
        assert!(matches!(
            decrypt_mnemonic("pw", &bad),
            Err(VaultError::UnsupportedCost)
        ));
        assert!(matches!(
            decrypt_mnemonic("wrong", &v),
            Err(VaultError::Auth)
        ));
    }

    #[test]
    fn vault_cost_boundaries_and_single_unlock_derivation() {
        let _serial = TEST_LOCK.blocking_lock();
        for p in [1, 2, 3, 4] {
            assert!(
                VaultParams {
                    m_cost: 8 * p,
                    t_cost: 1,
                    p_cost: p
                }
                .checked()
                .is_ok()
            );
            assert!(
                VaultParams {
                    m_cost: 8 * p - 1,
                    t_cost: 1,
                    p_cost: p
                }
                .checked()
                .is_err()
            );
        }
        assert!(
            VaultParams {
                m_cost: 65_536,
                t_cost: 4,
                p_cost: 4
            }
            .checked()
            .is_ok()
        );
        assert!(
            VaultParams {
                m_cost: 32_768,
                t_cost: 8,
                p_cost: 1
            }
            .checked()
            .is_ok()
        );
        let v = encrypt_with_mnemonic("pw", &[3; 64], Some(PHRASE), fast());
        KDF_CALLS.with(|c| c.set(0));
        let u = decrypt_identity("pw", &v).unwrap();
        assert_eq!(u.key(), &[3; 64]);
        assert_eq!(u.mnemonic(), Some(PHRASE));
        assert_eq!(KDF_CALLS.with(|c| c.get()), 1);
    }

    #[test]
    fn vault_json_and_file_boundaries_are_enforced() {
        let _serial = TEST_LOCK.blocking_lock();
        assert!(parse_unique_json(br#"{"x":1,"x":2}"#, MAX_VAULT_JSON_BYTES).is_err());
        assert!(parse_unique_json(br#"{"metadata":{"x":1,"x":2}}"#, MAX_VAULT_JSON_BYTES).is_err());
        assert!(parse_unique_json(br#"{"metadata":{"x":1}}"#, MAX_VAULT_JSON_BYTES).is_ok());
        let dir = tempfile::tempdir().unwrap();
        let enc = dir.path().join("identity.enc");
        std::fs::write(&enc, vec![b' '; MAX_VAULT_JSON_BYTES + 1]).unwrap();
        assert!(read_vault(&enc).is_err());
        assert!(!has_stored_mnemonic(dir.path()));
        std::fs::remove_file(&enc).unwrap();
        std::fs::write(dir.path().join(SEED_FILE), vec![b'x'; MAX_SEED_BYTES + 1]).unwrap();
        assert!(!has_stored_mnemonic(dir.path()));
        assert!(reveal_mnemonic(dir.path(), None).is_err());
        let id = dir.path().join("identity");
        std::fs::write(&id, [0u8; 65]).unwrap();
        assert!(read_plain_identity_key(&id).is_err());
        std::fs::write(&id, [0u8; 64]).unwrap();
        assert!(read_plain_identity_key(&id).is_ok());
    }

    #[test]
    fn vault_public_guard_is_nonqueueing_and_covers_every_operation() {
        let _serial = TEST_LOCK.blocking_lock();
        let v = encrypt_with("pw", &[9; 64], fast());
        let job = try_acquire_job().unwrap();
        assert!(matches!(try_acquire_job(), Err(VaultError::Busy)));
        assert!(matches!(decrypt_key("pw", &v), Err(VaultError::Busy)));
        assert!(matches!(decrypt_mnemonic("pw", &v), Err(VaultError::Busy)));
        assert!(matches!(encrypt_key("pw", &[9; 64]), Err(VaultError::Busy)));
        assert_eq!(job.decrypt_identity("pw", &v).unwrap().key(), &[9; 64]);
        drop(job);
        assert!(try_acquire_job().is_ok());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn vault_cancelled_waiter_does_not_release_running_job() {
        let _serial = TEST_LOCK.lock().await;
        let job = try_acquire_job().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::task::spawn_blocking(move || {
            let _job = job;
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        });
        started_rx.await.unwrap();
        task.abort();
        tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        assert!(matches!(try_acquire_job(), Err(VaultError::Busy)));
        release_tx.send(()).unwrap();
        let _ = task.await;
        assert!(try_acquire_job().is_ok());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn vault_normal_derivation_keeps_async_executor_responsive() {
        let _serial = TEST_LOCK.lock().await;
        let job = try_acquire_job().unwrap();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let task = tokio::task::spawn_blocking(move || {
            started_tx.send(()).unwrap();
            job.encrypt_identity("normal-passcode", &[1; 64], None)
        });
        started_rx.await.unwrap();
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            tokio::task::yield_now(),
        )
        .await
        .unwrap();
        assert!(task.await.unwrap().is_ok());
    }

    #[test]
    fn vault_transition_faults_retain_key_and_phrase() {
        let _serial = TEST_LOCK.blocking_lock();
        for stage in [
            "before_candidate",
            "after_candidate",
            "after_backup",
            "after_publish",
            "after_plaintext_cleanup",
            "after_seed_cleanup",
            "before_backup_cleanup",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let old = encrypt_with_mnemonic("old-passcode", &[7; 64], Some(PHRASE), fast());
            write_vault(&dir.path().join("identity.enc"), &old).unwrap();
            let job = try_acquire_job().unwrap();
            let prepared = job
                .prepare_protection(dir.path(), "new-passcode", Some("old-passcode"))
                .unwrap();
            FAIL_STAGE.with(|s| s.set(Some(stage)));
            assert!(job.commit_protection(prepared).is_err());
            FAIL_STAGE.with(|s| s.set(None));
            let mut recovered = false;
            for entry in std::fs::read_dir(dir.path()).unwrap().flatten() {
                if let Ok(v) = read_vault(&entry.path()) {
                    for pass in ["old-passcode", "new-passcode"] {
                        if let Ok(u) = job.decrypt_identity(pass, &v) {
                            assert_eq!(u.key(), &[7; 64]);
                            assert_eq!(u.mnemonic(), Some(PHRASE));
                            recovered = true;
                        }
                    }
                }
            }
            assert!(recovered, "lost identity at {stage}");
        }
    }

    #[test]
    fn vault_prepared_transition_rejects_changed_identity() {
        let _serial = TEST_LOCK.blocking_lock();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity");
        std::fs::write(&path, [1u8; 64]).unwrap();
        let job = try_acquire_job().unwrap();
        let prepared = job
            .prepare_protection(dir.path(), "new-passcode", None)
            .unwrap();
        std::fs::write(&path, [2u8; 64]).unwrap();
        assert!(job.commit_protection(prepared).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), [2u8; 64]);
        assert!(!dir.path().join("identity.enc").exists());
    }

    #[test]
    fn vault_unprotect_faults_keep_a_verified_identity() {
        let _serial = TEST_LOCK.blocking_lock();
        for stage in [
            "before_unprotect_key",
            "after_unprotect_key",
            "after_unprotect_seed",
            "after_unprotect_vault_cleanup",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let enc = dir.path().join("identity.enc");
            let old = encrypt_with_mnemonic("old-passcode", &[7; 64], Some(PHRASE), fast());
            write_vault(&enc, &old).unwrap();
            let job = try_acquire_job().unwrap();
            let prepared = job
                .prepare_unprotection(dir.path(), "old-passcode")
                .unwrap();
            FAIL_STAGE.with(|s| s.set(Some(stage)));
            assert!(job.commit_unprotection(prepared).is_err());
            FAIL_STAGE.with(|s| s.set(None));
            if enc.exists() {
                let u = job
                    .decrypt_identity("old-passcode", &read_vault(&enc).unwrap())
                    .unwrap();
                assert_eq!(u.key(), &[7; 64]);
                assert_eq!(u.mnemonic(), Some(PHRASE));
            } else {
                assert_eq!(
                    read_plain_identity_key(&dir.path().join("identity"))
                        .unwrap()
                        .as_ref(),
                    &[7; 64]
                );
                assert_eq!(
                    read_seed(&dir.path().join(SEED_FILE))
                        .unwrap()
                        .unwrap()
                        .as_str(),
                    PHRASE
                );
            }
        }
    }
}
