//! Apply [`PnHostingPolicy`] to a live `LxmRouter` + `PropagationNode`.

use lxmf_core::peer::LxmPeer;
use lxmf_core::propagation_node::PropagationNode;
use lxmf_core::router::LxmRouter;

use super::pn_hosting_policy::PnHostingPolicy;

pub fn apply_pn_hosting_policy_to_router(router: &mut LxmRouter, policy: &PnHostingPolicy) {
    router.set_autopeer(policy.autopeer);
    router.set_max_peers(policy.max_peers);
    router.set_propagation_limit(policy.propagation_limit_kb);
    router.set_stamp_requirements(policy.propagation_stamp_cost, policy.propagation_stamp_flex);
    router.set_message_storage_limit(Some(policy.message_storage_limit_bytes()));
    router.set_authentication(policy.auth_required);
    // rsLXMF tip dropped set_enforce_stamps/ratchets (stamp gating via set_stamp_requirements).
    let _ = (policy.enforce_stamps, policy.enforce_ratchets);

    router.config.sync_limit_kb = policy.sync_limit_kb;
    #[allow(clippy::cast_precision_loss)] // KB policy is integer; router tip uses f64
    {
        router.config.delivery_limit_kb = policy.delivery_limit_kb as f64;
    }
    router.config.ext.peering_cost = policy.peering_cost;
    router.config.ext.max_peering_cost = policy.max_peering_cost;
    router.config.ext.autopeer_maxdepth = policy.autopeer_maxdepth;
    router.config.ext.from_static_only = policy.from_static_only;
    router.config.ext.name = policy.node_name.clone();

    router.static_peers.clear();
    let mut desired_static = std::collections::HashSet::new();
    for peer in &policy.static_peers {
        if let Ok(bytes) = hex::decode(peer)
            && let Ok(hash) = <[u8; 16]>::try_from(bytes.as_slice())
        {
            desired_static.insert(hash);
            if !router.static_peers.contains(&hash) {
                router.static_peers.push(hash);
            }
            let entry = router
                .peers
                .entry(hash)
                .or_insert_with(|| LxmPeer::new(hash));
            entry.is_static = true;
        } else {
            tracing::debug!(
                target: "pn-hosting-apply",
                peer = %peer,
                "skipping invalid static peer hash"
            );
        }
    }
    // Drop peers that exist only because of a prior static config entry.
    router
        .peers
        .retain(|hash, peer| !peer.is_static || desired_static.contains(hash));
}

pub fn apply_pn_hosting_policy_to_node(node: &mut PropagationNode, policy: &PnHostingPolicy) {
    node.set_min_stamp_cost(policy.min_stamp_cost());
    node.set_peering_cost(policy.peering_cost);
    node.set_max_storage(policy.message_storage_limit_bytes());
    node.set_max_message_size(policy.propagation_limit_kb.saturating_mul(1024));
}

#[cfg(test)]
mod tests {
    use super::*;
    use lxmf_core::router::RouterConfig;

    fn hash_from_hex(hex: &str) -> [u8; 16] {
        let bytes = ::hex::decode(hex).expect("hex");
        <[u8; 16]>::try_from(bytes.as_slice()).expect("16 bytes")
    }

