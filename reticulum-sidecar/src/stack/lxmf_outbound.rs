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

pub struct LxmfOutboundDriver {
    transport_tx: mpsc::Sender<TransportMessage>,
    link_delivery: LinkDeliveryManager,
    route_hops: HashMap<[u8; 16], u8>,
    known_identities: HashMap<String, [u8; 32]>,
    path_table_hashes: HashSet<String>,
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
        Self {
            transport_tx: transport_tx.clone(),
            link_delivery: LinkDeliveryManager::new(
                transport_tx,
                Some(identity.get_public_key()),
                identity.get_signing_key(),
            ),
            route_hops: HashMap::new(),
            known_identities: HashMap::new(),
            path_table_hashes: HashSet::new(),
            self_lxmf_hash,
            self_display_name,
        }
    }

    pub fn set_propagation_node(&mut self, router: &mut LxmRouter, hash: Option<[u8; 16]>) {
        router.set_outbound_propagation_node(hash);
    }

    pub fn update_path_table(&mut self, entries: &[( [u8; 16], u8, String)]) {
        self.route_hops.clear();
        self.path_table_hashes.clear();
        for (hash, hops, hex_key) in entries {
            self.route_hops.insert(*hash, (*hops).max(1));
            self.path_table_hashes.insert(hex_key.clone());
        }
    }

    pub fn has_path_to(&self, destination_hex: &str) -> bool {
        self.path_table_hashes.contains(destination_hex)
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
                        identity_known: self.known_identities.contains_key(&dest_hex)
                            || self.route_hops.contains_key(&dest),
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
            self.execute_actions(router, actions);
        }

        router.run_jobs_tick();

        let results = self.link_delivery.tick();
        for result in results {
            self.handle_delivery_result(router, event_tx, result);
        }
    }

    fn execute_actions(&mut self, router: &mut LxmRouter, actions: Vec<OutboundAction>) {
        for action in actions {
            match action {
                OutboundAction::DeliverPropagated { message, prop_hash } => {
                    self.deliver_propagated(router, message, prop_hash);
                }
                OutboundAction::DeliverDirect { message, dest_hash } => {
                    self.deliver_direct(router, message, dest_hash, None);
                }
                OutboundAction::PlanDirect {
                    message,
                    dest_hash,
                    plan,
                } => {
                    self.deliver_direct(router, message, dest_hash, Some(plan));
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
                }
            }
        }
    }

    fn deliver_propagated(
        &mut self,
        router: &mut LxmRouter,
        mut message: LxMessage,
        prop_hash: [u8; 16],
    ) {
        let prop_hex = hex::encode(prop_hash);
        if !self.known_identities.contains_key(&prop_hex) {
            queue_path_request(&self.transport_tx, prop_hash, false, "propagation node path");
            router.send(message);
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
        mut message: LxMessage,
        dest_hash: [u8; 16],
        planned: Option<DirectDeliveryPlan>,
    ) {
        let dest_hex = hex::encode(dest_hash);
        let plan = planned.unwrap_or_else(|| {
            plan_direct_delivery(
                &mut message,
                DirectDeliveryPlanInput {
                    identity_known: self.known_identities.contains_key(&dest_hex)
                        || self.route_hops.contains_key(&dest_hash),
                    route: direct_route_snapshot(&self.route_hops, dest_hash),
                    reusable_link: direct_reusable_link_state(&self.link_delivery, dest_hash),
                },
                now_f64(),
            )
        });

        match plan {
            DirectDeliveryPlan::RequestPath { .. } | DirectDeliveryPlan::WaitForReusableLink => {
                queue_path_request(&self.transport_tx, dest_hash, false, "direct delivery path");
                router.send(message);
            }
            DirectDeliveryPlan::DeferTerminalFailure | DirectDeliveryPlan::Fail => {
                message.mark_failed();
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
        let pub_key = self.known_identities.get(dest_hash_hex)?;
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

fn queue_path_request(
    transport_tx: &mpsc::Sender<TransportMessage>,
    request_hash: [u8; 16],
    drop_existing: bool,
    reason: &str,
) {
    if drop_existing {
        let (response_tx, _response_rx) = tokio::sync::oneshot::channel();
        let _ = transport_tx.try_send(TransportMessage::Rpc {
            query: TransportQuery::DropPath { dest: request_hash },
            response_tx,
        });
    }
    if let Err(e) = transport_tx.try_send(TransportMessage::RequestPath {
        destination_hash: request_hash,
    }) {
        tracing::warn!(
            dest = %hex::encode(request_hash),
            error = %e,
            reason,
            "failed to queue path request for LXMF delivery"
        );
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
