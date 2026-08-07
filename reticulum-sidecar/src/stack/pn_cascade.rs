//! Multi-PN outbound cascade after Direct path failover exhausts.
//!
//! Order: preferred remote → other enabled remotes (hops asc) → local-prop last.

use std::collections::HashSet;

/// One configured PN eligible for Direct→Propagated cascade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PnCascadeCandidate {
    pub hash: [u8; 16],
    /// True for local-prop / self LXMF hash (offline inbox — last resort only).
    pub is_local: bool,
    pub hops: Option<u8>,
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PnCascadePick {
    /// Deposit via a remote propagation node.
    Remote([u8; 16]),
    /// Deposit into local-prop (offline inbox; not peer-delivered).
    Local([u8; 16]),
    /// No remaining candidates.
    Exhausted,
}

impl PnCascadePick {
    pub fn hash(self) -> Option<[u8; 16]> {
        match self {
            PnCascadePick::Remote(h) | PnCascadePick::Local(h) => Some(h),
            PnCascadePick::Exhausted => None,
        }
    }

    pub fn is_local(self) -> bool {
        matches!(self, PnCascadePick::Local(_))
    }

    pub fn delivery_method_label(self) -> Option<&'static str> {
        match self {
            PnCascadePick::Remote(_) => Some("propagated"),
            PnCascadePick::Local(_) => Some("stored_locally"),
            PnCascadePick::Exhausted => None,
        }
    }
}

/// Build an ordered cascade list from persisted propagation rows.
///
/// `preferred_hash` (when Some) is tried first among remotes; local is always last
/// when present and enabled.
pub fn build_pn_cascade_order(
    candidates: &[PnCascadeCandidate],
    preferred_hash: Option<[u8; 16]>,
) -> Vec<PnCascadeCandidate> {
    let mut remotes: Vec<PnCascadeCandidate> =
        candidates.iter().filter(|c| !c.is_local).cloned().collect();
    remotes.sort_by(|a, b| {
        let ah = a.hops.unwrap_or(u8::MAX);
        let bh = b.hops.unwrap_or(u8::MAX);
        ah.cmp(&bh).then_with(|| a.id.cmp(&b.id))
    });
    // Only reorder among enabled candidates — never synthesize a disabled/stale preferred.
    if let Some(pref) = preferred_hash {
        if let Some(idx) = remotes.iter().position(|c| c.hash == pref) {
            let preferred = remotes.remove(idx);
            remotes.insert(0, preferred);
        }
    }
    let mut out = remotes;
    if let Some(local) = candidates.iter().find(|c| c.is_local).cloned() {
        out.push(local);
    }
    out
}

/// Pick the next untried PN from an ordered cascade.
pub fn pick_next_pn_cascade(
    ordered: &[PnCascadeCandidate],
    tried: &HashSet<[u8; 16]>,
) -> PnCascadePick {
    for c in ordered {
        if tried.contains(&c.hash) {
            continue;
        }
        if c.is_local {
            return PnCascadePick::Local(c.hash);
        }
        return PnCascadePick::Remote(c.hash);
    }
    PnCascadePick::Exhausted
}

/// Whether Direct failure may enter the PN cascade (any untried candidate remains).
pub fn cascade_has_capacity(ordered: &[PnCascadeCandidate], tried: &HashSet<[u8; 16]>) -> bool {
    !matches!(
        pick_next_pn_cascade(ordered, tried),
        PnCascadePick::Exhausted
    )
}

/// True when `hash_hex` equals self LXMF destination (case-insensitive).
pub fn is_self_lxmf_hash(hash: &[u8; 16], self_lxmf_hash_hex: &str) -> bool {
    hex::encode(hash).eq_ignore_ascii_case(self_lxmf_hash_hex.trim())
}

/// Parse enabled propagation rows into cascade candidates.
///
/// Local-prop eligibility uses the row `enabled` flag only (single source of truth).
/// Local-prop hash must be the lxmf.propagation destination — never fall back to self LXMF.
pub fn candidates_from_propagation_rows(
    rows: &[(String, bool, Option<String>, Option<u8>)],
    self_lxmf_hash_hex: &str,
) -> Vec<PnCascadeCandidate> {
    let self_norm = self_lxmf_hash_hex.trim().to_lowercase();
    let mut out = Vec::new();
    for (id, enabled, dest_hash, hops) in rows {
        if id == "local-prop" {
            if !*enabled {
                continue;
            }
            // Require the real lxmf.propagation dest — self LXMF is Nomad/delivery identity.
            let Some(hash) = dest_hash.as_ref().and_then(|h| parse_hash16(h)) else {
                continue;
            };
            out.push(PnCascadeCandidate {
                hash,
                is_local: true,
                hops: *hops,
                id: id.clone(),
            });
            continue;
        }
        if !*enabled {
            continue;
        }
        let Some(hash) = dest_hash.as_ref().and_then(|h| parse_hash16(h)) else {
            continue;
        };
        if is_self_lxmf_hash(&hash, &self_norm) {
            continue;
        }
        out.push(PnCascadeCandidate {
            hash,
            is_local: false,
            hops: *hops,
            id: id.clone(),
        });
    }
    out
}