    #[test]
    fn apply_prunes_stale_static_peers_and_keeps_discovered() {
        let mut router = LxmRouter::new(RouterConfig::default());
        let keep = hash_from_hex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let drop = hash_from_hex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        let discovered = hash_from_hex("cccccccccccccccccccccccccccccccc");

        let mut keep_peer = LxmPeer::new(keep);
        keep_peer.is_static = true;
        router.peers.insert(keep, keep_peer);
        let mut drop_peer = LxmPeer::new(drop);
        drop_peer.is_static = true;
        router.peers.insert(drop, drop_peer);
        router.peers.insert(discovered, LxmPeer::new(discovered));
        router.static_peers = vec![keep, drop];

        let policy = PnHostingPolicy {
            static_peers: vec!["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()],
            ..Default::default()
        };
        apply_pn_hosting_policy_to_router(&mut router, &policy);

        assert!(router.peers.contains_key(&keep));
        assert!(router.peers.get(&keep).is_some_and(|p| p.is_static));
        assert!(!router.peers.contains_key(&drop));
        assert!(router.peers.contains_key(&discovered));
        assert!(!router.peers.get(&discovered).is_some_and(|p| p.is_static));
        assert_eq!(router.static_peers, vec![keep]);
    }

    /// T6: autopeer / static_peers / maxdepth / max_peering_cost from hosting policy.
    #[test]
    fn autopeer_respects_policy_cost_depth_and_static_peers() {
        use lxmf_core::router::{AutopeerCandidate, RouterConfig};

        let mut router = LxmRouter::new(RouterConfig::default());
        let static_peer = hash_from_hex("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let deep = hash_from_hex("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        let costly = hash_from_hex("cccccccccccccccccccccccccccccccc");
        let ok = hash_from_hex("dddddddddddddddddddddddddddddddd");

        let policy = PnHostingPolicy {
            autopeer: true,
            autopeer_maxdepth: 2,
            max_peering_cost: 20,
            static_peers: vec![hex::encode(static_peer)],
            ..Default::default()
        };
        apply_pn_hosting_policy_to_router(&mut router, &policy);
        assert!(router.static_peers.contains(&static_peer));

        // Static peers peer even beyond autopeer_maxdepth.
        assert!(router.autopeer(AutopeerCandidate {
            destination_hash: static_peer,
            timebase: 1.0,
            transfer_limit: Some(256.0),
            sync_limit: Some(1024.0),
            stamp_cost: Some(16),
            stamp_flexibility: Some(3),
            peering_cost: Some(18),
            metadata: None,
            hops: Some(10),
        }));

        // Discovered beyond maxdepth declined.
        assert!(!router.autopeer(AutopeerCandidate {
            destination_hash: deep,
            timebase: 1.0,
            transfer_limit: Some(256.0),
            sync_limit: Some(1024.0),
            stamp_cost: Some(16),
            stamp_flexibility: Some(3),
            peering_cost: Some(18),
            metadata: None,
            hops: Some(5),
        }));

        // Peering cost above max declined.
        assert!(!router.autopeer(AutopeerCandidate {
            destination_hash: costly,
            timebase: 1.0,
            transfer_limit: Some(256.0),
            sync_limit: Some(1024.0),
            stamp_cost: Some(16),
            stamp_flexibility: Some(3),
            peering_cost: Some(26),
            metadata: None,
            hops: Some(1),
        }));

        assert!(router.autopeer(AutopeerCandidate {
            destination_hash: ok,
            timebase: 1.0,
            transfer_limit: Some(256.0),
            sync_limit: Some(1024.0),
            stamp_cost: Some(16),
            stamp_flexibility: Some(3),
            peering_cost: Some(18),
            metadata: None,
            hops: Some(1),
        }));
        assert!(router.peers.contains_key(&ok));
    }

    #[test]
    fn autopeer_off_declines_discovered_candidates() {
        use lxmf_core::router::{AutopeerCandidate, RouterConfig};

        let mut router = LxmRouter::new(RouterConfig::default());
        apply_pn_hosting_policy_to_router(
            &mut router,
            &PnHostingPolicy {
                autopeer: false,
                ..Default::default()
            },
        );
        let dest = hash_from_hex("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
        assert!(!router.autopeer(AutopeerCandidate {
            destination_hash: dest,
            timebase: 1.0,
            transfer_limit: Some(256.0),
            sync_limit: Some(1024.0),
            stamp_cost: Some(16),
            stamp_flexibility: Some(3),
            peering_cost: Some(18),
            metadata: None,
            hops: Some(1),
        }));
    }
}
