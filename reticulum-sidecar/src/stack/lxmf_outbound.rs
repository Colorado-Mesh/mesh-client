//! LXMF outbound delivery loop (Direct / Propagated) via LinkDeliveryManager.

use std::collections::{HashMap, HashSet};

use bytes::Bytes;
use lxmf_core::constants::{
    DELIVERY_RETRY_WAIT, DeliveryMethod, MAX_DELIVERY_ATTEMPTS, PATH_REQUEST_WAIT,
};
use lxmf_core::link_delivery::{
    DeliveryResult, LinkDeliveryManager, is_retryable_link_delivery_failure,
};
use lxmf_core::message::LxMessage;
use lxmf_core::router::{
    DirectDeliveryPlan, DirectDeliveryPlanInput, DirectReusableLinkState, DirectRouteSnapshot,
    LxmRouter, OutboundAction, plan_direct_delivery,
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

/// Bound on Direct→PN fallback hash tracking (one entry per outbound message).
const PN_FALLBACK_ATTEMPTED_MAX: usize = 256;

pub struct LxmfOutboundDriver {
    transport_tx: mpsc::Sender<TransportMessage>,
    link_delivery: LinkDeliveryManager,
    route_hops: HashMap<[u8; 16], u8>,
    known_identities: HashMap<String, [u8; 64]>,
    /// Dest hashes pinned for in-flight propagation sync (LRPROOF needs pubkey).
    /// Eviction must not remove these while Establishing.
    pinned_identities: HashMap<String, [u8; 64]>,
    path_table_hashes: HashSet<String>,
    path_request_gate: PathRequestGate,
    /// Message hashes that already consumed the one-shot Direct→PN fallback.
    pn_fallback_attempted: HashSet<[u8; 32]>,
    /// When set, remote propagation sync holds a Link to this dest — do not race deposits.
    propagation_sync_target: Option<[u8; 16]>,
    self_lxmf_hash: String,
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
            path_request_gate: PathRequestGate::new(),
            pn_fallback_attempted: HashSet::new(),
            propagation_sync_target: None,
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

    /// True when a packed deposit / Direct session already holds a Link to `dest`.
    pub fn has_inflight_delivery_to(&self, dest: &[u8; 16]) -> bool {
        self.link_delivery.has_pending_to(dest)
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
        router.set_outbound_propagation_node(hash);
    }

    pub fn update_path_table(&mut self, entries: &[([u8; 16], u8, String)]) {
        self.route_hops.clear();
        self.path_table_hashes.clear();
        for (hash, hops, hex_key) in entries {
            self.route_hops.insert(*hash, (*hops).max(1));
            self.path_table_hashes.insert(hex_key.to_lowercase());
            self.path_request_gate.clear_destination(*hash);
        }
    }

    /// Remove a single destination from the local path cache (e.g. after transport DropPath).
    pub fn clear_path_to(&mut self, destination_hex: &str) {
        let key = destination_hex.to_lowercase();
        self.path_table_hashes.remove(&key);
        if let Ok(dest) = parse_hash16(&key) {
            self.route_hops.remove(&dest);
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
        // Avoid racing a second LinkRequest to the same PN (sync or another deposit).
        let sync_blocks = self.propagation_sync_target == Some(prop_hash);
        let pending_blocks = self.link_delivery.has_pending_to(&prop_hash);
        if should_defer_propagated_for_pn_link(sync_blocks, pending_blocks) {
            let now = now_f64();
            message.next_delivery_attempt = now + PATH_REQUEST_WAIT as f64;
            tracing::debug!(
                prop = %prop_hex,
                dest = %hex::encode(message.destination_hash),
                sync_blocks,
                pending_blocks,
                attempts = message.delivery_attempts,
                "DeliverPropagated: deferring — PN link busy"
            );
            if let Some(hash) = message.hash.or(message.message_id) {
                emit_outbound_status_with_via(
                    event_tx,
                    Some(serde_json::Value::String(hex::encode(hash))),
                    None,
                    "sending",
                    Some("propagated"),
                    None,
                );
            }
            router.send(message);
            return;
        }
        if !self.known_identities.contains_key(&prop_hex.to_lowercase()) {
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
        let Some(packed) = self.pack_for_propagation(
            &mut message,
            prop_hash,
            router.get_stamp_cost(&prop_hash).unwrap_or(0),
        ) else {
            tracing::warn!(
                prop = %prop_hex,
                dest = %hex::encode(message.destination_hash),
                "DeliverPropagated: pack_for_propagation failed — requeue"
            );
            router.send(message);
            return;
        };
        // lxmd parity: count the attempt before packed link delivery so Failed can budget retries.
        let attempts = mark_propagated_delivery_attempt(&mut message);
        if attempts >= MAX_DELIVERY_ATTEMPTS {
            tracing::warn!(
                prop = %prop_hex,
                attempts,
                max_attempts = MAX_DELIVERY_ATTEMPTS,
                "propagated delivery attempt budget reached; deferring terminal failure"
            );
            router.send(message);
            return;
        }
        let hops = route_hops_for(&self.route_hops, prop_hash);
        tracing::debug!(
            prop = %prop_hex,
            dest = %hex::encode(message.destination_hash),
            hops,
            packed_len = packed.len(),
            attempts,
            "DeliverPropagated: starting packed delivery"
        );
        if let Err(err) = self
            .link_delivery
            .start_packed_delivery(message, prop_hash, hops, packed, false)
        {
            let reason = err.error.to_string();
            tracing::warn!(
                prop = %prop_hex,
                error = %reason,
                "propagated link delivery start failed"
            );
            self.requeue_propagated_after_link_failure(
                router,
                event_tx,
                *err.message,
                prop_hash,
                &reason,
            );
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
        match self.try_requeue_via_propagation(router, event_tx, message) {
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
        let method = delivery_method_label(message.method);
        tracing::warn!(
            dest = %hex::encode(message.destination_hash),
            method,
            attempts = message.delivery_attempts,
            "LXMF outbound delivery failed"
        );
        if let Some(hash) = message.hash.or(message.message_id) {
            self.pn_fallback_attempted.remove(&hash);
            let _ = router.mark_outbound_failed(&hash);
            emit_outbound_status_by_hash(event_tx, &hash, "failed", Some(method));
        }
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

    /// After Direct link failure, deposit once via preferred remote PN (Ratspeak parity).
    /// Returns `Ok(())` when re-queued as Propagated; `Err(message)` when caller should fail.
    fn try_requeue_via_propagation(
        &mut self,
        router: &mut LxmRouter,
        event_tx: &broadcast::Sender<String>,
        mut message: LxMessage,
    ) -> Result<(), Box<LxMessage>> {
        if !should_fallback_direct_to_pn(
            message.method,
            router.outbound_propagation_node,
            &self.self_lxmf_hash,
            message
                .hash
                .or(message.message_id)
                .is_some_and(|h| self.pn_fallback_attempted.contains(&h)),
        ) {
            return Err(Box::new(message));
        }
        let Some(msg_hash) = message.hash.or(message.message_id) else {
            return Err(Box::new(message));
        };
        // Quietly drop any leftover Direct queue entry (already removed for most Fail paths).
        router
            .pending_outbound
            .retain(|m| m.hash != Some(msg_hash) && m.message_id != Some(msg_hash));
        self.remember_pn_fallback(msg_hash);
        message.method = DeliveryMethod::Propagated;
        message.delivery_attempts = 0;
        message.next_delivery_attempt = 0.0;
        tracing::info!(
            dest = %hex::encode(message.destination_hash),
            msg = %hex::encode(msg_hash),
            "LXMF Direct failed; falling back to preferred remote propagation node"
        );
        router.send(message);
        emit_outbound_status_with_via(
            event_tx,
            Some(serde_json::Value::String(hex::encode(msg_hash))),
            None,
            "sending",
            Some("propagated"),
            None,
        );
        Ok(())
    }

    fn remember_pn_fallback(&mut self, msg_hash: [u8; 32]) {
        if self.pn_fallback_attempted.len() >= PN_FALLBACK_ATTEMPTED_MAX {
            // Evict an arbitrary entry so floods cannot grow unbounded.
            if let Some(oldest) = self.pn_fallback_attempted.iter().next().copied() {
                self.pn_fallback_attempted.remove(&oldest);
            }
        }
        self.pn_fallback_attempted.insert(msg_hash);
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
                    let method = if self.pn_fallback_attempted.contains(&hash) {
                        Some("propagated")
                    } else {
                        None
                    };
                    self.pn_fallback_attempted.remove(&hash);
                    let _ = router.mark_outbound_delivered(&hash);
                    emit_outbound_status_by_hash(event_tx, &hash, "delivered", method);
                }
            }
            DeliveryResult::Rejected {
                message, reason, ..
            } => {
                tracing::warn!(
                    dest = %hex::encode(message.destination_hash),
                    method = %delivery_method_label(message.method),
                    reason = %reason,
                    "LXMF delivery Rejected"
                );
                // Peer/PN rejected the resource — do not retry; only Direct→PN once.
                match self.try_requeue_via_propagation(router, event_tx, message) {
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
                tracing::warn!(
                    dest = %hex::encode(message.destination_hash),
                    link_dest = %hex::encode(dest_hash),
                    method = %delivery_method_label(message.method),
                    reason = %reason,
                    attempts = message.delivery_attempts,
                    "LXMF delivery Failed"
                );
                // lxmd parity: Propagated "link closed"/timeout stay eligible for rediscovery.
                if should_retry_propagated_link_failure(
                    message.method,
                    &reason,
                    message.delivery_attempts,
                ) {
                    self.requeue_propagated_after_link_failure(
                        router, event_tx, message, dest_hash, &reason,
                    );
                    return;
                }
                match self.try_requeue_via_propagation(router, event_tx, message) {
                    Ok(()) => {}
                    Err(message) => self.emit_outbound_failed(router, event_tx, *message),
                }
            }
        }
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
        message.next_delivery_attempt = now + PATH_REQUEST_WAIT as f64;
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
            // Keep chat UI in sending/propagated while PN rediscovery proceeds.
            emit_outbound_status_with_via(
                event_tx,
                Some(serde_json::Value::String(hex::encode(hash))),
                None,
                "sending",
                Some("propagated"),
                None,
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
    message.next_delivery_attempt = now + DELIVERY_RETRY_WAIT as f64;
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

/// Whether a failed Direct attempt may be re-queued once via preferred remote PN.
pub(crate) fn should_fallback_direct_to_pn(
    method: DeliveryMethod,
    preferred_pn: Option<[u8; 16]>,
    self_lxmf_hash_hex: &str,
    already_fallback: bool,
) -> bool {
    if already_fallback || method != DeliveryMethod::Direct {
        return false;
    }
    let Some(pn) = preferred_pn else {
        return false;
    };
    let pn_hex = hex::encode(pn);
    // Local / self PN is an offline inbox — not a network store for unreachable peers.
    if pn_hex.eq_ignore_ascii_case(self_lxmf_hash_hex.trim()) {
        return false;
    }
    true
}

/// Cap on retained destination public keys (announce / path flood bound).
const MAX_KNOWN_IDENTITIES: usize = 4096;

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
        driver.update_path_table(&[(dest_hash, 5, dest_hex.clone())]);
        assert!(driver.has_path_to(&dest_hex));

        // Force refresh: drop local cache (transport DropPath happens in live.rs).
        driver.clear_path_to(&dest_hex);
        assert!(!driver.has_path_to(&dest_hex));

        // Fresh route response reinstalls with updated hops.
        driver.update_path_table(&[(dest_hash, 2, dest_hex.clone())]);
        assert!(driver.has_path_to(&dest_hex));
        assert_eq!(driver.route_hops.get(&dest_hash).copied(), Some(2));
    }

    #[test]
    fn path_gate_warn_is_rate_limited() {
        let mut gate = PathRequestGate::new();
        assert!(gate.should_warn(dest(4), 100.0));
        assert!(!gate.should_warn(dest(4), 110.0));
        assert!(gate.should_warn(dest(4), 121.0));
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
    fn should_fallback_direct_to_pn_when_remote_preferred() {
        let remote = [0x47u8; 16];
        assert!(should_fallback_direct_to_pn(
            DeliveryMethod::Direct,
            Some(remote),
            &"aa".repeat(16),
            false,
        ));
    }

    #[test]
    fn should_fallback_direct_to_pn_rejects_local_self_pn() {
        let self_hash = [0x09u8; 16];
        assert!(!should_fallback_direct_to_pn(
            DeliveryMethod::Direct,
            Some(self_hash),
            &hex::encode(self_hash),
            false,
        ));
    }

    #[test]
    fn should_fallback_direct_to_pn_rejects_propagated_and_repeat() {
        let remote = [0x47u8; 16];
        assert!(!should_fallback_direct_to_pn(
            DeliveryMethod::Propagated,
            Some(remote),
            &"aa".repeat(16),
            false,
        ));
        assert!(!should_fallback_direct_to_pn(
            DeliveryMethod::Direct,
            Some(remote),
            &"aa".repeat(16),
            true,
        ));
        assert!(!should_fallback_direct_to_pn(
            DeliveryMethod::Direct,
            None,
            &"aa".repeat(16),
            false,
        ));
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
}
