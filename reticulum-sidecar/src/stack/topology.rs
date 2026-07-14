use std::collections::{HashMap, HashSet};

use super::types::{ContactRow, NomadNodeRow, PeerRow, TopologyEdge};

const SELF_ID: &str = "self";

/// Cap peers considered when building a topology snapshot (IPC / graph serialization bound).
/// Aligns with the renderer force-graph render budget.
pub const TOPOLOGY_PEER_CAP: usize = 2_000;

/// Select newest peers by `last_seen` before graph construction.
pub fn select_peers_for_topology(peers: &[PeerRow], cap: usize) -> (Vec<PeerRow>, usize) {
    let total = peers.len();
    if total <= cap {
        return (peers.to_vec(), total);
    }
    let mut ranked: Vec<PeerRow> = peers.to_vec();
    ranked.sort_by(|a, b| {
        b.last_seen
            .unwrap_or(0)
            .cmp(&a.last_seen.unwrap_or(0))
            .then_with(|| a.destination_hash.cmp(&b.destination_hash))
    });
    ranked.truncate(cap);
    (ranked, total)
}

/// Build topology nodes and edges from path-table peers.
///
/// RNS `via_hash` is the immediate next-hop **transport id**, which may differ from a hub's
/// destination hash. Relay nodes referenced only as `via` are synthesized when missing.
pub fn build_topology(peers: &[PeerRow]) -> (Vec<PeerRow>, Vec<TopologyEdge>) {
    let mut peer_by_hash: HashMap<String, PeerRow> = HashMap::new();
    for peer in peers {
        if peer.destination_hash.is_empty() {
            continue;
        }
        peer_by_hash
            .entry(peer.destination_hash.clone())
            .or_insert_with(|| peer.clone());
    }

    let mut edges: Vec<TopologyEdge> = Vec::new();
    let mut edge_keys: HashSet<(String, String)> = HashSet::new();

    for peer in peers {
        if peer.destination_hash.is_empty() {
            continue;
        }
        let target = peer.destination_hash.clone();
        let source = peer
            .via_hash
            .as_ref()
            .filter(|via| !via.is_empty())
            .cloned()
            .unwrap_or_else(|| SELF_ID.into());
        let key = (source.clone(), target.clone());
        if edge_keys.insert(key) {
            edges.push(TopologyEdge { source, target });
        }

        if let Some(via) = peer.via_hash.as_ref() {
            if !via.is_empty() && !peer_by_hash.contains_key(via) {
                let relay_hops = peer.hops.map(|h| h.saturating_sub(1));
                peer_by_hash.entry(via.clone()).or_insert(PeerRow {
                    destination_hash: via.clone(),
                    display_name: None,
                    hops: relay_hops,
                    last_seen: peer.last_seen,
                    interface: peer.interface.clone(),
                    path_hash: None,
                    via_hash: None,
                });
            }
        }
    }

    infer_self_to_via_edges(&mut edges, &mut edge_keys);

    let mut nodes: Vec<PeerRow> = peer_by_hash.into_values().collect();
    nodes.sort_by(|a, b| a.destination_hash.cmp(&b.destination_hash));
    edges.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.target.cmp(&b.target))
    });
    (nodes, edges)
}

/// When a relay is only referenced as `via` (not its own path-table row), link it to self.
fn infer_self_to_via_edges(edges: &mut Vec<TopologyEdge>, edge_keys: &mut HashSet<(String, String)>) {
    let mut has_incoming = HashSet::new();
    let mut non_self_sources = HashSet::new();
    for edge in edges.iter() {
        has_incoming.insert(edge.target.clone());
        if edge.source != SELF_ID {
            non_self_sources.insert(edge.source.clone());
        }
    }
    for via in non_self_sources.into_iter().filter(|via| !has_incoming.contains(via)) {
        let key = (SELF_ID.into(), via.clone());
        if edge_keys.insert(key) {
            edges.push(TopologyEdge {
                source: SELF_ID.into(),
                target: via,
            });
        }
    }
}

