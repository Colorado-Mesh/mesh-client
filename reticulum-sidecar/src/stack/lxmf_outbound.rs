//! LXMF outbound delivery loop (Direct / Propagated) via LinkDeliveryManager.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use lxmf_core::constants::{
    DELIVERY_RETRY_WAIT, DeliveryMethod, MAX_DELIVERY_ATTEMPTS, PATH_REQUEST_WAIT,
};
use lxmf_core::link_delivery::{
    DeliveryResult, LinkDeliveryManager, is_retryable_link_delivery_failure,
};
use lxmf_core::message::LxMessage;
use lxmf_core::propagation_node::PropagationNode;
use lxmf_core::router::{
    DirectDeliveryPlan, DirectDeliveryPlanInput, DirectReusableLinkState, DirectRouteSnapshot,
    LxmRouter, OutboundAction, plan_direct_delivery,
};
use lxmf_core::stamper;
use rns_identity::identity::Identity;
use rns_transport::messages::{TransportMessage, TransportQuery};
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use super::super::auto_path_policy::{
    prefer_ifaces_for_failover, should_preempt_auto_for_private_direct,
    should_prefer_private_after_auto_failure,
};
use super::super::path_failover::{
    IFACE_SUPPRESS_SECS, build_path_failover_control_ops, push_tried_iface,
    should_retry_direct_path_failover,
};
use super::super::types::InterfaceRow;
use super::super::via::classify_interface;
use super::parse_hash16;
use super::pn_cascade::{
    PnCascadeCandidate, build_pn_cascade_order, cascade_has_capacity, pick_next_pn_cascade,
};

const PATH_REQUEST_BACKOFF_SECS: f64 = 20.0;
const PATH_REQUEST_MAX_ATTEMPTS: u32 = 12;

/// Per-message Direct path exhaustion before preferred-PN fallback.
#[derive(Debug, Clone, Default)]
struct DirectPathFailoverState {
    rounds: u8,
    blocked_vias: Vec<String>,
    tried_interfaces: Vec<String>,
}

/// One GetPathTable row mirrored into the outbound driver cache.
#[derive(Debug, Clone)]
pub struct PathTableRoute {
    pub hash: [u8; 16],
    pub hops: u8,
    pub hex_key: String,
    pub interface: Option<String>,
    pub via: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PathRequestDecision {
    Send,
    Backoff,
    MaxAttempts,
}

/// Rate-limits `RequestPath` when the transport channel is full (avoids retry storms).
struct PathRequestGate {
    backoff_until: HashMap<[u8; 16], f64>,
    fail_count: HashMap<[u8; 16], u32>,
    last_warn_at: HashMap<[u8; 16], f64>,
}

impl PathRequestGate {
    fn new() -> Self {
        Self {
            backoff_until: HashMap::new(),
            fail_count: HashMap::new(),
            last_warn_at: HashMap::new(),
        }
    }

    fn clear_destination(&mut self, dest: [u8; 16]) {
        self.backoff_until.remove(&dest);
        self.fail_count.remove(&dest);
        self.last_warn_at.remove(&dest);
    }

    fn decide(&self, dest: [u8; 16], now: f64) -> PathRequestDecision {
        if self.fail_count.get(&dest).copied().unwrap_or(0) >= PATH_REQUEST_MAX_ATTEMPTS {
            return PathRequestDecision::MaxAttempts;
        }
        if let Some(until) = self.backoff_until.get(&dest) {
            if now < *until {
                return PathRequestDecision::Backoff;
            }
        }
        PathRequestDecision::Send
    }

    fn record_send(&mut self, dest: [u8; 16], now: f64) {
        self.backoff_until
            .insert(dest, now + PATH_REQUEST_BACKOFF_SECS);
    }

    fn record_queue_failure(&mut self, dest: [u8; 16], now: f64) {
        *self.fail_count.entry(dest).or_insert(0) += 1;
        self.backoff_until
            .insert(dest, now + PATH_REQUEST_BACKOFF_SECS);
    }

    fn should_warn(&mut self, dest: [u8; 16], now: f64) -> bool {
        let last = self.last_warn_at.get(&dest).copied().unwrap_or(0.0);
        if now - last >= PATH_REQUEST_BACKOFF_SECS {
            self.last_warn_at.insert(dest, now);
            true
        } else {
            false
        }
    }
}

/// Cap on distinct message hashes retained in `pn_cascade_tried` (memory bound under
/// announce/outbound floods — eviction prefers keys not in pending deposit/target maps).
const PN_CASCADE_TRIED_MAX: usize = 256;
/// After this many sync/pending PN-link deferrals, advance to the next cascade PN so a
/// busy preferred PN cannot storm-defer the same deposit forever.
const PN_DEPOSIT_DEFER_ADVANCE_AFTER: u32 = 8;

/// Correlatable ids for an in-flight Propagated deposit (`pn_hash`, optional `transient_id`).
type PendingPnDeposit = ([u8; 16], Option<[u8; 32]>);
/// Validated PN stamp entry: (transient_id, lxmf_data, stamp_u8, stamp_data).
type ValidatedPnStamp = ([u8; 32], Vec<u8>, u8, [u8; 32]);

pub struct LxmfOutboundDriver {
    transport_tx: mpsc::Sender<TransportMessage>,
    link_delivery: LinkDeliveryManager,
    route_hops: HashMap<[u8; 16], u8>,
    known_identities: HashMap<String, [u8; 64]>,
    /// Dest hashes pinned for in-flight propagation sync (LRPROOF needs pubkey).
    /// Eviction must not remove these while Establishing.
    pinned_identities: HashMap<String, [u8; 64]>,
    path_table_hashes: HashSet<String>,
    /// Last known path interface name per destination (from GetPathTable).
    path_interfaces: HashMap<[u8; 16], String>,
    /// Last known next-hop via hash hex per destination.
    path_vias: HashMap<[u8; 16], String>,
    /// Local interface rows (config + live status) for Auto / private LAN policy.
    interfaces: Vec<InterfaceRow>,
    /// Until this unix time, treat Auto as delivery-degraded for private preempt
    /// (Auto status may still report "up" after a Direct failure on Auto).
    auto_delivery_degraded_until: f64,
    path_request_gate: PathRequestGate,
    /// Per-message PN hashes already tried in the Direct→Propagated cascade.
    pn_cascade_tried: HashMap<[u8; 32], HashSet<[u8; 16]>>,
    /// Message hashes whose current cascade step is a local-prop (offline) deposit.
    pn_cascade_local: HashSet<[u8; 32]>,
    /// Enabled PN candidates + preferred hash for cascade ordering.
    pn_cascade_candidates: Vec<PnCascadeCandidate>,
    preferred_pn_hash: Option<[u8; 16]>,
    /// Consecutive DeliverPropagated deferrals while PN link busy (per message).
    pn_deposit_defer_counts: HashMap<[u8; 32], u32>,
    /// Direct link failures still exhausting alternate path slots / ifaces.
    direct_path_failovers: HashMap<[u8; 32], DirectPathFailoverState>,
    /// When set, remote propagation sync holds a Link to this dest — do not race deposits.
    propagation_sync_target: Option<[u8; 16]>,
    /// In-flight Propagated deposits: message_hash → (pn_hash, transient_id).
    pending_pn_deposits: HashMap<[u8; 32], PendingPnDeposit>,
    /// Per-message PN target for the current cascade step (avoids retargeting the
    /// router-global `outbound_propagation_node` for concurrent sends).
    pending_pn_targets: HashMap<[u8; 32], [u8; 16]>,
    /// When local-prop is serving, cascade deposits go in-process (no self-Link).
    local_prop_node: Option<Arc<Mutex<PropagationNode>>>,
    /// Local LXMF identity (retained for driver construction / future failed-detail payloads).
    #[allow(dead_code)]
    self_lxmf_hash: String,
    #[allow(dead_code)]
    self_display_name: String,
}

impl LxmfOutboundDriver {
    #[allow(clippy::needless_pass_by_value)] // hash hex is cloned into driver state at construction
    pub fn new(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: &Identity,
        self_lxmf_hash: String,
        self_display_name: String,
    ) -> Self {
        let mut driver = Self {
            transport_tx: transport_tx.clone(),
            link_delivery: LinkDeliveryManager::new(
                transport_tx,
                Some(identity.get_public_key()),
                identity.get_signing_key(),
            ),
            route_hops: HashMap::new(),
            known_identities: HashMap::new(),
            pinned_identities: HashMap::new(),
            path_table_hashes: HashSet::new(),
            path_interfaces: HashMap::new(),
            path_vias: HashMap::new(),
            interfaces: Vec::new(),
            auto_delivery_degraded_until: 0.0,
            path_request_gate: PathRequestGate::new(),
            pn_cascade_tried: HashMap::new(),
            pn_cascade_local: HashSet::new(),
            pn_cascade_candidates: Vec::new(),
            preferred_pn_hash: None,
            pn_deposit_defer_counts: HashMap::new(),
            direct_path_failovers: HashMap::new(),
            propagation_sync_target: None,
            pending_pn_deposits: HashMap::new(),
            pending_pn_targets: HashMap::new(),
            local_prop_node: None,
            self_lxmf_hash: self_lxmf_hash.clone(),
            self_display_name,
        };
        driver.register_identity_key(&self_lxmf_hash, identity.get_public_key());
        driver
    }

    /// Forward inbound LXMF that arrives on outbound-initiated reusable Direct links.
    ///
    /// Without this, peers Ack on the backchannel (LinkProof) but the plaintext is
    /// dropped before `delivery_callback` — the classic “first reply Ack’d, second shows”
    /// Chat gap after a mesh-client Direct send.
    pub fn set_inbound_packet_sender(&mut self, tx: mpsc::UnboundedSender<(Vec<u8>, [u8; 16])>) {
        self.link_delivery.set_inbound_packet_sender(tx);
    }

    pub fn register_identity_key(&mut self, dest_hash_hex: &str, public_key: [u8; 64]) {
        let key = dest_hash_hex.to_lowercase();
        if !self.known_identities.contains_key(&key)
            && self.known_identities.len() >= MAX_KNOWN_IDENTITIES
        {
            // Evict an arbitrary unpinned entry to bound memory under announce floods.
            let evict = self
                .known_identities
                .keys()
                .find(|k| !self.pinned_identities.contains_key(k.as_str()))
                .cloned();
            if let Some(oldest) = evict {
                self.known_identities.remove(&oldest);
            }
        }
        self.known_identities.insert(key.clone(), public_key);
        if self.pinned_identities.contains_key(&key) {
            self.pinned_identities.insert(key, public_key);
        }
    }

    /// Pin a destination pubkey for the active propagation sync so announce-flood
    /// eviction cannot drop it before LRPROOF validation.
    pub fn pin_identity_for_propagation(&mut self, dest_hash_hex: &str, public_key: [u8; 64]) {
        let key = dest_hash_hex.to_lowercase();
        self.known_identities.insert(key.clone(), public_key);
        self.pinned_identities.insert(key, public_key);
    }

    pub fn clear_propagation_identity_pins(&mut self) {
        self.pinned_identities.clear();
    }

    /// Mark (or clear) the remote PN currently owned by an in-flight propagation sync.
    pub fn set_propagation_sync_target(&mut self, dest: Option<[u8; 16]>) {
        self.propagation_sync_target = dest;
    }

    /// Remote PN currently reserved for user Sync / deposit (blocks host peer-sync).
    pub fn propagation_sync_target(&self) -> Option<[u8; 16]> {
        self.propagation_sync_target
    }

    /// True when a packed deposit / Direct session already holds a Link to `dest`.
    pub fn has_inflight_delivery_to(&self, dest: &[u8; 16]) -> bool {
        self.link_delivery.has_pending_to(dest)
    }

