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
    router.set_enforce_stamps(policy.enforce_stamps);
    router.set_enforce_ratchets(policy.enforce_ratchets);

    router.config.sync_limit_kb = policy.sync_limit_kb;
    router.config.delivery_limit_kb = policy.delivery_limit_kb;
    router.config.ext.peering_cost = policy.peering_cost;
    router.config.ext.max_peering_cost = policy.max_peering_cost;
    router.config.ext.autopeer_maxdepth = policy.autopeer_maxdepth;
    router.config.ext.from_static_only = policy.from_static_only;
    router.config.ext.name = policy.node_name.clone();

    router.static_peers.clear();
    for peer in &policy.static_peers {
        if let Ok(bytes) = hex::decode(peer)
            && let Ok(hash) = <[u8; 16]>::try_from(bytes.as_slice())
        {
            if !router.static_peers.contains(&hash) {
                router.static_peers.push(hash);
            }
            router
                .peers
                .entry(hash)
                .or_insert_with(|| LxmPeer::new(hash));
        } else {
            tracing::debug!(
                target: "pn-hosting-apply",
                peer = %peer,
                "skipping invalid static peer hash"
            );
        }
    }
}

pub fn apply_pn_hosting_policy_to_node(node: &mut PropagationNode, policy: &PnHostingPolicy) {
    node.set_min_stamp_cost(policy.min_stamp_cost());
    node.set_peering_cost(policy.peering_cost);
    node.set_max_storage(policy.message_storage_limit_bytes());
    node.set_max_message_size(policy.propagation_limit_kb.saturating_mul(1024));
}