/// Overlay cached display names onto topology nodes (path table rows omit names).
pub fn merge_topology_display_names(nodes: &mut [PeerRow], name_by_hash: &HashMap<String, String>) {
    for node in nodes.iter_mut() {
        if node.display_name.as_ref().is_some_and(|n| !n.is_empty()) {
            continue;
        }
        if let Some(name) = name_by_hash.get(&node.destination_hash) {
            node.display_name = Some(name.clone());
        }
    }
}

/// Collect human-readable labels from peers, LXMF contacts, and Nomad announces.
pub fn build_topology_name_map(
    peers: &[PeerRow],
    contacts: &[ContactRow],
    nomad_nodes: &[NomadNodeRow],
) -> HashMap<String, String> {
    let mut name_by_hash = HashMap::new();
    for peer in peers {
        if let Some(name) = peer.display_name.as_ref().filter(|n| !n.is_empty()) {
            name_by_hash.insert(peer.destination_hash.clone(), name.clone());
        }
    }
    for contact in contacts {
        if let Some(name) = contact.display_name.as_ref().filter(|n| !n.is_empty()) {
            name_by_hash
                .entry(contact.destination_hash.clone())
                .or_insert_with(|| name.clone());
        }
    }
    for node in nomad_nodes {
        if let Some(name) = node.display_name.as_ref().filter(|n| !n.is_empty()) {
            name_by_hash
                .entry(node.destination_hash.clone())
                .or_insert_with(|| name.clone());
        }
    }
    name_by_hash
}

/// Merge LXMF announce labels into a name map. Existing peer/contact/nomad entries win.
pub fn extend_name_map_with_announce_labels(
    name_by_hash: &mut HashMap<String, String>,
    announce_labels: &HashMap<String, String>,
) {
    for (hash, name) in announce_labels {
        if name.is_empty() {
            continue;
        }
        name_by_hash
            .entry(hash.clone())
            .or_insert_with(|| name.clone());
    }
}

/// Overlay known display names onto path-table peer rows.
pub fn overlay_peer_display_names(peers: &mut [PeerRow], name_by_hash: &HashMap<String, String>) {
    merge_topology_display_names(peers, name_by_hash);
}

/// True when `name` is only the first 12 hex chars of `hash` (placeholder alias).
pub fn is_hash_prefix_alias(hash: &str, name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return true;
    }
    let prefix: String = hash
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .take(12)
        .flat_map(|c| c.to_lowercase())
        .collect();
    trimmed.eq_ignore_ascii_case(&prefix)
}

/// Real (non-empty, non-hash-prefix) display name from a contact row, if any.
pub fn contact_real_display_name(contact: &ContactRow) -> Option<&str> {
    let name = contact.display_name.as_ref()?.trim();
    if name.is_empty() || is_hash_prefix_alias(&contact.destination_hash, name) {
        None
    } else {
        Some(name)
    }
}

/// Fill nameless / hash-prefix contact labels from announce/peer/nomad cache.
/// Does not overwrite an existing real contact name. Returns how many rows changed.
pub fn overlay_contact_display_names(
    contacts: &mut [ContactRow],
    name_by_hash: &HashMap<String, String>,
) -> usize {
    let mut changed = 0;
    for contact in contacts.iter_mut() {
        if contact_real_display_name(contact).is_some() {
            continue;
        }
        let Some(cached) = name_by_hash.get(&contact.destination_hash) else {
            continue;
        };
        let trimmed = cached.trim();
        if trimmed.is_empty() || is_hash_prefix_alias(&contact.destination_hash, trimmed) {
            continue;
        }
        contact.display_name = Some(trimmed.to_string());
        changed += 1;
    }
    changed
}