    /// Wire (or clear) the in-process local PropagationNode for cascade Completes.
    ///
    /// When set, `pn_cascade_local` deposits call `accept_stamped_propagated_blob` directly
    /// instead of opening a self-Link (official PN parity: host store, not loopback Link).
    pub fn set_local_prop_node(&mut self, node: Option<Arc<Mutex<PropagationNode>>>) {
        self.local_prop_node = node;
    }

    pub fn known_identities_for_propagation(&self) -> HashMap<String, [u8; 64]> {
        let mut out = self.known_identities.clone();
        for (k, v) in &self.pinned_identities {
            out.insert(k.clone(), *v);
        }
        out
    }

    #[allow(clippy::unused_self)] // method slot mirrors other LxmfOutboundDriver mutators
    pub fn set_propagation_node(&mut self, router: &mut LxmRouter, hash: Option<[u8; 16]>) {
        self.preferred_pn_hash = hash;
        router.set_outbound_propagation_node(hash);
    }

    /// Refresh enabled PN candidates used after Direct path failover exhausts.
    pub fn set_pn_cascade_candidates(&mut self, candidates: Vec<PnCascadeCandidate>) {
        tracing::info!(
            target: "lxmf-outbound",
            count = candidates.len(),
            preferred = %self
                .preferred_pn_hash
                .map(hex::encode)
                .unwrap_or_else(|| "none".into()),
            "PN cascade candidates updated"
        );
        self.pn_cascade_candidates = candidates;
    }

