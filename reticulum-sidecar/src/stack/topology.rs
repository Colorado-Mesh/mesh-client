use std::collections::{HashMap, HashSet};

use super::types::{PeerRow, TopologyEdge};

/// Build topology nodes and edges from path-table peers.
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
            .unwrap_or_else(|| "self".into());
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

    let mut nodes: Vec<PeerRow> = peer_by_hash.into_values().collect();
    nodes.sort_by(|a, b| a.destination_hash.cmp(&b.destination_hash));
    edges.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.target.cmp(&b.target))
    });
    (nodes, edges)
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
        assert!(edges.iter().any(|e| e.source == hub && e.target == leaf));
    }
}
