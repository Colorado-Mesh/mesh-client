//! LXMF outbound delivery loop (Direct / Propagated) via LinkDeliveryManager.

use std::collections::{HashMap, HashSet};

use bytes::Bytes;
use lxmf_core::constants::DeliveryMethod;
use lxmf_core::link_delivery::{DeliveryResult, LinkDeliveryManager};
use lxmf_core::message::LxMessage;
use lxmf_core::router::{
    plan_direct_delivery, DirectDeliveryPlan, DirectDeliveryPlanInput, DirectReusableLinkState,
    DirectRouteSnapshot, LxmRouter, OutboundAction,
};
use rns_identity::identity::Identity;
use rns_transport::messages::{TransportMessage, TransportQuery};
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use super::{lxmf_payload_from_message, parse_hash16};

const PATH_REQUEST_BACKOFF_SECS: f64 = 20.0;
const PATH_REQUEST_MAX_ATTEMPTS: u32 = 12;

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
        self.backoff_until.insert(dest, now + PATH_REQUEST_BACKOFF_SECS);
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

pub struct LxmfOutboundDriver {
    transport_tx: mpsc::Sender<TransportMessage>,
    link_delivery: LinkDeliveryManager,
    route_hops: HashMap<[u8; 16], u8>,
    known_identities: HashMap<String, [u8; 64]>,
    path_table_hashes: HashSet<String>,
    path_request_gate: PathRequestGate,
    self_lxmf_hash: String,
    self_display_name: String,
}

impl LxmfOutboundDriver {
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
            path_table_hashes: HashSet::new(),
            path_request_gate: PathRequestGate::new(),
            self_lxmf_hash: self_lxmf_hash.clone(),
            self_display_name,
        };
        driver.register_identity_key(&self_lxmf_hash, identity.get_public_key());
        driver
    }

    pub fn register_identity_key(&mut self, dest_hash_hex: &str, public_key: [u8; 64]) {
        let key = dest_hash_hex.to_lowercase();
        if !self.known_identities.contains_key(&key)
            && self.known_identities.len() >= MAX_KNOWN_IDENTITIES
        {
            // Evict an arbitrary entry to bound memory under announce floods.
            if let Some(oldest) = self.known_identities.keys().next().cloned() {
                self.known_identities.remove(&oldest);
            }
        }
        self.known_identities.insert(key, public_key);
    }

    pub fn known_identities_for_propagation(&self) -> HashMap<String, [u8; 64]> {
        self.known_identities.clone()
    }

    pub fn set_propagation_node(&mut self, router: &mut LxmRouter, hash: Option<[u8; 16]>) {
        router.set_outbound_propagation_node(hash);
    }

    pub fn update_path_table(&mut self, entries: &[( [u8; 16], u8, String)]) {
        self.route_hops.clear();
        self.path_table_hashes.clear();
        for (hash, hops, hex_key) in entries {
            self.route_hops.insert(*hash, (*hops).max(1));
            self.path_table_hashes.insert(hex_key.to_lowercase());
            self.path_request_gate.clear_destination(*hash);
        }
    }

    pub fn has_path_to(&self, destination_hex: &str) -> bool {
        self.path_table_hashes
            .contains(&destination_hex.to_lowercase())
    }

    pub fn identity_known_for(&self, destination_hex: &str) -> bool {
        self.known_identities
            .contains_key(&destination_hex.to_lowercase())
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

        let actions = router.process_outbound_with_direct(|message, _now| {
            direct_inputs
                .get(&message.destination_hash)
                .cloned()
                .unwrap_or(DirectDeliveryPlanInput {
                    identity_known: false,
                    route: None,
                    reusable_link: DirectReusableLinkState::None,
                })
        });

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
        if !self
            .known_identities
            .contains_key(&prop_hex.to_lowercase())
        {
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
        let Some(packed) = self.pack_for_propagation(&mut message, prop_hash) else {
            router.send(message);
            return;
        };
        let hops = route_hops_for(&self.route_hops, prop_hash);
        if let Err(err) = self
            .link_delivery
            .start_packed_delivery(message, prop_hash, hops, packed, false)
        {
            tracing::warn!(
                prop = %prop_hex,
                error = %err.error,
                "propagated link delivery start failed"
            );
            router.send(*err.message);
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
                    self.path_request_gate.record_queue_failure(request_hash, now);
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
        mut message: LxMessage,
    ) {
        message.mark_failed();
        if let Some(hash) = message.hash.or(message.message_id) {
            let _ = router.mark_outbound_failed(&hash);
            emit_outbound_status_by_hash(event_tx, &hash, "failed");
        }
        let method = delivery_method_label(message.method);
        let payload = lxmf_payload_from_message(
            &message,
            &self.self_lxmf_hash,
            &self.self_display_name,
            None,
            Some(method),
            "outbound",
            None,
        );
        emit_outbound_status(event_tx, &payload, "failed", method);
    }

    fn pack_for_propagation(
        &self,
        message: &mut LxMessage,
        prop_hash: [u8; 16],
    ) -> Option<Vec<u8>> {
        let dest_hex = hex::encode(message.destination_hash);
        let target_cost = message.stamp_cost.unwrap_or(0);
        let (packed, _, _) = message
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
        let _ = prop_hash;
        Some(packed)
    }

    fn encrypt_for_destination(&self, dest_hash_hex: &str, plaintext: &[u8]) -> Option<Vec<u8>> {
        let pub_key = self.known_identities.get(&dest_hash_hex.to_lowercase())?;
        let remote = Identity::from_public_key(pub_key).ok()?;
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
                    let _ = router.mark_outbound_delivered(&hash);
                    emit_outbound_status_by_hash(event_tx, &hash, "delivered");
                }
            }
            DeliveryResult::Rejected { msg_hash, message, .. }
            | DeliveryResult::Failed { msg_hash, message, .. } => {
                if let Some(hash) = msg_hash {
                    let _ = router.mark_outbound_failed(&hash);
                    emit_outbound_status_by_hash(event_tx, &hash, "failed");
                }
                let method = delivery_method_label(message.method);
                let payload = lxmf_payload_from_message(
                    &message,
                    &self.self_lxmf_hash,
                    &self.self_display_name,
                    None,
                    Some(method),
                    "outbound",
                    None,
                );
                emit_outbound_status(event_tx, &payload, "failed", method);
            }
        }
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

pub fn emit_outbound_status(
    event_tx: &broadcast::Sender<String>,
    message_payload: &serde_json::Value,
    status: &str,
    delivery_method: &str,
) {
    let frame = serde_json::json!({
        "type": "lxmf_outbound_status",
        "payload": {
            "message_hash": message_payload.get("message_hash"),
            "to_hash": message_payload.get("to_hash"),
            "status": status,
            "delivery_method": delivery_method,
        }
    });
    let _ = event_tx.send(frame.to_string());
}

fn emit_outbound_status_by_hash(event_tx: &broadcast::Sender<String>, hash: &[u8; 32], status: &str) {
    let frame = serde_json::json!({
        "type": "lxmf_outbound_status",
        "payload": {
            "message_hash": hex::encode(hash),
            "status": status,
        }
    });
    let _ = event_tx.send(frame.to_string());
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
        assert_eq!(gate.decide(dest(2), 500.0), PathRequestDecision::MaxAttempts);
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
    fn path_gate_warn_is_rate_limited() {
        let mut gate = PathRequestGate::new();
        assert!(gate.should_warn(dest(4), 100.0));
        assert!(!gate.should_warn(dest(4), 110.0));
        assert!(gate.should_warn(dest(4), 121.0));
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
}