    /// Refresh local path cache from transport GetPathTable rows.
    pub fn update_path_table(&mut self, entries: &[PathTableRoute]) {
        self.route_hops.clear();
        self.path_table_hashes.clear();
        self.path_interfaces.clear();
        self.path_vias.clear();
        for entry in entries {
            self.route_hops.insert(entry.hash, entry.hops.max(1));
            self.path_table_hashes.insert(entry.hex_key.to_lowercase());
            self.path_request_gate.clear_destination(entry.hash);
            if let Some(name) = entry
                .interface
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                self.path_interfaces.insert(entry.hash, name.to_string());
            }
            if let Some(via_hex) = entry
                .via
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                self.path_vias.insert(entry.hash, via_hex.to_string());
            }
        }
    }

    /// Refresh local interface rows used for Auto / private LAN Direct policy.
    pub fn update_interfaces(&mut self, interfaces: Vec<InterfaceRow>) {
        self.interfaces = interfaces;
    }

    /// Remove a single destination from the local path cache (e.g. after transport DropPath).
    pub fn clear_path_to(&mut self, destination_hex: &str) {
        let key = destination_hex.to_lowercase();
        self.path_table_hashes.remove(&key);
        if let Ok(dest) = parse_hash16(&key) {
            self.route_hops.remove(&dest);
            self.path_interfaces.remove(&dest);
            self.path_vias.remove(&dest);
            self.path_request_gate.clear_destination(dest);
        }
    }

    pub fn has_path_to(&self, destination_hex: &str) -> bool {
        self.path_table_hashes
            .contains(&destination_hex.to_lowercase())
    }

    pub fn identity_known_for(&self, destination_hex: &str) -> bool {
        let key = destination_hex.to_lowercase();
        self.pinned_identities.contains_key(&key) || self.known_identities.contains_key(&key)
    }

    pub fn public_key_for(&self, destination_hex: &str) -> Option<[u8; 64]> {
        let key = destination_hex.to_lowercase();
        self.pinned_identities
            .get(&key)
            .copied()
            .or_else(|| self.known_identities.get(&key).copied())
    }

    pub fn process_tick(&mut self, router: &mut LxmRouter, event_tx: &broadcast::Sender<String>) {
        let direct_inputs: HashMap<[u8; 16], DirectDeliveryPlanInput> = router
            .pending_outbound
            .iter()
            .map(|message| message.destination_hash)
            .collect::<HashSet<_>>()
            .into_iter()
            .map(|dest| {
                let dest_hex = hex::encode(dest);
                (
                    dest,
                    DirectDeliveryPlanInput {
                        // lxmd parity: path alone is not identity knowledge — LRPROOF needs
                        // the destination public key from known_identities.
                        identity_known: self
                            .known_identities
                            .contains_key(&dest_hex.to_lowercase()),
                        route: direct_route_snapshot(&self.route_hops, dest),
                        reusable_link: direct_reusable_link_state(&self.link_delivery, dest),
                    },
                )
            })
            .collect();

        self.ensure_router_pn_for_dispatch(router);
        let mut actions = router.process_outbound_with_direct(|message, _now| {
            direct_inputs
                .get(&message.destination_hash)
                .cloned()
                .unwrap_or(DirectDeliveryPlanInput {
                    identity_known: false,
                    route: None,
                    reusable_link: DirectReusableLinkState::None,
                })
        });
        self.apply_pending_pn_targets(&mut actions);

        if !actions.is_empty() {
            self.execute_actions(router, event_tx, actions);
        }

        router.run_jobs_tick();

        // Must drain before tick so LRPROOF/resources can verify against known_identities.
        self.link_delivery.drain_events(&self.known_identities);
        let results = self.link_delivery.tick();
        for result in results {
            self.handle_delivery_result(router, event_tx, result);
        }
    }

    fn execute_actions(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        actions: Vec<OutboundAction>,
    ) {
        for action in actions {
            match action {
                OutboundAction::DeliverPropagated { message, prop_hash } => {
                    self.deliver_propagated(router, event_tx, message, prop_hash);
                }
                OutboundAction::DeliverDirect { message, dest_hash } => {
                    self.deliver_direct(router, event_tx, message, dest_hash, None);
                }
                OutboundAction::PlanDirect {
                    message,
                    dest_hash,
                    plan,
                } => {
                    self.deliver_direct(router, event_tx, message, dest_hash, Some(plan));
                }
                OutboundAction::DeliverOpportunistic { message, dest_hash } => {
                    if let Ok(packed) = message.pack_payload() {
                        let _ = self.transport_tx.try_send(TransportMessage::Outbound(
                            rns_transport::messages::OutboundRequest {
                                raw: Bytes::from(packed),
                                destination_hash: dest_hash,
                            },
                        ));
                    }
                }
                OutboundAction::Failed(msg) | OutboundAction::Expired(msg) => {
                    tracing::warn!(
                        dest = %hex::encode(msg.destination_hash),
                        "LXMF outbound message failed or expired"
                    );
                    self.fail_outbound_message(router, event_tx, msg);
                }
            }
        }
    }

    fn deliver_propagated(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
        prop_hash: [u8; 16],
    ) {
        let prop_hex = hex::encode(prop_hash);
        let is_local_cascade = message
            .hash
            .or(message.message_id)
            .is_some_and(|h| self.pn_cascade_local.contains(&h));
        // In-process local PN deposit does not need the PN Link — skip busy deferral.
        let local_in_process = is_local_cascade && self.local_prop_node.is_some();
        // Avoid racing a second LinkRequest to the same PN (sync or another deposit).
        let sync_blocks = self.propagation_sync_target == Some(prop_hash);
        let pending_blocks = self.link_delivery.has_pending_to(&prop_hash);
        if !local_in_process && should_defer_propagated_for_pn_link(sync_blocks, pending_blocks) {
            if let Some(msg_hash) = message.hash.or(message.message_id) {
                let defer_count = self
                    .pn_deposit_defer_counts
                    .entry(msg_hash)
                    .and_modify(|c| *c = c.saturating_add(1))
                    .or_insert(1);
                if *defer_count >= PN_DEPOSIT_DEFER_ADVANCE_AFTER {
                    tracing::warn!(
                        target: "lxmf-outbound",
                        prop = %prop_hex,
                        dest = %hex::encode(message.destination_hash),
                        msg = %hex::encode(msg_hash),
                        defer_count = *defer_count,
                        sync_blocks,
                        pending_blocks,
                        "DeliverPropagated: PN link busy too long — advancing PN cascade"
                    );
                    self.pn_deposit_defer_counts.remove(&msg_hash);
                    self.mark_pn_tried(msg_hash, prop_hash);
                    match self.try_advance_pn_cascade(router, event_tx, message) {
                        Ok(()) => return,
                        Err(message) => {
                            self.emit_outbound_failed(router, event_tx, *message);
                            return;
                        }
                    }
                }
            }
            let now = now_f64();
            message.next_delivery_attempt = now + f64::from(PATH_REQUEST_WAIT as u32);
            tracing::debug!(
                target: "lxmf-outbound",
                prop = %prop_hex,
                dest = %hex::encode(message.destination_hash),
                sync_blocks,
                pending_blocks,
                attempts = message.delivery_attempts,
                "DeliverPropagated: deferring — PN link busy"
            );
            if let Some(hash) = message.hash.or(message.message_id) {
                self.pending_pn_targets.insert(hash, prop_hash);
                let method = self.cascade_wire_delivery_method(hash);
                emit_outbound_status_with_via(
                    event_tx,
                    Some(serde_json::Value::String(hex::encode(hash))),
                    None,
                    "sending",
                    Some(method),
                    Some(prop_hex.clone()),
                );
            }
            router.send(message);
            return;
        }
        if let Some(hash) = message.hash.or(message.message_id) {
            self.pn_deposit_defer_counts.remove(&hash);
            self.pending_pn_targets.insert(hash, prop_hash);
        }
        // Local-prop cascade uses lxmf.propagation dest (not self LXMF). In-process deposit
        // does not need the PN pubkey in known_identities (no Link). Link path still requires it.
        if !self.known_identities.contains_key(&prop_hex.to_lowercase()) {
            if local_in_process {
                // Fall through to pack + accept_stamped_propagated_blob.
            } else if is_local_cascade {
                tracing::warn!(
                    target: "lxmf-outbound",
                    prop = %prop_hex,
                    dest = %hex::encode(message.destination_hash),
                    "DeliverPropagated: local-prop identity unknown — advancing PN cascade"
                );
                if let Some(hash) = message.hash.or(message.message_id) {
                    self.mark_pn_tried(hash, prop_hash);
                }
                match self.try_advance_pn_cascade(router, event_tx, message) {
                    Ok(()) => return,
                    Err(message) => {
                        self.emit_outbound_failed(router, event_tx, *message);
                        return;
                    }
                }
            } else {
                tracing::debug!(
                    prop = %prop_hex,
                    dest = %hex::encode(message.destination_hash),
                    "DeliverPropagated: PN identity unknown — requesting path"
                );
                self.request_path_gated(
                    router,
                    event_tx,
                    prop_hash,
                    false,
                    "propagation node path",
                    message,
                    false,
                );
                return;
            }
        }
        // Hosted PN admit floor is min_stamp_cost (stamp_cost − flex). Pack at least that
        // when depositing in-process so accept_stamped_propagated_blob does not reject.
        // try_lock: never block outbound tick on a contended PropagationNode mutex.
        let target_cost = if local_in_process {
            let local_floor = self
                .local_prop_node
                .as_ref()
                .and_then(|n| n.try_lock().ok().map(|g| g.min_stamp_cost()))
                .unwrap_or(0);
            local_floor.max(router.get_stamp_cost(&prop_hash).unwrap_or(0))
        } else {
            router.get_stamp_cost(&prop_hash).unwrap_or(0)
        };
        let Some(packed) = self.pack_for_propagation(&mut message, prop_hash, target_cost) else {
            tracing::warn!(
                prop = %prop_hex,
                dest = %hex::encode(message.destination_hash),
                "DeliverPropagated: pack_for_propagation failed — advancing PN cascade"
            );
            if let Some(hash) = message.hash.or(message.message_id) {
                self.mark_pn_tried(hash, prop_hash);
            }
            match self.try_advance_pn_cascade(router, event_tx, message) {
                Ok(()) => return,
                Err(message) => {
                    self.emit_outbound_failed(router, event_tx, *message);
                    return;
                }
            }
        };
        // lxmd parity: count the attempt before packed link delivery so Failed can budget retries.
        let attempts = mark_propagated_delivery_attempt(&mut message);
        if attempts >= MAX_DELIVERY_ATTEMPTS {
            tracing::warn!(
                prop = %prop_hex,
                attempts,
                max_attempts = MAX_DELIVERY_ATTEMPTS,
                "propagated delivery attempt budget reached — advancing PN cascade"
            );
            if let Some(hash) = message.hash.or(message.message_id) {
                self.mark_pn_tried(hash, prop_hash);
            }
            match self.try_advance_pn_cascade(router, event_tx, message) {
                Ok(()) => return,
                Err(message) => {
                    self.emit_outbound_failed(router, event_tx, *message);
                    return;
                }
            }
        }
        let hops = route_hops_for(&self.route_hops, prop_hash);
        let message_hash_hex = message.hash.as_ref().map(hex::encode);
        let transient_id_hex = message.transient_id.as_ref().map(hex::encode);
        if let Some(hash) = message.hash {
            self.pending_pn_deposits
                .insert(hash, (prop_hash, message.transient_id));
        }
        // Local-prop cascade: deposit in-process (full hosted PN store) — avoid self-Link.
        if is_local_cascade
            && self.try_local_prop_in_process_deposit(
                router,
                event_tx,
                &mut message,
                prop_hash,
                &packed,
            )
        {
            return;
        }
        tracing::info!(
            target: "propagation-deposit",
            message_hash = message_hash_hex.as_deref().unwrap_or(""),
            transient_id = transient_id_hex.as_deref().unwrap_or(""),
            pn_hash = %prop_hex,
            dest = %hex::encode(message.destination_hash),
            hops,
            packed_len = packed.len(),
            attempts,
            "outbound PN deposit starting packed delivery"
        );
        if let Err(err) = self
            .link_delivery
            .start_packed_delivery(message, prop_hash, hops, packed, false)
        {
            if let Some(hash) = err.message.hash {
                self.pending_pn_deposits.remove(&hash);
            }
            let reason = err.error.to_string();
            tracing::warn!(
                prop = %prop_hex,
                error = %reason,
                "propagated link delivery start failed"
            );
            self.on_propagated_link_failure(router, event_tx, *err.message, prop_hash, &reason);
        }
    }

    /// Accept a packed propagation wrapper into the local hosted PN without LinkDelivery.
    ///
    /// Returns true when the deposit Completes (or failed terminal after accept miss).
    fn try_local_prop_in_process_deposit(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        message: &mut LxMessage,
        prop_hash: [u8; 16],
        packed: &[u8],
    ) -> bool {
        let Some(node) = self.local_prop_node.clone() else {
            return false;
        };
        let prop_hex = hex::encode(prop_hash);
        let Ok((_, entries)) = LxMessage::unpack_propagation_wrapper(packed) else {
            tracing::warn!(
                target: "propagation-deposit",
                pn_hash = %prop_hex,
                "local-prop in-process deposit: unpack wrapper failed — falling back to Link"
            );
            return false;
        };
        let Some(hash) = message.hash.or(message.message_id) else {
            // Without a hash we cannot emit Completes — fall back to Link so
            // requeue/status paths can run (do not accept into the store first).
            tracing::warn!(
                target: "propagation-deposit",
                pn_hash = %prop_hex,
                "local-prop in-process deposit missing message hash"
            );
            return false;
        };
        // Validate outside the node mutex (PoW/stamp work must not hold PropagationNode).
        // min_cost 0: stamp already generated against the PN cost at pack time.
        let mut validated: Vec<ValidatedPnStamp> = Vec::new();
        for entry in &entries {
            let Some((transient_id, lxmf_data, stamp_value, stamp_data)) =
                stamper::validate_pn_stamp(entry, 0)
            else {
                continue;
            };
            let stamp_u8 = u8::try_from(stamp_value).unwrap_or(u8::MAX);
            validated.push((transient_id, lxmf_data, stamp_u8, stamp_data));
        }
        let mut accepted = 0usize;
        let mut last_tid: Option<[u8; 32]> = None;
        {
            let Ok(mut guard) = node.try_lock() else {
                return false;
            };
            for (transient_id, lxmf_data, stamp_u8, stamp_data) in &validated {
                if guard.accept_stamped_propagated_blob(lxmf_data, stamp_data, *stamp_u8) {
                    accepted += 1;
                    last_tid = Some(*transient_id);
                    tracing::info!(
                        target: "propagation-deposit",
                        pn_hash = %prop_hex,
                        transient_id = %hex::encode(transient_id),
                        stamp_value = stamp_u8,
                        blob_len = lxmf_data.len(),
                        "local PN accepted in-process cascade deposit"
                    );
                }
            }
        }
        if accepted == 0 {
            tracing::warn!(
                target: "propagation-deposit",
                pn_hash = %prop_hex,
                entries = entries.len(),
                "local-prop in-process deposit accepted zero entries — falling back to Link"
            );
            return false;
        }
        self.pending_pn_deposits
            .insert(hash, (prop_hash, last_tid.or(message.transient_id)));
        self.handle_delivery_result(
            router,
            event_tx,
            DeliveryResult::Complete {
                link_id: prop_hash,
                msg_hash: Some(hash),
            },
        );
        true
    }

    /// After a Propagated Link failure: advance cascade when other PNs remain; otherwise
    /// requeue the same PN for path rediscovery while attempts remain.
    fn on_propagated_link_failure(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        message: LxMessage,
        prop_hash: [u8; 16],
        reason: &str,
    ) {
        let msg_hash = message.hash.or(message.message_id);
        if let Some(hash) = msg_hash {
            self.mark_pn_tried(hash, prop_hash);
            self.pending_pn_deposits.remove(&hash);
        }
        let ordered = self.ordered_pn_cascade();
        let tried = msg_hash
            .and_then(|h| self.pn_cascade_tried.get(&h).cloned())
            .unwrap_or_default();
        // Prefer advancing to the next PN over hammering the same Prefer hash with
        // link-establishment timeouts (observed with thunderhost / deadbeef).
        if cascade_has_capacity(&ordered, &tried) {
            tracing::info!(
                target: "lxmf-outbound",
                prop = %hex::encode(prop_hash),
                reason,
                tried = tried.len(),
                candidates = ordered.len(),
                "Propagated link failure — advancing PN cascade (other candidates remain)"
            );
            match self.try_advance_pn_cascade(router, event_tx, message) {
                Ok(()) => {}
                Err(message) => self.emit_outbound_failed(router, event_tx, *message),
            }
            return;
        }
        if should_retry_propagated_link_failure(message.method, reason, message.delivery_attempts) {
            self.requeue_propagated_after_link_failure(
                router, event_tx, message, prop_hash, reason,
            );
            return;
        }
        match self.try_advance_pn_cascade(router, event_tx, message) {
            Ok(()) => {}
            Err(message) => self.emit_outbound_failed(router, event_tx, *message),
        }
    }

    fn deliver_direct(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
        dest_hash: [u8; 16],
        planned: Option<DirectDeliveryPlan>,
    ) {
        let dest_hex = hex::encode(dest_hash);
        // Capture ownership before consuming `planned` (lxmd `router_owned` parity).
        let router_owned = planned.is_some();
        let plan = planned.unwrap_or_else(|| {
            plan_direct_delivery(
                &mut message,
                DirectDeliveryPlanInput {
                    identity_known: self.known_identities.contains_key(&dest_hex.to_lowercase()),
                    route: direct_route_snapshot(&self.route_hops, dest_hash),
                    reusable_link: direct_reusable_link_state(&self.link_delivery, dest_hash),
                },
                now_f64(),
            )
        });

        // `router_owned` ⇒ message still sits in `pending_outbound`
        // (`process_outbound_with_direct`). Must not `router.send` again or we
        // fork-bomb duplicates and fill the transport channel while waiting for LRPROOF.
        match plan {
            DirectDeliveryPlan::WaitForReusableLink => {
                if !router_owned {
                    router.send(message);
                }
            }
            DirectDeliveryPlan::RequestPath { drop_existing } => {
                self.request_path_gated(
                    router,
                    event_tx,
                    dest_hash,
                    drop_existing,
                    "direct delivery path",
                    message,
                    router_owned,
                );
            }
            DirectDeliveryPlan::DeferTerminalFailure | DirectDeliveryPlan::Fail => {
                self.fail_outbound_message(router, event_tx, message);
            }
            DirectDeliveryPlan::UseReusableLink | DirectDeliveryPlan::StartNewLink { .. } => {
                // Unhealthy Auto + live private hub → suppress Auto before opening Direct.
                if matches!(plan, DirectDeliveryPlan::StartNewLink { .. })
                    && self.maybe_preempt_unhealthy_auto_path(dest_hash)
                {
                    if !router_owned {
                        let now = now_f64();
                        message.method = DeliveryMethod::Direct;
                        message.last_delivery_attempt = now;
                        message.next_delivery_attempt = now + f64::from(PATH_REQUEST_WAIT as u32);
                        router.send(message);
                    }
                    // router_owned: message remains in pending_outbound; cleared path
                    // forces RequestPath on the next tick after Auto suppress.
                    return;
                }
                let hops = match plan {
                    DirectDeliveryPlan::StartNewLink { hops } => hops,
                    _ => route_hops_for(&self.route_hops, dest_hash),
                };
                if let Err(err) = self
                    .link_delivery
                    .start_delivery_with_report(message, dest_hash, hops)
                {
                    tracing::warn!(
                        dest = %dest_hex,
                        error = %err.error,
                        "direct link delivery start failed"
                    );
                    router.send(*err.message);
                }
            }
        }
    }

    /// When Auto is active but unhealthy and a private LAN hub is live, suppress
    /// Auto and RequestPath so Direct can use the private path.
    fn maybe_preempt_unhealthy_auto_path(&mut self, dest_hash: [u8; 16]) -> bool {
        let active = self.path_interfaces.get(&dest_hash).cloned();
        let delivery_degraded = now_f64() < self.auto_delivery_degraded_until;
        if !should_preempt_auto_for_private_direct(
            active.as_deref(),
            &[],
            &self.interfaces,
            delivery_degraded,
        ) {
            return false;
        }
        let blocked: Vec<String> = active.iter().cloned().collect();
        let prefer = prefer_ifaces_for_failover(&self.interfaces, &blocked, true);
        tracing::info!(
            dest = %hex::encode(dest_hash),
            active = ?active,
            prefer = ?prefer,
            delivery_degraded,
            "AutoInterface unhealthy for delivery; suppressing Auto toward private LAN path"
        );
        queue_path_failover_queries(
            &self.transport_tx,
            dest_hash,
            &[],
            &prefer,
            "auto unhealthy private preempt",
        );
        self.clear_path_to(&hex::encode(dest_hash));
        true
    }

    #[allow(clippy::too_many_arguments)] // path-gate + router ownership split is intentional
    fn request_path_gated(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        request_hash: [u8; 16],
        drop_existing: bool,
        reason: &str,
        message: LxMessage,
        router_owned: bool,
    ) {
        let now = now_f64();
        match self.path_request_gate.decide(request_hash, now) {
            PathRequestDecision::Send => {
                if try_queue_path_request(&self.transport_tx, request_hash, drop_existing, reason) {
                    self.path_request_gate.record_send(request_hash, now);
                    if !router_owned {
                        router.send(message);
                    }
                } else {
                    self.path_request_gate
                        .record_queue_failure(request_hash, now);
                    if self.path_request_gate.should_warn(request_hash, now) {
                        tracing::warn!(
                            dest = %hex::encode(request_hash),
                            reason,
                            "failed to queue path request for LXMF delivery (transport channel full)"
                        );
                    }
                    if !router_owned {
                        router.send(message);
                    }
                }
            }
            PathRequestDecision::Backoff => {
                if !router_owned {
                    router.send(message);
                }
            }
            PathRequestDecision::MaxAttempts => {
                tracing::warn!(
                    dest = %hex::encode(request_hash),
                    reason,
                    "LXMF path request budget exhausted; marking outbound failed"
                );
                self.fail_outbound_message(router, event_tx, message);
            }
        }
    }

    fn fail_outbound_message(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        message: LxMessage,
    ) {
        match self.try_advance_pn_cascade(router, event_tx, message) {
            Ok(()) => {}
            Err(message) => self.emit_outbound_failed(router, event_tx, *message),
        }
    }

    fn emit_outbound_failed(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
    ) {
        message.mark_failed();
        let method = message
            .hash
            .or(message.message_id)
            .map(|h| self.cascade_wire_delivery_method(h))
            .unwrap_or_else(|| delivery_method_label(message.method));
        tracing::warn!(
            target: "lxmf-outbound",
            dest = %hex::encode(message.destination_hash),
            method,
            attempts = message.delivery_attempts,
            "LXMF outbound delivery failed"
        );
        if let Some(hash) = message.hash.or(message.message_id) {
            let attempts = message.delivery_attempts;
            self.clear_pn_cascade_state(hash);
            self.direct_path_failovers.remove(&hash);
            self.pending_pn_deposits.remove(&hash);
            let _ = router.mark_outbound_failed(&hash);
            emit_outbound_status_detailed_with_attempts(
                event_tx,
                Some(serde_json::Value::String(hex::encode(hash))),
                None,
                "failed",
                Some(method),
                None,
                None,
                None,
                Some(attempts),
            );
        }
    }

    fn ordered_pn_cascade(&self) -> Vec<PnCascadeCandidate> {
        build_pn_cascade_order(&self.pn_cascade_candidates, self.preferred_pn_hash)
    }

    fn mark_pn_tried(&mut self, msg_hash: [u8; 32], pn_hash: [u8; 16]) {
        if self.pn_cascade_tried.len() >= PN_CASCADE_TRIED_MAX
            && !self.pn_cascade_tried.contains_key(&msg_hash)
        {
            let victim = self
                .pn_cascade_tried
                .keys()
                .find(|k| {
                    !self.pending_pn_targets.contains_key(*k)
                        && !self.pending_pn_deposits.contains_key(*k)
                })
                .copied()
                .or_else(|| self.pn_cascade_tried.keys().next().copied());
            if let Some(oldest) = victim {
                self.pn_cascade_tried.remove(&oldest);
                self.pn_cascade_local.remove(&oldest);
                self.pending_pn_targets.remove(&oldest);
                self.pn_deposit_defer_counts.remove(&oldest);
            }
        }
        self.pn_cascade_tried
            .entry(msg_hash)
            .or_default()
            .insert(pn_hash);
    }

    fn clear_pn_cascade_state(&mut self, msg_hash: [u8; 32]) {
        self.pn_cascade_tried.remove(&msg_hash);
        self.pn_cascade_local.remove(&msg_hash);
        self.pn_deposit_defer_counts.remove(&msg_hash);
        self.pending_pn_targets.remove(&msg_hash);
    }

    fn cascade_wire_delivery_method(&self, msg_hash: [u8; 32]) -> &'static str {
        if self.pn_cascade_local.contains(&msg_hash) {
            "stored_locally"
        } else {
            "propagated"
        }
    }

    /// Ensure the router has *some* outbound PN so Propagated dispatch can emit actions.
    /// Does not retarget an already-set global — per-message targets use `pending_pn_targets`.
    fn ensure_router_pn_for_dispatch(&self, router: &mut LxmRouter) {
        if router.outbound_propagation_node.is_some() {
            return;
        }
        if let Some(preferred) = self.preferred_pn_hash {
            router.set_outbound_propagation_node(Some(preferred));
            return;
        }
        if let Some(first) = self.ordered_pn_cascade().first().map(|c| c.hash) {
            router.set_outbound_propagation_node(Some(first));
        }
    }

    /// Rewrite `DeliverPropagated.prop_hash` from the per-message cascade target map.
    fn apply_pending_pn_targets(&self, actions: &mut [OutboundAction]) {
        for action in actions.iter_mut() {
            if let OutboundAction::DeliverPropagated { message, prop_hash } = action {
                if let Some(hash) = message.hash.or(message.message_id) {
                    if let Some(target) = self.pending_pn_targets.get(&hash) {
                        *prop_hash = *target;
                    }
                }
            }
        }
    }

    /// Advance Direct→Propagated cascade: preferred remote → other remotes → local-prop.
    /// Returns `Ok(())` when re-queued; `Err(message)` when cascade is exhausted.
    fn try_advance_pn_cascade(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
    ) -> Result<(), Box<LxMessage>> {
        let Some(msg_hash) = message.hash.or(message.message_id) else {
            return Err(Box::new(message));
        };
        // Direct may enter cascade; Propagated advances to the next PN after a deposit fail.
        if message.method != DeliveryMethod::Direct && message.method != DeliveryMethod::Propagated
        {
            return Err(Box::new(message));
        }
        let ordered = self.ordered_pn_cascade();
        let tried = self
            .pn_cascade_tried
            .get(&msg_hash)
            .cloned()
            .unwrap_or_default();
        if !cascade_has_capacity(&ordered, &tried) {
            tracing::warn!(
                target: "lxmf-outbound",
                dest = %hex::encode(message.destination_hash),
                msg = %hex::encode(msg_hash),
                tried = tried.len(),
                candidates = ordered.len(),
                "PN cascade exhausted — marking outbound failed"
            );
            return Err(Box::new(message));
        }
        let pick = pick_next_pn_cascade(&ordered, &tried);
        let Some(pn_hash) = pick.hash() else {
            return Err(Box::new(message));
        };
        let method_label = pick.delivery_method_label().unwrap_or("propagated");
        router
            .pending_outbound
            .retain(|m| m.hash != Some(msg_hash) && m.message_id != Some(msg_hash));
        self.mark_pn_tried(msg_hash, pn_hash);
        self.direct_path_failovers.remove(&msg_hash);
        self.pn_deposit_defer_counts.remove(&msg_hash);
        if pick.is_local() {
            self.pn_cascade_local.insert(msg_hash);
        } else {
            self.pn_cascade_local.remove(&msg_hash);
        }
        self.pending_pn_targets.insert(msg_hash, pn_hash);
        self.ensure_router_pn_for_dispatch(router);
        message.method = DeliveryMethod::Propagated;
        message.delivery_attempts = 0;
        message.next_delivery_attempt = 0.0;
        tracing::info!(
            target: "lxmf-outbound",
            dest = %hex::encode(message.destination_hash),
            msg = %hex::encode(msg_hash),
            pn = %hex::encode(pn_hash),
            cascade_step = method_label,
            is_local = pick.is_local(),
            "LXMF advancing PN cascade"
        );
        router.send(message);
        emit_outbound_status_with_via(
            event_tx,
            Some(serde_json::Value::String(hex::encode(msg_hash))),
            None,
            "sending",
            Some(method_label),
            Some(hex::encode(pn_hash)),
        );
        Ok(())
    }

    fn pack_for_propagation(
        &self,
        message: &mut LxMessage,
        prop_hash: [u8; 16],
        target_cost: u8,
    ) -> Option<Vec<u8>> {
        let dest_hex = hex::encode(message.destination_hash);
        // lxmd parity: stamp against the *propagation node* cost, not the DM peer.
        let (packed, _, stamp_value) = message
            .pack_propagated_encrypted_with_stamp(
                |plaintext| {
                    self.encrypt_for_destination(&dest_hex, plaintext)
                        .ok_or_else(|| {
                            lxmf_core::message::MessageError::PackFailed(format!(
                                "no identity key for destination {dest_hex}"
                            ))
                        })
                },
                target_cost,
            )
            .ok()?;
        tracing::debug!(
            dest = %dest_hex,
            prop = %hex::encode(prop_hash),
            target_cost,
            stamp_value,
            packed_len = packed.len(),
            "prepared propagation wrapper"
        );
        Some(packed)
    }

    /// Encrypt plaintext to a known peer destination identity (Direct/PN/paper).
    pub fn encrypt_for_destination(
        &self,
        dest_hash_hex: &str,
        plaintext: &[u8],
    ) -> Option<Vec<u8>> {
        let pub_key = self.public_key_for(dest_hash_hex)?;
        let remote = Identity::from_public_key(&pub_key).ok()?;
        remote.encrypt(plaintext, None).ok()
    }

    fn handle_delivery_result(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        result: DeliveryResult,
    ) {
        match result {
            DeliveryResult::Complete { msg_hash, .. } => {
                if let Some(hash) = msg_hash {
                    let was_local = self.pn_cascade_local.contains(&hash);
                    let pending_deposit = self.pending_pn_deposits.remove(&hash);
                    let was_cascade = self.pn_cascade_tried.contains_key(&hash);
                    let method = if was_local {
                        Some("stored_locally")
                    } else if was_cascade || pending_deposit.is_some() {
                        Some("propagated")
                    } else {
                        None
                    };
                    self.clear_pn_cascade_state(hash);
                    self.direct_path_failovers.remove(&hash);
                    let _ = router.mark_outbound_delivered(&hash);
                    if let Some((pn_hash, transient_id)) = pending_deposit {
                        // cascade_step disambiguates which island the deposit landed on:
                        // local inbox, a cascade fallback remote, or the first/preferred remote.
                        let cascade_step = if was_local {
                            "local"
                        } else if was_cascade {
                            "cascade_remote"
                        } else {
                            "preferred_remote"
                        };
                        tracing::info!(
                            target: "propagation-deposit",
                            message_hash = %hex::encode(hash),
                            transient_id = %transient_id
                                .as_ref()
                                .map(hex::encode)
                                .unwrap_or_default(),
                            pn_hash = %hex::encode(pn_hash),
                            stored_locally = was_local,
                            cascade_step,
                            delivery_method = method.unwrap_or("unknown"),
                            "outbound PN deposit Completes"
                        );
                    }
                    // Local-prop Completes as hosted PN deposit (peer sync may still propagate).
                    let status = if was_local {
                        "stored_locally"
                    } else {
                        "delivered"
                    };
                    emit_outbound_status_by_hash(event_tx, &hash, status, method);
                }
            }
            DeliveryResult::Rejected {
                message, reason, ..
            } => {
                let msg_hash = message.hash.or(message.message_id);
                let rejected_pn = msg_hash.and_then(|h| {
                    self.pending_pn_deposits
                        .remove(&h)
                        .map(|(pn, _)| pn)
                        .or_else(|| self.pending_pn_targets.get(&h).copied())
                });
                tracing::warn!(
                    dest = %hex::encode(message.destination_hash),
                    method = %delivery_method_label(message.method),
                    reason = %reason,
                    "LXMF delivery Rejected"
                );
                // Peer/PN rejected — advance cascade (next remote or local-prop).
                if message.method == DeliveryMethod::Propagated {
                    if let (Some(hash), Some(pn)) = (msg_hash, rejected_pn) {
                        self.mark_pn_tried(hash, pn);
                    }
                }
                match self.try_advance_pn_cascade(router, event_tx, message) {
                    Ok(()) => {}
                    Err(message) => self.emit_outbound_failed(router, event_tx, *message),
                }
            }
            DeliveryResult::Failed {
                message,
                reason,
                dest_hash,
                ..
            } => {
                if let Some(hash) = message.hash {
                    self.pending_pn_deposits.remove(&hash);
                }
                tracing::warn!(
                    dest = %hex::encode(message.destination_hash),
                    link_dest = %hex::encode(dest_hash),
                    method = %delivery_method_label(message.method),
                    reason = %reason,
                    attempts = message.delivery_attempts,
                    "LXMF delivery Failed"
                );
                // Exhaust alternate path slots / live ifaces before Direct→PN fallback.
                let message = if message.method == DeliveryMethod::Direct
                    && is_retryable_link_delivery_failure(&reason)
                {
                    match self.requeue_direct_after_path_failover(
                        router, event_tx, message, dest_hash, &reason,
                    ) {
                        Ok(()) => return,
                        Err(message) => *message,
                    }
                } else {
                    message
                };
                // Propagated: advance cascade when other PNs remain; requeue only as last resort.
                if message.method == DeliveryMethod::Propagated {
                    self.on_propagated_link_failure(router, event_tx, message, dest_hash, &reason);
                    return;
                }
                match self.try_advance_pn_cascade(router, event_tx, message) {
                    Ok(()) => {}
                    Err(message) => self.emit_outbound_failed(router, event_tx, *message),
                }
            }
        }
    }

    /// Suppress the dead iface/via, RequestPath, and re-queue Direct while failover
    /// budget remains. `Ok(())` = re-queued; `Err(message)` = fall through to PN fallback.
    fn requeue_direct_after_path_failover(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
        dest_hash: [u8; 16],
        reason: &str,
    ) -> Result<(), Box<LxMessage>> {
        let Some(msg_hash) = message.hash.or(message.message_id) else {
            return Err(Box::new(message));
        };
        let iface = self.path_interfaces.get(&dest_hash).cloned();
        let via = self.path_vias.get(&dest_hash).cloned();
        let failover = {
            let state = self.direct_path_failovers.entry(msg_hash).or_default();
            if should_retry_direct_path_failover(state.rounds) {
                push_tried_iface(&mut state.tried_interfaces, iface.as_deref());
                if let Some(via_hex) = via.clone() {
                    if !state
                        .blocked_vias
                        .iter()
                        .any(|b| b.eq_ignore_ascii_case(&via_hex))
                    {
                        state.blocked_vias.push(via_hex);
                    }
                }
                state.rounds = state.rounds.saturating_add(1);
                Ok((
                    state.rounds,
                    state.tried_interfaces.clone(),
                    state.blocked_vias.clone(),
                ))
            } else {
                Err((state.rounds, state.tried_interfaces.clone()))
            }
        };
        let (rounds, tried, vias_to_drop) = match failover {
            Ok(v) => v,
            Err((rounds, tried)) => {
                tracing::info!(
                    dest = %hex::encode(dest_hash),
                    msg = %hex::encode(msg_hash),
                    rounds,
                    tried = ?tried,
                    reason,
                    "Direct path failover exhausted; allowing preferred-PN fallback"
                );
                self.direct_path_failovers.remove(&msg_hash);
                return Err(Box::new(message));
            }
        };
        let prefer_private =
            should_prefer_private_after_auto_failure(iface.as_deref(), &self.interfaces);
        if prefer_private {
            self.auto_delivery_degraded_until = now_f64() + IFACE_SUPPRESS_SECS;
        }
        let prefer = prefer_ifaces_for_failover(&self.interfaces, &tried, prefer_private);
        queue_path_failover_queries(
            &self.transport_tx,
            dest_hash,
            &vias_to_drop,
            &prefer,
            reason,
        );
        self.clear_path_to(&hex::encode(dest_hash));

        let now = now_f64();
        message.method = DeliveryMethod::Direct;
        message.last_delivery_attempt = now;
        message.next_delivery_attempt = now + f64::from(PATH_REQUEST_WAIT as u32);
        tracing::info!(
            dest = %hex::encode(dest_hash),
            msg = %hex::encode(msg_hash),
            rounds,
            tried = ?tried,
            prefer_private,
            prefer = ?prefer,
            reason,
            "Direct path failover: suppress/drop via + RequestPath; re-queuing Direct"
        );
        let sent_via = iface.as_deref().map(classify_interface).map(str::to_string);
        emit_outbound_status_detailed(
            event_tx,
            Some(serde_json::Value::String(hex::encode(msg_hash))),
            Some(serde_json::Value::String(hex::encode(dest_hash))),
            "sending",
            Some("direct"),
            sent_via,
            Some(tried),
            Some(rounds),
        );
        router.send(message);
        Ok(())
    }

    /// Re-queue a Propagated deposit after a retryable link failure (lxmd parity).
    fn requeue_propagated_after_link_failure(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
        prop_hash: [u8; 16],
        reason: &str,
    ) {
        let now = now_f64();
        message.method = DeliveryMethod::Propagated;
        message.last_delivery_attempt = now;
        message.next_delivery_attempt = now + f64::from(PATH_REQUEST_WAIT as u32);
        let _ = try_queue_path_request(&self.transport_tx, prop_hash, false, reason);
        let msg_hash = message.hash.or(message.message_id);
        tracing::warn!(
            dest = %hex::encode(message.destination_hash),
            prop = %hex::encode(prop_hash),
            msg = %msg_hash.map(hex::encode).unwrap_or_else(|| "none".into()),
            attempts = message.delivery_attempts,
            reason,
            "re-queuing Propagated LXMF after retryable link failure"
        );
        if let Some(hash) = msg_hash {
            self.pending_pn_targets.insert(hash, prop_hash);
            // Keep chat UI in sending/propagated while PN rediscovery proceeds.
            emit_outbound_status_with_via(
                event_tx,
                Some(serde_json::Value::String(hex::encode(hash))),
                None,
                "sending",
                Some(self.cascade_wire_delivery_method(hash)),
                Some(hex::encode(prop_hash)),
            );
        }
        router.send(message);
    }
}