/// Prefer a real stored name; else a non-hash-prefix cache label.
pub fn resolve_contact_name_for_upsert(
    hash: &str,
    stored_name: Option<&str>,
    cache_name: Option<&str>,
) -> Option<String> {
    if let Some(name) = stored_name.map(str::trim).filter(|n| !n.is_empty()) {
        if !is_hash_prefix_alias(hash, name) {
            return Some(name.to_string());
        }
    }
    cache_name
        .map(str::trim)
        .filter(|n| !n.is_empty() && !is_hash_prefix_alias(hash, n))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(dest: &str, hops: u8, via: Option<&str>) -> PeerRow {
        PeerRow {
            destination_hash: dest.into(),
            display_name: None,
            hops: Some(hops),
            last_seen: Some(1),
            interface: Some("tcp".into()),
            path_hash: via.map(str::to_string),
            via_hash: via.map(str::to_string),
        }
    }

    #[test]
    fn select_peers_for_topology_keeps_newest_under_cap() {
        let peers: Vec<PeerRow> = (0..5)
            .map(|i| {
                let mut row = peer(&format!("{i:032x}"), 1, None);
                row.last_seen = Some(i);
                row
            })
            .collect();
        let (selected, total) = select_peers_for_topology(&peers, 3);
        assert_eq!(total, 5);
        assert_eq!(selected.len(), 3);
        assert_eq!(selected[0].last_seen, Some(4));
        assert_eq!(selected[2].last_seen, Some(2));
    }

    #[test]
    fn direct_peer_edges_from_self() {
        let (nodes, edges) = build_topology(&[peer("aa", 1, None)]);
        assert_eq!(nodes.len(), 1);
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].source, "self");
        assert_eq!(edges[0].target, "aa");
    }

    #[test]
    fn multi_hop_chain_uses_via_as_edge_source() {
        let hub = "hub11111111111111";
        let leaf = "leaf22222222222222";
        let (nodes, edges) = build_topology(&[
            peer(hub, 1, None),
            peer(leaf, 2, Some(hub)),
        ]);
        assert_eq!(nodes.len(), 2);
        assert!(edges.iter().any(|e| e.source == "self" && e.target == hub));
        assert!(edges.iter().any(|e| e.source == hub && e.target == leaf));
    }

    #[test]
    fn relay_node_created_when_only_referenced_as_via() {
        let hub = "hub33333333333333";
        let leaf = "leaf44444444444444";
        let (nodes, edges) = build_topology(&[peer(leaf, 2, Some(hub))]);
        assert_eq!(nodes.len(), 2);
        assert!(nodes.iter().any(|n| n.destination_hash == hub));
        assert!(edges.iter().any(|e| e.source == "self" && e.target == hub));
        assert!(edges.iter().any(|e| e.source == hub && e.target == leaf));
    }

    #[test]
    fn infer_self_link_for_relay_only_via() {
        let relay = "relay5555555555555";
        let leaf = "leaf66666666666666";
        let (_, edges) = build_topology(&[peer(leaf, 3, Some(relay))]);
        assert!(edges.iter().any(|e| e.source == "self" && e.target == relay));
        assert!(edges.iter().any(|e| e.source == relay && e.target == leaf));
    }

    #[test]
    fn build_topology_name_map_includes_nomad_nodes() {
        let names = build_topology_name_map(
            &[],
            &[],
            &[NomadNodeRow {
                destination_hash: "abc".into(),
                identity_hash: None,
                display_name: Some("Forum".into()),
                last_seen: None,
                favorited: false,
                hops: Some(2),
                status: None,
            }],
        );
        assert_eq!(names.get("abc").map(String::as_str), Some("Forum"));
    }

    #[test]
    fn merge_topology_display_names_overlays_cached_names() {
        let mut nodes = vec![PeerRow {
            destination_hash: "abc".into(),
            display_name: None,
            hops: Some(1),
            last_seen: None,
            interface: None,
            path_hash: None,
            via_hash: None,
        }];
        let mut names = HashMap::new();
        names.insert("abc".into(), "Alice".into());
        merge_topology_display_names(&mut nodes, &names);
        assert_eq!(nodes[0].display_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn announce_labels_fill_nameless_path_peers_without_overwriting_contacts() {
        let mut peers = vec![
            PeerRow {
                destination_hash: "aabb".into(),
                display_name: None,
                hops: Some(1),
                last_seen: Some(1),
                interface: Some("tcp".into()),
                path_hash: None,
                via_hash: None,
            },
            PeerRow {
                destination_hash: "ccdd".into(),
                display_name: None,
                hops: Some(2),
                last_seen: Some(2),
                interface: Some("tcp".into()),
                path_hash: None,
                via_hash: None,
            },
        ];
        let mut name_by_hash = build_topology_name_map(
            &[],
            &[ContactRow {
                destination_hash: "aabb".into(),
                display_name: Some("Saved Contact".into()),
                last_heard: Some(1),
                favorited: false,
            }],
            &[],
        );
        let mut announce = HashMap::new();
        announce.insert("aabb".into(), "Announce A".into());
        announce.insert("ccdd".into(), "Announce B".into());
        extend_name_map_with_announce_labels(&mut name_by_hash, &announce);
        overlay_peer_display_names(&mut peers, &name_by_hash);
        assert_eq!(peers[0].display_name.as_deref(), Some("Saved Contact"));
        assert_eq!(peers[1].display_name.as_deref(), Some("Announce B"));
    }

    #[test]
    fn mixed_direct_and_multi_hop_peers() {
        let hub = "hub77777777777777";
        let leaf = "leaf88888888888888";
        let (nodes, edges) = build_topology(&[
            peer("direct99", 1, None),
            peer(hub, 1, None),
            peer(leaf, 2, Some(hub)),
        ]);
        assert_eq!(nodes.len(), 3);
        assert!(edges.iter().any(|e| e.source == "self" && e.target == "direct99"));
        assert!(edges.iter().any(|e| e.source == "self" && e.target == hub));
        assert!(edges.iter().any(|e| e.source == hub && e.target == leaf));
    }

    #[test]
    fn is_hash_prefix_alias_matches_first_12_hex() {
        let hash = "aabbccddeeff00112233445566778899";
        assert!(is_hash_prefix_alias(hash, "aabbccddeeff"));
        assert!(is_hash_prefix_alias(hash, "AABBCCDDEEFF"));
        assert!(is_hash_prefix_alias(hash, ""));
        assert!(!is_hash_prefix_alias(hash, "Alice"));
        assert!(!is_hash_prefix_alias(hash, "aabbccddeef"));
    }

    #[test]
    fn overlay_contact_display_names_fills_nameless_from_cache() {
        let hash = "aabbccddeeff00112233445566778899";
        let mut contacts = vec![
            ContactRow {
                destination_hash: hash.into(),
                display_name: None,
                last_heard: Some(1),
                favorited: false,
            },
            ContactRow {
                destination_hash: "11223344556677889900aabbccddeeff".into(),
                display_name: Some("Saved".into()),
                last_heard: Some(2),
                favorited: false,
            },
        ];
        let mut names = HashMap::new();
        names.insert(hash.into(), "Hub Peer".into());
        names.insert(
            "11223344556677889900aabbccddeeff".into(),
            "Announce Override".into(),
        );
        let changed = overlay_contact_display_names(&mut contacts, &names);
        assert_eq!(changed, 1);
        assert_eq!(contacts[0].display_name.as_deref(), Some("Hub Peer"));
        assert_eq!(contacts[1].display_name.as_deref(), Some("Saved"));
    }

    #[test]
    fn overlay_contact_display_names_replaces_hash_prefix_placeholder() {
        let hash = "deadbeefcafebabe0123456789abcdef";
        let mut contacts = vec![ContactRow {
            destination_hash: hash.into(),
            display_name: Some("deadbeefcafe".into()),
            last_heard: Some(1),
            favorited: false,
        }];
        let mut names = HashMap::new();
        names.insert(hash.into(), "Real Name".into());
        assert_eq!(overlay_contact_display_names(&mut contacts, &names), 1);
        assert_eq!(contacts[0].display_name.as_deref(), Some("Real Name"));
    }

    #[test]
    fn resolve_contact_name_for_upsert_prefers_stored_real_name() {
        let hash = "aabbccddeeff00112233445566778899";
        assert_eq!(
            resolve_contact_name_for_upsert(hash, Some("Stored"), Some("Cached")).as_deref(),
            Some("Stored")
        );
        assert_eq!(
            resolve_contact_name_for_upsert(hash, Some("aabbccddeeff"), Some("Cached")).as_deref(),
            Some("Cached")
        );
        assert_eq!(
            resolve_contact_name_for_upsert(hash, None, Some("aabbccddeeff")),
            None
        );
    }
}
