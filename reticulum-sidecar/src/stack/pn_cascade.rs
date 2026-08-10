//! Multi-PN outbound cascade after Direct path failover exhausts.
//!
//! Order: preferred remote → other enabled remotes (hops asc) → Auto's discovered
//! remotes (hops asc) → local-prop last.

use std::collections::HashSet;

use crate::stack::DiscoveredPropagationRow;
use crate::stack::propagation_mode::PropagationMode;

/// Cap on Auto's ephemeral discovered candidates. Mirrors the renderer's
/// `MAX_DISCOVERED_SYNC_ATTEMPTS` so both sides work the same shortlist.
pub const MAX_AUTO_DISCOVERED_PN_CANDIDATES: usize = 3;

/// Path-table hop counts above this are treated as unknown for Auto deposit ranking.
/// Mirrors renderer `MAX_PLAUSIBLE_PROPAGATION_HOPS` (reticulumPropagationMode.ts).
pub const MAX_PLAUSIBLE_PROPAGATION_HOPS: u8 = 32;

/// Rank hops for sorting: finite plausible first, absurd/unknown last (`u8::MAX`).
pub fn hops_rank(hops: Option<u8>) -> u8 {
    match hops {
        Some(h) if h <= MAX_PLAUSIBLE_PROPAGATION_HOPS => h,
        _ => u8::MAX,
    }
}

/// One PN eligible for Direct→Propagated cascade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PnCascadeCandidate {
    pub hash: [u8; 16],
    /// True for local-prop hosted PN (last in cascade; still a full PN for peer sync).
    pub is_local: bool,
    /// True for an ephemeral Auto candidate heard from an announce (never persisted).
    pub is_discovered: bool,
    pub hops: Option<u8>,
    pub id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PnCascadePick {
    /// Deposit via a remote propagation node.
    Remote([u8; 16]),
    /// Deposit into local-prop (hosted PN Completes as `stored_locally`).
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
/// `preferred_hash` (when Some) is tried first among remotes; nodes the user added
/// come before Auto's discovered ones; local is always last when present and enabled.
pub fn build_pn_cascade_order(
    candidates: &[PnCascadeCandidate],
    preferred_hash: Option<[u8; 16]>,
) -> Vec<PnCascadeCandidate> {
    let mut remotes: Vec<PnCascadeCandidate> =
        candidates.iter().filter(|c| !c.is_local).cloned().collect();
    remotes.sort_by(|a, b| {
        let ah = hops_rank(a.hops);
        let bh = hops_rank(b.hops);
        a.is_discovered
            .cmp(&b.is_discovered)
            .then_with(|| ah.cmp(&bh))
            .then_with(|| a.id.cmp(&b.id))
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
                is_discovered: false,
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
            is_discovered: false,
            hops: *hops,
            id: id.clone(),
        });
    }
    out
}

/// Ephemeral cascade candidates from heard `lxmf.propagation` announces.
///
/// Auto may deposit offline LXMF on a PN the user never added, so the outbound cascade
/// matches what Auto sync already does — no Add, no Preferred write, nothing persisted.
/// Manual only uses nodes the user added, and Off has no cascade at all, so both return
/// an empty list.
pub fn auto_discovered_candidates(
    discovered: &[DiscoveredPropagationRow],
    configured: &[PnCascadeCandidate],
    self_lxmf_hash_hex: &str,
    mode: PropagationMode,
    max_peering_cost: u8,
    auto_blacklist: &HashSet<[u8; 16]>,
) -> Vec<PnCascadeCandidate> {
    if mode != PropagationMode::Auto {
        return Vec::new();
    }
    let self_norm = self_lxmf_hash_hex.trim().to_lowercase();
    let mut seen: HashSet<[u8; 16]> = configured.iter().map(|c| c.hash).collect();
    let mut out = Vec::new();
    for row in discovered {
        // Only nodes announcing that they are actively serving can accept a deposit.
        if !row.node_state || row.peering_cost > max_peering_cost {
            continue;
        }
        let Some(hash) = parse_hash16(&row.destination_hash) else {
            continue;
        };
        if auto_blacklist.contains(&hash) {
            continue;
        }
        if is_self_lxmf_hash(&hash, &self_norm) || !seen.insert(hash) {
            continue;
        }
        // Demote absurd hop counts (e.g. 100+ ghosts) to unknown so they cannot
        // outrank path-known remotes — same policy as renderer Auto sync ranking.
        let hops = match row.hops {
            Some(h) if h <= MAX_PLAUSIBLE_PROPAGATION_HOPS => Some(h),
            _ => None,
        };
        out.push(PnCascadeCandidate {
            hash,
            is_local: false,
            is_discovered: true,
            hops,
            id: format!("discovered-{}", &hex::encode(hash)[..8]),
        });
    }
    out.sort_by(|a, b| {
        let ah = hops_rank(a.hops);
        let bh = hops_rank(b.hops);
        ah.cmp(&bh).then_with(|| a.id.cmp(&b.id))
    });
    out.truncate(MAX_AUTO_DISCOVERED_PN_CANDIDATES);
    out
}