fn delivery_method_label(method: DeliveryMethod) -> &'static str {
    match method {
        DeliveryMethod::Direct => "direct",
        DeliveryMethod::Propagated => "propagated",
        DeliveryMethod::Opportunistic => "opportunistic",
        DeliveryMethod::Paper => "paper",
    }
}

fn mark_propagated_delivery_attempt(message: &mut LxMessage) -> u32 {
    let now = now_f64();
    message.delivery_attempts += 1;
    message.last_delivery_attempt = now;
    message.next_delivery_attempt = now + f64::from(DELIVERY_RETRY_WAIT as u32);
    message.delivery_attempts
}

/// Whether a Propagated link `Failed` should requeue instead of going terminal.
pub(crate) fn should_retry_propagated_link_failure(
    method: DeliveryMethod,
    reason: &str,
    delivery_attempts: u32,
) -> bool {
    method == DeliveryMethod::Propagated
        && is_retryable_link_delivery_failure(reason)
        && delivery_attempts <= MAX_DELIVERY_ATTEMPTS
}

/// Defer starting a packed PN deposit when sync or another delivery owns that dest Link.
pub(crate) fn should_defer_propagated_for_pn_link(sync_blocks: bool, pending_blocks: bool) -> bool {
    sync_blocks || pending_blocks
}

