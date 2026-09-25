//! MAC ownership registry + scan-only mutex.

use std::collections::HashMap;

use super::error::{GattError, GattErrorCode};
use super::profile::{GattProfile, normalize_address};

#[derive(Debug, Default)]
pub struct GattRegistry {
    /// Normalized address → owning profile.
    owners: HashMap<String, GattProfile>,
    scan_owner: Option<GattProfile>,
    scan_depth: u32,
}

impl GattRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn assert_can_connect(&self, address: &str, profile: GattProfile) -> Result<(), GattError> {
        let key = normalize_address(address)?;
        if let Some(owner) = self.owners.get(&key) {
            if *owner != profile {
                return Err(GattError::new(
                    GattErrorCode::MacConflict,
                    format!("peripheral {key} owned by {owner}"),
                )
                .with_owner(owner.as_str()));
            }
        }
        Ok(())
    }

    pub fn register(&mut self, address: &str, profile: GattProfile) -> Result<(), GattError> {
        self.assert_can_connect(address, profile)?;
        let key = normalize_address(address)?;
        self.owners.insert(key, profile);
        Ok(())
    }

    pub fn unregister(&mut self, address: &str, profile: GattProfile) -> Result<(), GattError> {
        let key = normalize_address(address)?;
        match self.owners.get(&key) {
            Some(owner) if *owner == profile => {
                self.owners.remove(&key);
                Ok(())
            }
            Some(owner) => Err(GattError::new(
                GattErrorCode::MacConflict,
                format!("cannot unregister {key}: owned by {owner}"),
            )
            .with_owner(owner.as_str())),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    pub fn owner_of(&self, address: &str) -> Result<Option<GattProfile>, GattError> {
        let key = normalize_address(address)?;
        Ok(self.owners.get(&key).copied())
    }

    pub fn acquire_scan(&mut self, profile: GattProfile) -> Result<(), GattError> {
        match self.scan_owner {
            None => {
                self.scan_owner = Some(profile);
                self.scan_depth = 1;
                Ok(())
            }
            Some(owner) if owner == profile => {
                self.scan_depth = self.scan_depth.saturating_add(1);
                Ok(())
            }
            Some(owner) => Err(GattError::new(
                GattErrorCode::ScanBusy,
                format!("scan held by {owner}"),
            )
            .with_owner(owner.as_str())),
        }
    }

    pub fn release_scan(&mut self, profile: GattProfile) -> Result<(), GattError> {
        match self.scan_owner {
            Some(owner) if owner == profile => {
                self.scan_depth = self.scan_depth.saturating_sub(1);
                if self.scan_depth == 0 {
                    self.scan_owner = None;
                }
                Ok(())
            }
            Some(owner) => Err(GattError::new(
                GattErrorCode::ScanBusy,
                format!("scan held by {owner}, cannot release as {profile}"),
            )
            .with_owner(owner.as_str())),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    pub fn scan_owner(&self) -> Option<GattProfile> {
        self.scan_owner
    }

    #[cfg(test)]
    pub fn session_count(&self) -> usize {
        self.owners.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_macs_ok_same_mac_conflicts() {
        let mut reg = GattRegistry::new();
        reg.register("AA:BB:CC:DD:EE:01", GattProfile::Meshtastic)
            .unwrap();
        reg.register("AA:BB:CC:DD:EE:02", GattProfile::Meshcore)
            .unwrap();
        let err = reg
            .register("aa:bb:cc:dd:ee:01", GattProfile::Rnode)
            .unwrap_err();
        assert_eq!(err.code, GattErrorCode::MacConflict);
        assert_eq!(err.owner.as_deref(), Some("meshtastic"));
        assert_eq!(
            reg.owner_of("AA:BB:CC:DD:EE:01").unwrap(),
            Some(GattProfile::Meshtastic)
        );
    }

    #[test]
    fn unregister_frees_mac() {
        let mut reg = GattRegistry::new();
        reg.register("11:22:33:44:55:66", GattProfile::Meshcore)
            .unwrap();
        reg.unregister("11:22:33:44:55:66", GattProfile::Meshcore)
            .unwrap();
        reg.register("11:22:33:44:55:66", GattProfile::Rnode)
            .unwrap();
        assert_eq!(reg.session_count(), 1);
    }

    #[test]
    fn scan_busy_while_held() {
        let mut reg = GattRegistry::new();
        reg.acquire_scan(GattProfile::Meshtastic).unwrap();
        let err = reg.acquire_scan(GattProfile::Meshcore).unwrap_err();
        assert_eq!(err.code, GattErrorCode::ScanBusy);
        reg.release_scan(GattProfile::Meshtastic).unwrap();
        reg.acquire_scan(GattProfile::Meshcore).unwrap();
    }

    #[test]
    fn scan_reentrant_same_owner() {
        let mut reg = GattRegistry::new();
        reg.acquire_scan(GattProfile::Peer).unwrap();
        reg.acquire_scan(GattProfile::Peer).unwrap();
        reg.release_scan(GattProfile::Peer).unwrap();
        assert!(reg.scan_owner().is_some());
        reg.release_scan(GattProfile::Peer).unwrap();
        assert!(reg.scan_owner().is_none());
    }
}