fn parse_hash16(hex_str: &str) -> Option<[u8; 16]> {
    let clean: String = hex_str.chars().filter(char::is_ascii_hexdigit).collect();
    if clean.len() != 32 {
        return None;
    }
    let bytes = hex::decode(&clean).ok()?;
    let arr: [u8; 16] = bytes.try_into().ok()?;
    Some(arr)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(hash_byte: u8, hops: Option<u8>, id: &str) -> PnCascadeCandidate {
        PnCascadeCandidate {
            hash: [hash_byte; 16],
            is_local: false,
            hops,
            id: id.into(),
        }
    }

    fn local(hash_byte: u8) -> PnCascadeCandidate {
        PnCascadeCandidate {
            hash: [hash_byte; 16],
            is_local: true,
            hops: Some(0),
            id: "local-prop".into(),
        }
    }

    #[test]
    fn order_preferred_first_then_hops_then_local() {
        let candidates = vec![
            remote(0x22, Some(4), "pn-far"),
            remote(0x11, Some(1), "pn-near"),
            local(0x99),
        ];
        let preferred = [0x22; 16];
        let ordered = build_pn_cascade_order(&candidates, Some(preferred));
        assert_eq!(ordered[0].hash, preferred);
        assert_eq!(ordered[1].id, "pn-near");
        assert!(ordered.last().is_some_and(|c| c.is_local));
    }

    #[test]
    fn pick_skips_tried_and_ends_on_local() {
        let ordered = build_pn_cascade_order(
            &[
                remote(0x11, Some(1), "a"),
                remote(0x22, Some(2), "b"),
                local(0x99),
            ],
            Some([0x11; 16]),
        );
        let mut tried = HashSet::new();
        assert_eq!(
            pick_next_pn_cascade(&ordered, &tried),
            PnCascadePick::Remote([0x11; 16])
        );
        tried.insert([0x11; 16]);
        assert_eq!(
            pick_next_pn_cascade(&ordered, &tried),
            PnCascadePick::Remote([0x22; 16])
        );
        tried.insert([0x22; 16]);
        assert_eq!(
            pick_next_pn_cascade(&ordered, &tried),
            PnCascadePick::Local([0x99; 16])
        );
        tried.insert([0x99; 16]);
        assert_eq!(
            pick_next_pn_cascade(&ordered, &tried),
            PnCascadePick::Exhausted
        );
    }

    #[test]
    fn cascade_capacity_false_when_exhausted() {
        let ordered = build_pn_cascade_order(&[remote(0x11, None, "a")], None);
        let mut tried = HashSet::new();
        tried.insert([0x11; 16]);
        assert!(!cascade_has_capacity(&ordered, &tried));
        assert!(cascade_has_capacity(&ordered, &HashSet::new()));
    }

    #[test]
    fn candidates_from_rows_skips_disabled_and_self_remote() {
        let self_hex = "aa".repeat(16);
        let prop_dest = "dd".repeat(16);
        let rows = vec![
            ("pn-a".into(), true, Some("bb".repeat(16)), Some(1u8)),
            ("pn-self".into(), true, Some(self_hex.clone()), Some(0u8)),
            ("pn-off".into(), false, Some("cc".repeat(16)), None),
            ("local-prop".into(), true, Some(prop_dest.clone()), Some(0)),
        ];
        let c = candidates_from_propagation_rows(&rows, &self_hex);
        assert_eq!(c.iter().filter(|x| !x.is_local).count(), 1);
        assert_eq!(c.iter().filter(|x| x.is_local).count(), 1);
        assert_eq!(
            hex::encode(c.iter().find(|x| x.is_local).unwrap().hash),
            prop_dest
        );
    }

    #[test]
    fn candidates_skip_disabled_local_and_missing_prop_dest() {
        let self_hex = "aa".repeat(16);
        let rows = vec![
            ("local-prop".into(), false, Some("dd".repeat(16)), Some(0)),
            ("local-prop".into(), true, None, Some(0)),
        ];
        let c = candidates_from_propagation_rows(&rows, &self_hex);
        assert!(c.is_empty());
    }

    #[test]
    fn delivery_method_labels() {
        assert_eq!(
            PnCascadePick::Remote([0; 16]).delivery_method_label(),
            Some("propagated")
        );
        assert_eq!(
            PnCascadePick::Local([0; 16]).delivery_method_label(),
            Some("stored_locally")
        );
        assert_eq!(PnCascadePick::Exhausted.delivery_method_label(), None);
    }

    #[test]
    fn order_skips_preferred_not_in_enabled_list() {
        let candidates = vec![remote(0x11, Some(1), "pn-a"), local(0x99)];
        let stale_preferred = [0xee; 16];
        let ordered = build_pn_cascade_order(&candidates, Some(stale_preferred));
        assert_eq!(ordered[0].hash, [0x11; 16]);
        assert!(!ordered.iter().any(|c| c.hash == stale_preferred));
    }

    #[test]
    fn is_self_lxmf_hash_case_insensitive() {
        let hash = [0xaa; 16];
        let hex = hex::encode(hash);
        assert!(is_self_lxmf_hash(&hash, &hex));
        assert!(is_self_lxmf_hash(&hash, &hex.to_uppercase()));
        assert!(!is_self_lxmf_hash(&hash, &"bb".repeat(16)));
    }
}