/// Decide Direct vs Propagated for an LXMF send (path/pubkey/PN).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LxmfSendRoute {
    Direct,
    Propagated,
    NoPropagationNode,
}

pub(crate) fn choose_lxmf_send_route(
    has_path: bool,
    identity_known: bool,
    preferred_pn_set: bool,
) -> LxmfSendRoute {
    if has_path && identity_known {
        LxmfSendRoute::Direct
    } else if preferred_pn_set {
        LxmfSendRoute::Propagated
    } else if has_path {
        // Path known but pubkey still missing — keep trying Direct / LRPROOF.
        LxmfSendRoute::Direct
    } else {
        LxmfSendRoute::NoPropagationNode
    }
}

/// Cap on retained destination public keys (announce / path flood bound).
const MAX_KNOWN_IDENTITIES: usize = 4096;

/// Convenience wrapper around [`emit_outbound_status_with_via`] (hash/to/sent_via from payload).
#[allow(dead_code)] // kept for callers that already hold a full lxmf_message payload
pub fn emit_outbound_status(
    event_tx: &broadcast::Sender<String>,
    message_payload: &serde_json::Value,
    status: &str,
    delivery_method: &str,
) {
    emit_outbound_status_with_via(
        event_tx,
        message_payload.get("message_hash").cloned(),
        message_payload.get("to_hash").cloned(),
        status,
        Some(delivery_method),
        message_payload
            .get("sent_via")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    );
}

pub fn emit_outbound_status_with_via(
    event_tx: &broadcast::Sender<String>,
    message_hash: Option<serde_json::Value>,
    to_hash: Option<serde_json::Value>,
    status: &str,
    delivery_method: Option<&str>,
    sent_via: Option<String>,
) {
    emit_outbound_status_detailed(
        event_tx,
        message_hash,
        to_hash,
        status,
        delivery_method,
        sent_via,
        None,
        None,
    );
}

#[allow(clippy::too_many_arguments)] // status frame fields travel together
fn emit_outbound_status_detailed(
    event_tx: &broadcast::Sender<String>,
    message_hash: Option<serde_json::Value>,
    to_hash: Option<serde_json::Value>,
    status: &str,
    delivery_method: Option<&str>,
    sent_via: Option<String>,
    tried_interfaces: Option<Vec<String>>,
    failover_rounds: Option<u8>,
) {
    emit_outbound_status_detailed_with_attempts(
        event_tx,
        message_hash,
        to_hash,
        status,
        delivery_method,
        sent_via,
        tried_interfaces,
        failover_rounds,
        None,
    );
}

#[allow(clippy::too_many_arguments)] // status frame fields travel together
fn emit_outbound_status_detailed_with_attempts(
    event_tx: &broadcast::Sender<String>,
    message_hash: Option<serde_json::Value>,
    to_hash: Option<serde_json::Value>,
    status: &str,
    delivery_method: Option<&str>,
    sent_via: Option<String>,
    tried_interfaces: Option<Vec<String>>,
    failover_rounds: Option<u8>,
    delivery_attempts: Option<u32>,
) {
    let mut payload = serde_json::Map::new();
    if let Some(h) = message_hash {
        payload.insert("message_hash".into(), h);
    }
    if let Some(t) = to_hash {
        payload.insert("to_hash".into(), t);
    }
    payload.insert("status".into(), serde_json::Value::String(status.into()));
    if let Some(method) = delivery_method {
        payload.insert(
            "delivery_method".into(),
            serde_json::Value::String(method.into()),
        );
    }
    if let Some(via) = sent_via {
        payload.insert("sent_via".into(), serde_json::Value::String(via));
    }
    if let Some(ifaces) = tried_interfaces.filter(|v| !v.is_empty()) {
        payload.insert("tried_interfaces".into(), serde_json::json!(ifaces));
    }
    if let Some(rounds) = failover_rounds {
        payload.insert("failover_rounds".into(), serde_json::json!(rounds));
    }
    if let Some(attempts) = delivery_attempts {
        payload.insert("delivery_attempts".into(), serde_json::json!(attempts));
    }
    let frame = serde_json::json!({
        "type": "lxmf_outbound_status",
        "payload": payload,
    });
    let _ = event_tx.send(frame.to_string());
}

