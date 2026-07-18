//! Path speed / capability classification for rnsh (remote shell) and rncp
//! (file transfer) gating.
//!
//! Built on top of the transport atoms already produced by [`super::via`]
//! (`"tcp"`, `"network"`, `"rf"`, `"ble"`). This module has no dependency on
//! the live rns-stack — it is pure classification logic over atoms the
//! caller has already resolved, so it stays available (and unit-testable)
//! in stub builds too.

/// Coarse speed/capability bucket for a resolved egress path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathSpeed {
    /// Path is exclusively high-speed transports (TCP / generic network).
    High,
    /// Path is exclusively bandwidth-constrained transports (RF / BLE).
    Constrained,
    /// Path observed a mix of high-speed and constrained atoms (e.g. a
    /// multi-hop route that egresses locally over TCP but also touches RF).
    Mixed,
    /// No atoms resolved (peer not in the path table yet, or the resolved
    /// atom is not one we recognize).
    Unknown,
}

impl PathSpeed {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Constrained => "constrained",
            Self::Mixed => "mixed",
            Self::Unknown => "unknown",
        }
    }
}

/// rnsh / rncp gating decision for one destination.
#[derive(Debug, Clone)]
pub struct PathCapability {
    pub destination_hash: String,
    pub speed: PathSpeed,
    pub via_atoms: Vec<&'static str>,
    pub hops: Option<u32>,
    /// Whether rncp send/fetch should be offered for this path.
    pub transfer_allowed: bool,
    /// Whether rnsh connect should be offered for this path. Constrained and
    /// unknown paths still allow shell (it is interactive/low-bandwidth by
    /// nature) but callers should surface `reason_key` as a soft warning.
    pub shell_allowed: bool,
    /// i18n key for the renderer to explain a restriction/warning, when set.
    pub reason_key: Option<&'static str>,
}

const HIGH_SPEED_ATOMS: &[&str] = &["tcp", "network"];
const CONSTRAINED_ATOMS: &[&str] = &["rf", "ble"];

/// Classifies a set of resolved via-atoms (see [`super::via::classify_interface`])
/// into a coarse [`PathSpeed`] bucket.
///
/// - Only high-speed atoms (`tcp` / `network`) present → [`PathSpeed::High`].
/// - Only constrained atoms (`rf` / `ble`) present → [`PathSpeed::Constrained`].
/// - Both kinds present → [`PathSpeed::Mixed`].
/// - Empty, or atoms outside the known set → [`PathSpeed::Unknown`].
pub fn classify_via_atoms(atoms: &[&'static str]) -> PathSpeed {
    let has_high = atoms.iter().any(|a| HIGH_SPEED_ATOMS.contains(a));
    let has_constrained = atoms.iter().any(|a| CONSTRAINED_ATOMS.contains(a));
    match (has_high, has_constrained) {
        (true, false) => PathSpeed::High,
        (false, true) => PathSpeed::Constrained,
        (true, true) => PathSpeed::Mixed,
        (false, false) => PathSpeed::Unknown,
    }
}

/// Builds the full rnsh/rncp gating decision for `destination_hash` from its
/// resolved via-atoms and (optional) path-table hop count.
pub fn path_capability_from_atoms(
    destination_hash: &str,
    atoms: &[&'static str],
    hops: Option<u32>,
) -> PathCapability {
    let speed = classify_via_atoms(atoms);
    let (transfer_allowed, shell_allowed, reason_key) = match speed {
        PathSpeed::High | PathSpeed::Mixed => (true, true, None),
        PathSpeed::Constrained => (false, true, Some("path_constrained")),
        PathSpeed::Unknown => (false, true, Some("path_unknown")),
    };
    PathCapability {
        destination_hash: destination_hash.to_string(),
        speed,
        via_atoms: atoms.to_vec(),
        hops,
        transfer_allowed,
        shell_allowed,
        reason_key,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_high_speed_only() {
        assert_eq!(classify_via_atoms(&["tcp"]), PathSpeed::High);
        assert_eq!(classify_via_atoms(&["network"]), PathSpeed::High);
        assert_eq!(classify_via_atoms(&["tcp", "network"]), PathSpeed::High);
    }

    #[test]
    fn classify_constrained_only() {
        assert_eq!(classify_via_atoms(&["rf"]), PathSpeed::Constrained);
        assert_eq!(classify_via_atoms(&["ble"]), PathSpeed::Constrained);
        assert_eq!(classify_via_atoms(&["rf", "ble"]), PathSpeed::Constrained);
    }

    #[test]
    fn classify_mixed_when_both_kinds_present() {
        assert_eq!(classify_via_atoms(&["rf", "tcp"]), PathSpeed::Mixed);
        assert_eq!(classify_via_atoms(&["ble", "network"]), PathSpeed::Mixed);
    }

    #[test]
    fn classify_unknown_when_empty_or_unrecognized() {
        assert_eq!(classify_via_atoms(&[]), PathSpeed::Unknown);
        assert_eq!(classify_via_atoms(&["mqtt"]), PathSpeed::Unknown);
    }

    #[test]
    fn high_speed_path_allows_transfer_and_shell() {
        let cap = path_capability_from_atoms("abc123", &["tcp"], Some(2));
        assert_eq!(cap.speed, PathSpeed::High);
        assert!(cap.transfer_allowed);
        assert!(cap.shell_allowed);
        assert_eq!(cap.reason_key, None);
        assert_eq!(cap.hops, Some(2));
        assert_eq!(cap.destination_hash, "abc123");
    }

    #[test]
    fn constrained_path_blocks_transfer_but_allows_shell() {
        let cap = path_capability_from_atoms("abc123", &["rf"], Some(3));
        assert_eq!(cap.speed, PathSpeed::Constrained);
        assert!(!cap.transfer_allowed);
        assert!(cap.shell_allowed);
        assert_eq!(cap.reason_key, Some("path_constrained"));
    }

    #[test]
    fn mixed_path_allows_transfer_and_shell() {
        let cap = path_capability_from_atoms("abc123", &["rf", "tcp"], None);
        assert_eq!(cap.speed, PathSpeed::Mixed);
        assert!(cap.transfer_allowed);
        assert!(cap.shell_allowed);
        assert_eq!(cap.reason_key, None);
    }

    #[test]
    fn unknown_path_blocks_transfer_with_soft_shell_warning() {
        let cap = path_capability_from_atoms("abc123", &[], None);
        assert_eq!(cap.speed, PathSpeed::Unknown);
        assert!(!cap.transfer_allowed);
        assert!(cap.shell_allowed);
        assert_eq!(cap.reason_key, Some("path_unknown"));
        assert!(cap.via_atoms.is_empty());
    }
}