/// Cascade candidates for the active propagation mode.
///
/// Mode `Off` means no propagation support: no remote deposit and no local inbox fallback,
/// so Direct exhaustion is terminal.
pub fn candidates_for_propagation_mode(
    rows: &[(String, bool, Option<String>, Option<u8>)],
    self_lxmf_hash_hex: &str,
    mode: PropagationMode,
) -> Vec<PnCascadeCandidate> {
    if mode.is_off() {
        return Vec::new();
    }
    candidates_from_propagation_rows(rows, self_lxmf_hash_hex)
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
            is_discovered: false,
            hops,
            id: id.into(),
        }
    }

    fn local(hash_byte: u8) -> PnCascadeCandidate {
        PnCascadeCandidate {
            hash: [hash_byte; 16],
            is_local: true,
            is_discovered: false,
            hops: Some(0),
            id: "local-prop".into(),
        }
    }

    fn discovered_row(hash_hex: &str, hops: Option<u8>) -> DiscoveredPropagationRow {
        DiscoveredPropagationRow {
            destination_hash: hash_hex.into(),
            identity_hash: None,
            public_key: None,
            display_name: None,
            hops,
            last_seen: Some(1),
            node_state: true,
            peering_cost: 0,
        }
    }

    fn rows() -> Vec<(String, bool, Option<String>, Option<u8>)> {
        vec![
            ("local-prop".into(), true, Some("99".repeat(16)), Some(0u8)),
            ("pn-near".into(), true, Some("11".repeat(16)), Some(1u8)),
        ]
    }

    #[test]
    fn propagation_mode_off_yields_no_cascade_candidates() {
        let candidates = candidates_for_propagation_mode(&rows(), "", PropagationMode::Off);
        assert!(candidates.is_empty());
        assert!(!cascade_has_capacity(
            &build_pn_cascade_order(&candidates, None),
            &HashSet::new()
        ));
    }

    #[test]
    fn propagation_mode_auto_and_manual_keep_remote_and_local_candidates() {
        for mode in [PropagationMode::Auto, PropagationMode::Manual] {
            let candidates = candidates_for_propagation_mode(&rows(), "", mode);
            assert_eq!(candidates.len(), 2);
            assert!(cascade_has_capacity(
                &build_pn_cascade_order(&candidates, None),
                &HashSet::new()
            ));
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
    fn auto_appends_discovered_after_configured_and_before_local() {
        let configured = candidates_for_propagation_mode(&rows(), "", PropagationMode::Auto);
        let discovered = vec![discovered_row(&"ab".repeat(16), Some(0))];
        let extra = auto_discovered_candidates(
            &discovered,
            &configured,
            "",
            PropagationMode::Auto,
            u8::MAX,
            &HashSet::new(),
        );
        assert_eq!(extra.len(), 1);
        let mut all = configured;
        all.extend(extra);
        let ordered = build_pn_cascade_order(&all, None);
        // Configured "pn-near" (1 hop) still beats the 0-hop discovered node.
        assert_eq!(ordered[0].id, "pn-near");
        assert!(ordered[1].is_discovered);
        assert!(ordered[2].is_local);
    }

    #[test]
    fn manual_and_off_add_no_discovered_candidates() {
        let discovered = vec![discovered_row(&"ab".repeat(16), Some(1))];
        for mode in [PropagationMode::Manual, PropagationMode::Off] {
            assert!(
                auto_discovered_candidates(&discovered, &[], "", mode, u8::MAX, &HashSet::new())
                    .is_empty(),
                "{mode:?} must not deposit on a node the user never added"
            );
        }
    }

    #[test]
    fn auto_discovered_skips_inactive_self_configured_and_costly() {
        let self_hex = "aa".repeat(16);
        let configured = vec![remote(0xbb, Some(1), "pn-added")];
        let mut inactive = discovered_row(&"cc".repeat(16), Some(1));
        inactive.node_state = false;
        let mut costly = discovered_row(&"dd".repeat(16), Some(1));
        costly.peering_cost = 30;
        let discovered = vec![
            inactive,
            costly,
            discovered_row(&self_hex, Some(1)),
            // Already added by the user (uppercase on the wire).
            discovered_row(&"BB".repeat(16), Some(1)),
            discovered_row("not-a-hash", Some(1)),
            // Duplicate announce for the same destination.
            discovered_row(&"ee".repeat(16), Some(2)),
            discovered_row(&"ee".repeat(16), Some(2)),
        ];
        let extra = auto_discovered_candidates(
            &discovered,
            &configured,
            &self_hex,
            PropagationMode::Auto,
            26,
            &HashSet::new(),
        );
        assert_eq!(extra.len(), 1);
        assert_eq!(hex::encode(extra[0].hash), "ee".repeat(16));
    }

    #[test]
    fn auto_discovered_sorts_by_hops_and_caps_at_three() {
        let discovered = vec![
            discovered_row(&"55".repeat(16), None),
            discovered_row(&"44".repeat(16), Some(4)),
            discovered_row(&"11".repeat(16), Some(1)),
            discovered_row(&"33".repeat(16), Some(3)),
            discovered_row(&"22".repeat(16), Some(2)),
        ];
        let extra = auto_discovered_candidates(
            &discovered,
            &[],
            "",
            PropagationMode::Auto,
            u8::MAX,
            &HashSet::new(),
        );
        assert_eq!(extra.len(), MAX_AUTO_DISCOVERED_PN_CANDIDATES);
        assert_eq!(
            extra.iter().map(|c| c.hops).collect::<Vec<_>>(),
            vec![Some(1), Some(2), Some(3)],
            "unknown-hop announces must never displace a known-close node"
        );
    }

    #[test]
    fn auto_discovered_demotes_absurd_hop_counts() {
        let close = "11".repeat(16);
        let ghost = "99".repeat(16);
        let extra = auto_discovered_candidates(
            &[
                discovered_row(&ghost, Some(100)),
                discovered_row(&close, Some(2)),
            ],
            &[],
            "",
            PropagationMode::Auto,
            u8::MAX,
            &HashSet::new(),
        );
        assert_eq!(extra.len(), 2);
        assert_eq!(hex::encode(extra[0].hash), close);
        assert_eq!(extra[0].hops, Some(2));
        assert_eq!(extra[1].hops, None, "hops>32 must rank as unknown");
    }

    #[test]
    fn auto_discovered_only_still_reports_cascade_capacity() {
        let extra = auto_discovered_candidates(
            &[discovered_row(&"ab".repeat(16), Some(1))],
            &[],
            "",
            PropagationMode::Auto,
            u8::MAX,
            &HashSet::new(),
        );
        let ordered = build_pn_cascade_order(&extra, None);
        assert!(cascade_has_capacity(&ordered, &HashSet::new()));
        assert_eq!(
            pick_next_pn_cascade(&ordered, &HashSet::new()),
            PnCascadePick::Remote(extra[0].hash)
        );
    }

    #[test]
    fn auto_discovered_skips_auto_blacklist() {
        let blocked = "ab".repeat(16);
        let ok = "cd".repeat(16);
        let mut blocked_hash = [0u8; 16];
        blocked_hash.copy_from_slice(&hex::decode(&blocked).expect("hex"));
        let blacklist = HashSet::from([blocked_hash]);
        let extra = auto_discovered_candidates(
            &[
                discovered_row(&blocked, Some(0)),
                discovered_row(&ok, Some(2)),
            ],
            &[],
            "",
            PropagationMode::Auto,
            u8::MAX,
            &blacklist,
        );
        assert_eq!(extra.len(), 1);
        assert_eq!(hex::encode(extra[0].hash), ok);
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