fn emit_outbound_status_by_hash(
    event_tx: &broadcast::Sender<String>,
    hash: &[u8; 32],
    status: &str,
    delivery_method: Option<&str>,
) {
    emit_outbound_status_with_via(
        event_tx,
        Some(serde_json::Value::String(hex::encode(hash))),
        None,
        status,
        delivery_method,
        None,
    );
}

/// Emit an egress evidence upgrade without changing delivery status.
pub fn emit_outbound_egress_via(
    event_tx: &broadcast::Sender<String>,
    message_hash: &str,
    to_hash: Option<&str>,
    sent_via: &str,
) {
    emit_outbound_status_with_via(
        event_tx,
        Some(serde_json::Value::String(message_hash.into())),
        to_hash.map(|h| serde_json::Value::String(h.into())),
        "sending",
        None,
        Some(sent_via.into()),
    );
}

fn route_hops_for(route_hops: &HashMap<[u8; 16], u8>, dest_hash: [u8; 16]) -> u8 {
    route_hops.get(&dest_hash).copied().unwrap_or(1).max(1)
}

fn direct_route_snapshot(
    route_hops: &HashMap<[u8; 16], u8>,
    dest_hash: [u8; 16],
) -> Option<DirectRouteSnapshot> {
    route_hops
        .get(&dest_hash)
        .copied()
        .map(|hops| DirectRouteSnapshot::new(dest_hash, hops))
}

fn direct_reusable_link_state(
    link_delivery: &LinkDeliveryManager,
    dest_hash: [u8; 16],
) -> DirectReusableLinkState {
    if let Some(snapshot) = link_delivery.direct_link_snapshot(dest_hash) {
        return match snapshot.delivery_state {
            lxmf_core::link_delivery::DeliveryState::Idle => DirectReusableLinkState::Active,
            lxmf_core::link_delivery::DeliveryState::Failed => {
                DirectReusableLinkState::Closed { activated: false }
            }
            _ => DirectReusableLinkState::Pending,
        };
    }
    if let Some(snapshot) = link_delivery.backchannel_link_snapshot(dest_hash) {
        if snapshot.queued_deliveries > 0 || snapshot.in_flight_deliveries > 0 {
            DirectReusableLinkState::Pending
        } else {
            DirectReusableLinkState::Active
        }
    } else {
        DirectReusableLinkState::None
    }
}

fn try_queue_path_request(
    transport_tx: &mpsc::Sender<TransportMessage>,
    request_hash: [u8; 16],
    drop_existing: bool,
    reason: &str,
) -> bool {
    if drop_existing {
        let (response_tx, _response_rx) = tokio::sync::oneshot::channel();
        let _ = transport_tx.try_send(TransportMessage::Rpc {
            query: TransportQuery::DropPath { dest: request_hash },
            response_tx,
        });
    }
    transport_tx
        .try_send(TransportMessage::RequestPath {
            destination_hash: request_hash,
        })
        .map_err(|e| {
            tracing::debug!(
                dest = %hex::encode(request_hash),
                error = %e,
                reason,
                "path request try_send rejected"
            );
        })
        .is_ok()
}

/// Fire-and-forget suppress + DropAllVia + DropPath + RequestPath for Direct failover.
///
/// When `prefer_ifaces` is non-empty, issue a second RequestPath (Nomad parity) so
/// remaining live hubs — especially private LAN — get another rediscovery chance
/// after Auto was suppressed.
fn queue_path_failover_queries(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest: [u8; 16],
    vias_to_drop: &[String],
    prefer_ifaces: &[String],
    reason: &str,
) {
    let ops = build_path_failover_control_ops(dest, vias_to_drop, None, prefer_ifaces);
    let (response_tx, _response_rx) = tokio::sync::oneshot::channel();
    if let Err(e) = transport_tx.try_send(TransportMessage::Rpc {
        query: TransportQuery::SuppressCurrentPathInterface {
            dest: ops.dest,
            duration: ops.suppress_secs,
        },
        response_tx,
    }) {
        tracing::debug!(
            dest = %hex::encode(dest),
            error = %e,
            reason,
            "path failover SuppressCurrentPathInterface try_send rejected"
        );
    }
    for via_hex in &ops.vias_to_drop {
        if let Ok(next_hop) = parse_hash16(via_hex) {
            let (response_tx, _response_rx) = tokio::sync::oneshot::channel();
            if let Err(e) = transport_tx.try_send(TransportMessage::Rpc {
                query: TransportQuery::DropAllVia { next_hop },
                response_tx,
            }) {
                tracing::debug!(
                    dest = %hex::encode(dest),
                    via = %via_hex,
                    error = %e,
                    reason,
                    "path failover DropAllVia try_send rejected"
                );
            }
        }
    }
    let _ = try_queue_path_request(transport_tx, dest, true, reason);
    if !ops.prefer_ifaces.is_empty() {
        tracing::debug!(
            dest = %hex::encode(dest),
            prefer = ?ops.prefer_ifaces,
            reason,
            "path failover: extra RequestPath toward prefer-tier live interfaces"
        );
        let _ = transport_tx.try_send(TransportMessage::RequestPath {
            destination_hash: dest,
        });
    }
}

pub fn parse_propagation_hash(hex_str: &str) -> Option<[u8; 16]> {
    parse_hash16(hex_str).ok()
}

fn now_f64() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dest(byte: u8) -> [u8; 16] {
        [byte; 16]
    }

    #[test]
    fn path_gate_allows_first_request() {
        let gate = PathRequestGate::new();
        assert_eq!(gate.decide(dest(1), 100.0), PathRequestDecision::Send);
    }

    #[test]
    fn path_gate_backoffs_after_queue_failure() {
        let mut gate = PathRequestGate::new();
        gate.record_queue_failure(dest(1), 100.0);
        assert_eq!(gate.decide(dest(1), 110.0), PathRequestDecision::Backoff);
        assert_eq!(gate.decide(dest(1), 121.0), PathRequestDecision::Send);
    }

    #[test]
    fn path_gate_max_attempts_fails_terminal() {
        let mut gate = PathRequestGate::new();
        for i in 0..PATH_REQUEST_MAX_ATTEMPTS {
            gate.record_queue_failure(dest(2), 100.0 + f64::from(i));
        }
        assert_eq!(
            gate.decide(dest(2), 500.0),
            PathRequestDecision::MaxAttempts
        );
    }

    #[test]
    fn path_gate_backoffs_after_successful_send() {
        let mut gate = PathRequestGate::new();
        gate.record_send(dest(4), 100.0);
        assert_eq!(gate.decide(dest(4), 110.0), PathRequestDecision::Backoff);
        assert_eq!(gate.decide(dest(4), 121.0), PathRequestDecision::Send);
    }

    #[test]
    fn path_gate_clears_on_path_resolution() {
        let mut gate = PathRequestGate::new();
        gate.record_queue_failure(dest(3), 100.0);
        gate.clear_destination(dest(3));
        assert_eq!(gate.decide(dest(3), 101.0), PathRequestDecision::Send);
    }

    #[test]
    fn clear_path_to_removes_stale_route_so_refresh_can_reinstall() {
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let dest_hash = dest(0xab);
        let dest_hex = hex::encode(dest_hash);
        // Stale cached route (5 hops).
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 5,
            hex_key: dest_hex.clone(),
            interface: Some("TTP_TCP".into()),
            via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        }]);
        assert!(driver.has_path_to(&dest_hex));
        assert_eq!(
            driver.path_interfaces.get(&dest_hash).map(String::as_str),
            Some("TTP_TCP")
        );
        assert_eq!(
            driver.path_vias.get(&dest_hash).map(String::as_str),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );

        // Force refresh: drop local cache (transport DropPath happens in live.rs).
        driver.clear_path_to(&dest_hex);
        assert!(!driver.has_path_to(&dest_hex));
        assert!(!driver.path_interfaces.contains_key(&dest_hash));
        assert!(!driver.path_vias.contains_key(&dest_hash));

        // Fresh route response reinstalls with updated hops.
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 2,
            hex_key: dest_hex.clone(),
            interface: Some("Local Transport Pi".into()),
            via: Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into()),
        }]);
        assert!(driver.has_path_to(&dest_hex));
        assert_eq!(driver.route_hops.get(&dest_hash).copied(), Some(2));
        assert_eq!(
            driver.path_interfaces.get(&dest_hash).map(String::as_str),
            Some("Local Transport Pi")
        );
        assert_eq!(
            driver.path_vias.get(&dest_hash).map(String::as_str),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        );
    }

    #[test]
    fn requeue_direct_after_path_failover_exhausts_then_clears_state() {
        use crate::stack::path_failover::MAX_VIA_FAILOVERS;
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, mut rx) = mpsc::channel(32);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let dest_hash = dest(0xcd);
        let msg_hash = [0x42u8; 32];
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 4,
            hex_key: hex::encode(dest_hash),
            interface: Some("TTP_TCP".into()),
            via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        }]);

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, _event_rx) = broadcast::channel(8);

        let make_msg = || {
            let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Direct);
            msg.hash = Some(msg_hash);
            msg
        };

        for round in 1..=MAX_VIA_FAILOVERS {
            // Drain queued control messages so the channel stays open.
            while rx.try_recv().is_ok() {}
            // Reinstall a path so each round has an iface/via to record.
            driver.update_path_table(&[PathTableRoute {
                hash: dest_hash,
                hops: 4,
                hex_key: hex::encode(dest_hash),
                interface: Some(format!("Hub{round}")),
                via: Some(format!("{round:032x}")),
            }]);
            let result = driver.requeue_direct_after_path_failover(
                &mut router,
                &event_tx,
                make_msg(),
                dest_hash,
                "timed out waiting for link proof",
            );
            assert!(result.is_ok(), "round {round} should re-queue");
            let state = driver
                .direct_path_failovers
                .get(&msg_hash)
                .expect("failover state retained");
            assert_eq!(state.rounds, round);
            assert_eq!(state.tried_interfaces.len(), round as usize);
        }

        while rx.try_recv().is_ok() {}
        let exhausted = driver.requeue_direct_after_path_failover(
            &mut router,
            &event_tx,
            make_msg(),
            dest_hash,
            "timed out waiting for link proof",
        );
        assert!(exhausted.is_err(), "round after MAX should exhaust");
        assert!(
            !driver.direct_path_failovers.contains_key(&msg_hash),
            "exhausted state must be removed"
        );
    }

    fn iface_row(
        name: &str,
        iface_type: &str,
        enabled: bool,
        status: &str,
        host: Option<&str>,
    ) -> InterfaceRow {
        use crate::stack::types::interface_discovery_defaults;
        let (
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
        ) = interface_discovery_defaults();
        InterfaceRow {
            id: name.to_lowercase().replace(' ', "-"),
            name: name.into(),
            iface_type: iface_type.into(),
            enabled,
            status: status.into(),
            host: host.map(str::to_string),
            port: None,
            preset: None,
            serial_port: None,
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: None,
            seed_addresses: vec![],
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
            network_name: None,
            passphrase: None,
            flow_control: None,
            extra_config: std::collections::HashMap::default(),
        }
    }

    #[test]
    fn auto_failure_sets_degraded_and_queues_extra_request_path() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, mut rx) = mpsc::channel(64);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        driver.update_interfaces(vec![
            iface_row("Auto", "auto", true, "up", None),
            iface_row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
            iface_row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org")),
        ]);
        let dest_hash = dest(0xef);
        let msg_hash = [0x43u8; 32];
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 1,
            hex_key: hex::encode(dest_hash),
            interface: Some("Auto".into()),
            via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        }]);

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, _event_rx) = broadcast::channel(8);
        let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Direct);
        msg.hash = Some(msg_hash);

        let result = driver.requeue_direct_after_path_failover(
            &mut router,
            &event_tx,
            msg,
            dest_hash,
            "timed out waiting for link proof",
        );
        assert!(result.is_ok());
        assert!(
            driver.auto_delivery_degraded_until > now_f64(),
            "Auto Direct failure must latch delivery-degraded window"
        );

        let mut request_path_count = 0usize;
        while let Ok(msg) = rx.try_recv() {
            if matches!(msg, TransportMessage::RequestPath { .. }) {
                request_path_count += 1;
            }
        }
        assert!(
            request_path_count >= 2,
            "prefer_private should queue DropPath RequestPath plus extra RequestPath, got {request_path_count}"
        );

        // Degraded + private live → preempt next Direct start.
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 1,
            hex_key: hex::encode(dest_hash),
            interface: Some("Auto".into()),
            via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        }]);
        assert!(driver.maybe_preempt_unhealthy_auto_path(dest_hash));
        assert!(!driver.has_path_to(&hex::encode(dest_hash)));
    }

    #[test]
    fn healthy_auto_with_down_sibling_does_not_preempt() {
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        driver.update_interfaces(vec![
            iface_row("Auto", "auto", true, "up", None),
            iface_row("Auto Backup", "auto", true, "down", None),
            iface_row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ]);
        let dest_hash = dest(0xaa);
        driver.update_path_table(&[PathTableRoute {
            hash: dest_hash,
            hops: 1,
            hex_key: hex::encode(dest_hash),
            interface: Some("Auto".into()),
            via: None,
        }]);
        assert!(!driver.maybe_preempt_unhealthy_auto_path(dest_hash));
        assert!(driver.has_path_to(&hex::encode(dest_hash)));
    }

    #[test]
    fn path_gate_warn_is_rate_limited() {
        let mut gate = PathRequestGate::new();
        assert!(gate.should_warn(dest(4), 100.0));
        assert!(!gate.should_warn(dest(4), 110.0));
        assert!(gate.should_warn(dest(4), 121.0));
    }

    #[test]
    fn register_identity_key_is_retrievable() {
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let dest = "0123456789abcdef0123456789abcdef";
        let key = [0x7au8; 64];
        driver.register_identity_key(dest, key);
        assert_eq!(driver.public_key_for(dest), Some(key));
        assert_eq!(driver.public_key_for(&dest.to_uppercase()), Some(key));
    }

    #[test]
    fn pin_identity_survives_eviction_flood() {
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let pn_hex = "deadbeef".to_string() + &"ab".repeat(12);
        let pn_key = [0x42u8; 64];
        driver.pin_identity_for_propagation(&pn_hex, pn_key);
        for i in 0..(MAX_KNOWN_IDENTITIES + 64) {
            let hex = format!("{i:032x}");
            driver.register_identity_key(&hex, [((i % 250) + 1) as u8; 64]);
        }
        assert!(driver.identity_known_for(&pn_hex));
        assert_eq!(driver.public_key_for(&pn_hex), Some(pn_key));
        let for_prop = driver.known_identities_for_propagation();
        assert_eq!(for_prop.get(&pn_hex.to_lowercase()), Some(&pn_key));
        driver.clear_propagation_identity_pins();
        // Pin cleared — known_identities may still hold the key until capacity pressure.
        assert!(driver.identity_known_for(&pn_hex));
    }

    #[test]
    fn choose_lxmf_send_route_prefers_direct_when_path_and_pubkey_known() {
        assert_eq!(
            choose_lxmf_send_route(true, true, true),
            LxmfSendRoute::Direct
        );
    }

    #[test]
    fn choose_lxmf_send_route_uses_propagated_when_offline_with_pn() {
        assert_eq!(
            choose_lxmf_send_route(false, false, true),
            LxmfSendRoute::Propagated
        );
    }

    #[test]
    fn choose_lxmf_send_route_errors_without_path_or_pn() {
        assert_eq!(
            choose_lxmf_send_route(false, false, false),
            LxmfSendRoute::NoPropagationNode
        );
    }

    #[test]
    fn choose_lxmf_send_route_keeps_direct_when_path_without_pubkey() {
        assert_eq!(
            choose_lxmf_send_route(true, false, false),
            LxmfSendRoute::Direct
        );
    }

    #[test]
    fn should_retry_propagated_link_closed_while_attempts_remain() {
        assert!(should_retry_propagated_link_failure(
            DeliveryMethod::Propagated,
            "link closed",
            1,
        ));
        assert!(should_retry_propagated_link_failure(
            DeliveryMethod::Propagated,
            "link establishment timeout",
            MAX_DELIVERY_ATTEMPTS,
        ));
        assert!(!should_retry_propagated_link_failure(
            DeliveryMethod::Propagated,
            "link closed",
            MAX_DELIVERY_ATTEMPTS + 1,
        ));
        assert!(!should_retry_propagated_link_failure(
            DeliveryMethod::Direct,
            "link closed",
            1,
        ));
        assert!(!should_retry_propagated_link_failure(
            DeliveryMethod::Propagated,
            "resource rejected",
            1,
        ));
    }

    #[test]
    fn should_defer_propagated_when_sync_or_pending_owns_pn_link() {
        assert!(should_defer_propagated_for_pn_link(true, false));
        assert!(should_defer_propagated_for_pn_link(false, true));
        assert!(should_defer_propagated_for_pn_link(true, true));
        assert!(!should_defer_propagated_for_pn_link(false, false));
    }

    #[test]
    fn set_inbound_packet_sender_installs_channel_on_link_delivery_manager() {
        // Smoke: driver adapter stores the sender; live.rs + spawn_lxmf_outbound_backchannel
        // cover end-to-end delivery. Without this call, LDM Acks and drops plaintext.
        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(8);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let (inbound_tx, mut inbound_rx) = mpsc::unbounded_channel::<(Vec<u8>, [u8; 16])>();
        driver.set_inbound_packet_sender(inbound_tx.clone());
        // Prove the UnboundedSender we installed is live (clone still delivers).
        let link_id = [0xD1; 16];
        inbound_tx
            .send((b"probe".to_vec(), link_id))
            .expect("installed sender must remain open");
        let (payload, got_link) = inbound_rx.try_recv().expect("probe");
        assert_eq!(payload, b"probe");
        assert_eq!(got_link, link_id);
    }

    #[test]
    fn try_advance_pn_cascade_orders_preferred_remote_local_then_exhausts() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(32);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let preferred = [0x11u8; 16];
        let next_remote = [0x22u8; 16];
        let local = [0x99u8; 16];
        let dest_hash = dest(0xcd);
        let msg_hash = [0x42u8; 32];

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, _event_rx) = broadcast::channel(8);
        driver.set_propagation_node(&mut router, Some(preferred));
        driver.set_pn_cascade_candidates(vec![
            PnCascadeCandidate {
                hash: preferred,
                is_local: false,
                is_discovered: false,
                hops: Some(1),
                id: "pn-a".into(),
            },
            PnCascadeCandidate {
                hash: next_remote,
                is_local: false,
                is_discovered: false,
                hops: Some(2),
                id: "pn-b".into(),
            },
            PnCascadeCandidate {
                hash: local,
                is_local: true,
                is_discovered: false,
                hops: Some(0),
                id: "local-prop".into(),
            },
        ]);

        let make_direct = || {
            let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Direct);
            msg.hash = Some(msg_hash);
            msg
        };

        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, make_direct())
                .is_ok()
        );
        assert_eq!(driver.pending_pn_targets.get(&msg_hash), Some(&preferred));
        assert!(!driver.pn_cascade_local.contains(&msg_hash));

        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, make_direct())
                .is_ok()
        );
        assert_eq!(driver.pending_pn_targets.get(&msg_hash), Some(&next_remote));
        assert!(!driver.pn_cascade_local.contains(&msg_hash));

        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, make_direct())
                .is_ok()
        );
        assert_eq!(driver.pending_pn_targets.get(&msg_hash), Some(&local));
        assert!(driver.pn_cascade_local.contains(&msg_hash));

        let exhausted = driver.try_advance_pn_cascade(&mut router, &event_tx, make_direct());
        assert!(exhausted.is_err(), "cascade must exhaust after local-prop");
    }

    #[test]
    fn pn_cascade_source_contract_replaces_one_shot_fallback() {
        let src = include_str!("lxmf_outbound.rs");
        assert!(
            src.contains("fn try_advance_pn_cascade"),
            "outbound driver must advance multi-PN cascade after Direct exhaust"
        );
        assert!(
            src.contains("match self.try_advance_pn_cascade"),
            "delivery fail paths must call try_advance_pn_cascade"
        );
        assert!(
            src.contains("stored_locally"),
            "local-prop cascade step must emit stored_locally"
        );
        assert!(
            src.contains("PN_DEPOSIT_DEFER_ADVANCE_AFTER"),
            "sync/pending PN-link deferral must eventually advance cascade"
        );
        assert!(
            src.contains("pending_pn_targets") && src.contains("apply_pending_pn_targets"),
            "per-message PN targets must rewrite DeliverPropagated.prop_hash"
        );
        assert!(
            src.contains("pack_for_propagation failed — advancing PN cascade"),
            "pack failure must advance cascade instead of bare requeue"
        );
        assert!(
            src.contains("propagated delivery attempt budget reached — advancing PN cascade"),
            "max delivery attempts must advance cascade instead of bare requeue"
        );
        let legacy_one_shot = concat!("should_fallback_", "direct_to_pn");
        assert!(
            !src.contains(legacy_one_shot),
            "one-shot Direct→PN helper must be removed; live path uses PN cascade"
        );
    }

    #[test]
    fn outbound_source_exposes_inbound_packet_sender_adapter() {
        let src = include_str!("lxmf_outbound.rs");
        assert!(
            src.contains("pub fn set_inbound_packet_sender"),
            "outbound driver must expose set_inbound_packet_sender for live wiring"
        );
        assert!(
            src.contains("self.link_delivery.set_inbound_packet_sender(tx)"),
            "adapter must forward to LinkDeliveryManager"
        );
    }

    #[test]
    fn on_propagated_link_timeout_advances_cascade_when_other_pns_remain() {
        // Observed Prefer hashes (thunderhost / deadbeef): link-timeout must not hammer
        // the same PN while other cascade candidates remain.
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::link_delivery::DeliveryResult;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(32);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        // Fixture hashes from Joey Prefer (9f3f…) / w0rmt Prefer (deadbeef).
        let prefer = hex::decode("9f3f189e9f3f189e9f3f189e9f3f189e")
            .ok()
            .and_then(|b| <[u8; 16]>::try_from(b.as_slice()).ok())
            .unwrap_or([0x9f; 16]);
        let next = hex::decode("deadbeefdeadbeefdeadbeefdeadbeef")
            .ok()
            .and_then(|b| <[u8; 16]>::try_from(b.as_slice()).ok())
            .unwrap_or([0xde; 16]);
        let dest_hash = dest(0xcd);
        let msg_hash = [0x42u8; 32];

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, mut event_rx) = broadcast::channel(16);
        driver.set_propagation_node(&mut router, Some(prefer));
        driver.set_pn_cascade_candidates(vec![
            PnCascadeCandidate {
                hash: prefer,
                is_local: false,
                is_discovered: false,
                hops: Some(2),
                id: "pn-9f3f189e".into(),
            },
            PnCascadeCandidate {
                hash: next,
                is_local: false,
                is_discovered: false,
                hops: Some(3),
                id: "pn-deadbeef".into(),
            },
        ]);

        // Enter cascade on Prefer (marks Prefer tried).
        let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Direct);
        msg.hash = Some(msg_hash);
        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, msg)
                .is_ok()
        );
        assert_eq!(driver.pending_pn_targets.get(&msg_hash), Some(&prefer));

        let mut failed = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Propagated);
        failed.hash = Some(msg_hash);
        failed.delivery_attempts = 1;
        driver.handle_delivery_result(
            &mut router,
            &event_tx,
            DeliveryResult::Failed {
                link_id: prefer,
                msg_hash: Some(msg_hash),
                dest_hash: prefer,
                message: failed,
                reason: "link establishment timeout".into(),
            },
        );

        assert_eq!(
            driver.pending_pn_targets.get(&msg_hash),
            Some(&next),
            "timeout on Prefer must advance to next PN (not requeue Prefer)"
        );
        assert!(!driver.pn_cascade_local.contains(&msg_hash));

        // Intermediate status stays sending/propagated (not terminal failed).
        let mut saw_sending = false;
        while let Ok(frame) = event_rx.try_recv() {
            if frame.contains("\"status\":\"sending\"") && frame.contains("propagated") {
                saw_sending = true;
            }
            assert!(
                !frame.contains("\"status\":\"failed\""),
                "must not emit failed while cascade capacity remains: {frame}"
            );
        }
        assert!(saw_sending, "cascade advance should emit sending");
    }

    #[test]
    fn on_propagated_link_timeout_exhausts_to_failed_without_local_prop() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::link_delivery::DeliveryResult;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(32);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let prefer = [0x9fu8; 16];
        let dest_hash = dest(0xcd);
        let msg_hash = [0x43u8; 32];

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, mut event_rx) = broadcast::channel(16);
        driver.set_propagation_node(&mut router, Some(prefer));
        driver.set_pn_cascade_candidates(vec![PnCascadeCandidate {
            hash: prefer,
            is_local: false,
            is_discovered: false,
            hops: Some(2),
            id: "pn-only".into(),
        }]);

        let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Direct);
        msg.hash = Some(msg_hash);
        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, msg)
                .is_ok()
        );

        // Exhaust retry budget so last-candidate requeue is skipped → terminal failed.
        let mut failed = LxMessage::new(dest_hash, [1u8; 16], "", "hi", DeliveryMethod::Propagated);
        failed.hash = Some(msg_hash);
        failed.delivery_attempts = MAX_DELIVERY_ATTEMPTS + 1;
        driver.handle_delivery_result(
            &mut router,
            &event_tx,
            DeliveryResult::Failed {
                link_id: prefer,
                msg_hash: Some(msg_hash),
                dest_hash: prefer,
                message: failed,
                reason: "link establishment timeout".into(),
            },
        );

        let mut saw_failed = false;
        while let Ok(frame) = event_rx.try_recv() {
            if frame.contains("\"status\":\"failed\"") {
                saw_failed = true;
            }
        }
        assert!(
            saw_failed,
            "single Prefer with exhausted attempts and no local-prop → failed"
        );
    }

    #[test]
    fn deposit_defers_then_advances_when_sync_owns_pn_link() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use tokio::sync::broadcast;

        let identity = Identity::new();
        let (tx, _rx) = mpsc::channel(32);
        let mut driver = LxmfOutboundDriver::new(tx, &identity, "aabb".repeat(8), "me".into());
        let prefer = [0x9fu8; 16];
        let next = [0xdeu8; 16];
        let dest_hash = dest(0xcd);
        let msg_hash = [0x44u8; 32];
        let dest_pub = Identity::new().get_public_key();
        driver.register_identity_key(&hex::encode(dest_hash), dest_pub);
        driver.register_identity_key(&hex::encode(prefer), Identity::new().get_public_key());
        driver.register_identity_key(&hex::encode(next), Identity::new().get_public_key());

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, _event_rx) = broadcast::channel(16);
        driver.set_propagation_node(&mut router, Some(prefer));
        driver.set_pn_cascade_candidates(vec![
            PnCascadeCandidate {
                hash: prefer,
                is_local: false,
                is_discovered: false,
                hops: Some(1),
                id: "pn-a".into(),
            },
            PnCascadeCandidate {
                hash: next,
                is_local: false,
                is_discovered: false,
                hops: Some(2),
                id: "pn-b".into(),
            },
        ]);
        driver.set_propagation_sync_target(Some(prefer));

        let mut msg = LxMessage::new(dest_hash, [1u8; 16], "", "busy", DeliveryMethod::Propagated);
        // Do not sign — this test only exercises sync-busy deferral (no pack).
        msg.hash = Some(msg_hash);
        msg.message_id = Some(msg_hash);
        driver.mark_pn_tried(msg_hash, prefer);
        driver.pending_pn_targets.insert(msg_hash, prefer);

        for _ in 0..PN_DEPOSIT_DEFER_ADVANCE_AFTER {
            let attempt = msg.clone();
            driver.deliver_propagated(&mut router, &event_tx, attempt, prefer);
        }
        assert_eq!(
            driver.pending_pn_targets.get(&msg_hash),
            Some(&next),
            "after PN_DEPOSIT_DEFER_ADVANCE_AFTER busy defers, cascade advances"
        );
    }

    /// T1: outbound DeliverPropagated → in-process local accept → stored_locally → drain.
    #[test]
    fn local_prop_outbound_deposit_round_trip_stored_locally_then_drain() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use rns_identity::destination::Destination;
        use tokio::sync::broadcast;

        let dir = std::env::temp_dir().join(format!(
            "mesh-prop-outbound-rt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");

        let sender = Identity::new();
        let recipient = Identity::new();
        let local_prop = [0xabu8; 16];
        let zero_stamp_policy = crate::stack::pn_hosting_policy::PnHostingPolicy {
            propagation_stamp_cost: 0,
            propagation_stamp_flex: 0,
            ..Default::default()
        };
        let (tx, _rx) = mpsc::channel(32);
        let bridge = crate::stack::propagation_bridge::PropagationBridge::new(
            tx.clone(),
            local_prop,
            dir.clone(),
            &recipient,
            &zero_stamp_policy,
        )
        .expect("bridge");

        let sender_delivery =
            Destination::hash_from_name_and_identity("lxmf.delivery", Some(&sender.hash));
        let recipient_delivery =
            Destination::hash_from_name_and_identity("lxmf.delivery", Some(&recipient.hash));
        let mut driver =
            LxmfOutboundDriver::new(tx, &sender, hex::encode(sender_delivery), "me".into());
        driver.register_identity_key(&hex::encode(recipient_delivery), recipient.get_public_key());
        driver.set_local_prop_node(Some(bridge.local_node()));
        driver.set_pn_cascade_candidates(vec![PnCascadeCandidate {
            hash: local_prop,
            is_local: true,
            is_discovered: false,
            hops: Some(0),
            id: "local-prop".into(),
        }]);

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, mut event_rx) = broadcast::channel(16);

        let mut msg = LxMessage::new(
            recipient_delivery,
            sender_delivery,
            "",
            "outbound local-prop round-trip",
            DeliveryMethod::Direct,
        );
        msg.sign(&sender.get_signing_key().expect("sk"))
            .expect("sign");
        let msg_hash = msg.hash.expect("hash after sign");

        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, msg)
                .is_ok()
        );
        assert!(driver.pn_cascade_local.contains(&msg_hash));

        // Drive one outbound tick so DeliverPropagated → in-process accept.
        driver.process_tick(&mut router, &event_tx);

        let mut saw_stored = false;
        while let Ok(frame) = event_rx.try_recv() {
            if frame.contains("\"status\":\"stored_locally\"") {
                saw_stored = true;
            }
        }
        assert!(
            saw_stored,
            "in-process local deposit must emit stored_locally"
        );
        assert_eq!(
            bridge.local_node().lock().expect("lock").message_count(),
            1,
            "local PN store must hold the deposited blob"
        );

        let (messages, listed) = bridge.drain_local_inbox();
        assert_eq!(listed, 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "outbound local-prop round-trip");
        assert_eq!(messages[0].method, DeliveryMethod::Propagated);

        let (again, listed_again) = bridge.drain_local_inbox();
        assert!(again.is_empty());
        assert_eq!(listed_again, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// T5: deposit on local-prop appears in peer `/offer` inventory.
    #[test]
    fn local_prop_deposit_appears_in_peer_sync_offer_inventory() {
        use lxmf_core::constants::DeliveryMethod;
        use lxmf_core::message::LxMessage;
        use lxmf_core::router::{LxmRouter, RouterConfig};
        use rns_identity::destination::Destination;
        use tokio::sync::broadcast;

        let dir = std::env::temp_dir().join(format!(
            "mesh-prop-peer-offer-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");

        let sender = Identity::new();
        let recipient = Identity::new();
        let local_prop = [0xacu8; 16];
        let peer_pn = [0xbeu8; 16];
        let zero_stamp_policy = crate::stack::pn_hosting_policy::PnHostingPolicy {
            propagation_stamp_cost: 0,
            propagation_stamp_flex: 0,
            ..Default::default()
        };
        let (tx, _rx) = mpsc::channel(32);
        let bridge = crate::stack::propagation_bridge::PropagationBridge::new(
            tx.clone(),
            local_prop,
            dir.clone(),
            &recipient,
            &zero_stamp_policy,
        )
        .expect("bridge");

        let sender_delivery =
            Destination::hash_from_name_and_identity("lxmf.delivery", Some(&sender.hash));
        let recipient_delivery =
            Destination::hash_from_name_and_identity("lxmf.delivery", Some(&recipient.hash));
        let mut driver =
            LxmfOutboundDriver::new(tx, &sender, hex::encode(sender_delivery), "me".into());
        driver.register_identity_key(&hex::encode(recipient_delivery), recipient.get_public_key());
        driver.set_local_prop_node(Some(bridge.local_node()));
        driver.set_pn_cascade_candidates(vec![PnCascadeCandidate {
            hash: local_prop,
            is_local: true,
            is_discovered: false,
            hops: Some(0),
            id: "local-prop".into(),
        }]);

        let mut router = LxmRouter::new(RouterConfig::default());
        let (event_tx, _event_rx) = broadcast::channel(8);
        let mut msg = LxMessage::new(
            recipient_delivery,
            sender_delivery,
            "",
            "pn-to-pn inventory",
            DeliveryMethod::Direct,
        );
        msg.sign(&sender.get_signing_key().expect("sk"))
            .expect("sign");
        assert!(
            driver
                .try_advance_pn_cascade(&mut router, &event_tx, msg)
                .is_ok()
        );
        driver.process_tick(&mut router, &event_tx);

        let offer = {
            let node_arc = bridge.local_node();
            let mut node = node_arc.lock().expect("lock");
            assert_eq!(node.message_count(), 1);
            assert!(node.offer_generation() >= 1);
            node.prepare_sync_offer(peer_pn)
        };
        assert!(
            !offer.transient_ids.is_empty(),
            "host peer /offer must list deposited message for peered PN"
        );

        let live = include_str!("live.rs");
        assert!(
            live.contains("local host queued outbound peer inventory sync"),
            "production host peer loop must queue inventory sync"
        );
        assert!(
            live.contains("set_local_prop_node(Some"),
            "serving must wire in-process local PN into outbound"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pn_cascade_source_contract_includes_in_process_local_and_timeout_advance() {
        let src = include_str!("lxmf_outbound.rs");
        assert!(
            src.contains("try_local_prop_in_process_deposit"),
            "local-prop cascade must deposit in-process (official PN parity)"
        );
        assert!(
            src.contains("on_propagated_link_failure"),
            "Propagated link failures must advance cascade when capacity remains"
        );
        assert!(
            src.contains("advancing PN cascade (other candidates remain)"),
            "timeout advance path must be logged for Prefer PN storms"
        );
    }
}
