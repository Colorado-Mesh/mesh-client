//! Network-visible LXMF propagation-node serve path (`/offer` + `/get` + Resource ingress).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lxmf_core::message::LxMessage;
use lxmf_core::propagation_admission::PnInboundAdmissionConfig;
use lxmf_core::propagation_node::PropagationNode;
use lxmf_core::stamper;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_runtime::link_manager::{LinkManager, LinkManagerCommand, register_destination};
use rns_runtime::prelude::{CloseReason, ResourceStrategy};
use rns_transport::messages::TransportMessage;
use tokio::sync::{mpsc, watch};

use super::pn_hosting_policy::PnHostingPolicy;
use super::pn_inbound::{
    PnInboundRuntime, PnValidationJob, PnValidationOutcome, logical_resource_id,
};

pub const LXMF_PROPAGATION_APP: &str = "lxmf.propagation";

/// Owns the inbound LinkManager task for local PN hosting.
pub struct PropagationServeHandle {
    active: AtomicBool,
    stop_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl PropagationServeHandle {
    pub fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            stop_tx: Mutex::new(None),
        }
    }

    pub fn stop(&self) {
        self.active.store(false, Ordering::SeqCst);
        if let Ok(mut slot) = self.stop_tx.lock()
            && let Some(tx) = slot.take()
        {
            let _ = tx.send(true);
        }
    }

    /// Register `lxmf.propagation` and spawn LinkManager with `/offer`, `/get`, and Resource ingress.
    ///
    /// `on_inbound_accepted` fires after at least one stamped blob is accepted into the
    /// local store (peer Resource ingress) so the live stack can drain our inbox into Chat.
    pub fn start(
        &self,
        transport_tx: &mpsc::Sender<TransportMessage>,
        identity: &Identity,
        propagation_dest_hash: [u8; 16],
        local_node: &Arc<Mutex<PropagationNode>>,
        policy: &PnHostingPolicy,
        on_inbound_accepted: Option<Arc<dyn Fn() + Send + Sync>>,
    ) -> Result<(), String> {
        self.stop();
        let local_node = Arc::clone(local_node);

        let delivery_rx =
            register_destination(transport_tx, propagation_dest_hash, LXMF_PROPAGATION_APP);

        let prop_signing_key = identity
            .get_signing_key()
            .ok_or_else(|| "propagation serve: identity has no signing key".to_string())?;

        let mut prop_link_mgr = LinkManager::with_destination(
            transport_tx.clone(),
            delivery_rx,
            identity,
            LXMF_PROPAGATION_APP,
            Some(prop_signing_key),
        );

        let static_peers = parse_static_peer_hashes(&policy.static_peers);
        let max_resource_bytes = policy.sync_limit_kb.saturating_mul(1000);
        let min_stamp_cost = policy.min_stamp_cost();
        let admission_config = PnInboundAdmissionConfig {
            sequential_validation: true,
            static_sequential: false,
            max_inbound_syncs: 4,
            from_static_only: policy.from_static_only,
        };
        let admission = Arc::new(Mutex::new(PnInboundRuntime::new(
            admission_config,
            static_peers,
            max_resource_bytes,
        )));

        prop_link_mgr.set_resource_strategy(ResourceStrategy::AcceptApp);

        let accept_link_identities = prop_link_mgr.link_identities_handle();
        let admission_for_resources = Arc::clone(&admission);
        prop_link_mgr.set_resource_accept_handler(move |link_id, advertisement| {
            let remote_identity_hash = accept_link_identities
                .lock()
                .ok()
                .and_then(|identities| identities.get(&link_id).copied());
            let resource_id = logical_resource_id(
                advertisement.resource_hash,
                advertisement.original_hash,
                advertisement.flags.split,
                advertisement.total_segments,
            );
            admission_for_resources
                .lock()
                .map(|mut runtime| {
                    runtime.accept_resource(
                        link_id,
                        resource_id,
                        advertisement.data_size,
                        remote_identity_hash,
                    )
                })
                .unwrap_or(false)
        });

        let (accounting_tx, mut accounting_rx) = mpsc::unbounded_channel();
        prop_link_mgr.set_accounting_event_channel(accounting_tx);

        let pn_for_handler = Arc::clone(&local_node);
        let offer_path_hash =
            rns_crypto::sha::truncated_hash(lxmf_core::constants::OFFER_REQUEST_PATH.as_bytes());
        let get_path_hash =
            rns_crypto::sha::truncated_hash(lxmf_core::constants::MESSAGE_GET_PATH.as_bytes());
        let link_identities = prop_link_mgr.link_identities_handle();
        let local_identity_hash = identity.hash;
        let admission_for_handler = Arc::clone(&admission);
        prop_link_mgr.set_request_handler(move |link_id, path_hash, data| {
            let remote_identity_hash = link_identities
                .lock()
                .ok()
                .and_then(|ids| ids.get(&link_id).copied());
            let remote_identity_ref = remote_identity_hash.as_ref();
            if path_hash == offer_path_hash {
                tracing::info!(target: "propagation-serve", "handling /offer request");
                return handle_pn_offer_request(
                    &admission_for_handler,
                    &pn_for_handler,
                    local_identity_hash,
                    link_id,
                    remote_identity_hash,
                    &data,
                );
            }
            if path_hash == get_path_hash {
                if admission_for_handler
                    .lock()
                    .map(|runtime| runtime.is_link_quarantined(&link_id))
                    .unwrap_or(true)
                {
                    return None;
                }
                tracing::info!(target: "propagation-serve", "handling /get request");
                let client_dest_hash = remote_identity_hash
                    .map(|identity_hash| {
                        Destination::hash_from_name_and_identity(
                            "lxmf.delivery",
                            Some(&identity_hash),
                        )
                    })
                    .unwrap_or([0; 16]);
                let handler =
                    lxmf_core::handlers::PropagationRequestHandler::new(local_identity_hash);
                let action = {
                    let Ok(mut node) = pn_for_handler.lock() else {
                        tracing::warn!(
                            target: "propagation-serve",
                            "pn lock failed; dropping /get request"
                        );
                        return None;
                    };
                    handler.handle_message_get_request(
                        remote_identity_ref,
                        &client_dest_hash,
                        &data,
                        &mut node,
                    )
                };
                return Some(action.into_response());
            }
            tracing::debug!(
                target: "propagation-serve",
                path = %hex::encode(path_hash),
                "unknown request path"
            );
            None
        });

        let (link_cmd_tx, link_cmd_rx) = mpsc::channel::<LinkManagerCommand>(256);
        let (stop_tx, stop_rx) = watch::channel(false);
        if let Ok(mut slot) = self.stop_tx.lock() {
            *slot = Some(stop_tx);
        }
        self.active.store(true, Ordering::SeqCst);

        let pn_hash_hex = hex::encode(propagation_dest_hash);
        let admission_for_loop = Arc::clone(&admission);
        let local_node_for_loop = Arc::clone(&local_node);
        let link_cmd_for_close = link_cmd_tx;
        let mut stop_rx_accounting = stop_rx.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    changed = stop_rx_accounting.changed() => {
                        if changed.is_err() || *stop_rx_accounting.borrow() {
                            break;
                        }
                    }
                    event = accounting_rx.recv() => {
                        let Some(event) = event else { break; };
                        let job = admission_for_loop
                            .lock()
                            .ok()
                            .and_then(|mut runtime| runtime.handle_accounting_event(event));
                        if let Some(job) = job {
                            spawn_propagation_validation(
                                job,
                                max_resource_bytes,
                                min_stamp_cost,
                                Arc::clone(&admission_for_loop),
                                Arc::clone(&local_node_for_loop),
                                pn_hash_hex.clone(),
                                link_cmd_for_close.clone(),
                                on_inbound_accepted.clone(),
                            );
                        }
                    }
                }
            }
            tracing::info!(target: "propagation-serve", "accounting loop stopped");
        });

        let mut stop_rx_link = stop_rx;
        tokio::spawn(async move {
            tokio::select! {
                () = prop_link_mgr.run_with_commands(link_cmd_rx) => {
                    tracing::warn!(
                        target: "propagation-serve",
                        "LinkManager run completed unexpectedly (not stop-requested)"
                    );
                }
                changed = stop_rx_link.changed() => {
                    let _ = changed;
                }
            }
            tracing::info!(target: "propagation-serve", "LinkManager stop requested");
        });

        Ok(())
    }
}

impl Default for PropagationServeHandle {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_static_peer_hashes(peers: &[String]) -> Vec<[u8; 16]> {
    peers
        .iter()
        .filter_map(|peer| {
            let bytes = hex::decode(peer.trim()).ok()?;
            <[u8; 16]>::try_from(bytes.as_slice()).ok()
        })
        .collect()
}

fn handle_pn_offer_request(
    runtime: &Arc<Mutex<PnInboundRuntime>>,
    node: &Arc<Mutex<PropagationNode>>,
    local_identity_hash: [u8; 16],
    link_id: [u8; 16],
    remote_identity_hash: Option<[u8; 16]>,
    data: &[u8],
) -> Option<Vec<u8>> {
    let candidate = runtime
        .lock()
        .ok()?
        .preflight_offer(link_id, remote_identity_hash);
    let candidate = match candidate {
        Ok(candidate) => candidate,
        Err(response) => return Some(PropagationNode::encode_offer_response(&response)),
    };

    let evaluation = if let Ok(node) = node.lock() {
        node.evaluate_offer_request(data, &local_identity_hash, &candidate)
    } else {
        if let Ok(mut runtime) = runtime.lock() {
            runtime.discard_offer(candidate);
        }
        return None;
    };

    match evaluation {
        Ok(evaluation) => {
            let response = match runtime.lock() {
                Ok(mut runtime) => match runtime.commit_offer(candidate, &evaluation) {
                    Ok(()) => evaluation.into_wire_response(),
                    Err(response) => response,
                },
                Err(_) => return None,
            };
            Some(PropagationNode::encode_offer_response(&response))
        }
        Err(error) => {
            if let Ok(mut runtime) = runtime.lock() {
                runtime.discard_offer(candidate);
            }
            Some(PropagationNode::encode_offer_response(
                &error.wire_response(),
            ))
        }
    }
}

struct ValidatedPnEntry {
    lxmf_data: Vec<u8>,
    stamp_value: u32,
    stamp_data: [u8; 32],
    transient_id: [u8; 32],
}

fn validate_pn_resource_job(
    job: PnValidationJob,
    max_transfer_bytes: usize,
    min_cost: u8,
) -> (PnValidationOutcome, Vec<ValidatedPnEntry>, usize) {
    let allow_multiple = job.allow_multiple();
    let data = job.into_data();

    let (_, entries) =
        match LxMessage::unpack_propagation_wrapper_bounded(&data, max_transfer_bytes) {
            Ok(parsed) => parsed,
            Err(error) => {
                tracing::warn!(
                    target: "propagation-deposit",
                    error = %error,
                    "failed to unpack propagation Resource"
                );
                return (PnValidationOutcome::Failed, Vec::new(), 0);
            }
        };

    if !allow_multiple && entries.len() > 1 {
        return (
            PnValidationOutcome::UnauthorizedMultiple,
            Vec::new(),
            entries.len(),
        );
    }

    let mut validated = Vec::with_capacity(entries.len());
    let mut rejected = 0usize;
    for entry in entries {
        match stamper::validate_pn_stamp(&entry, min_cost) {
            Some((transient_id, lxmf_data, stamp_value, stamp_data)) => {
                validated.push(ValidatedPnEntry {
                    lxmf_data,
                    stamp_value,
                    stamp_data,
                    transient_id,
                });
            }
            None => rejected += 1,
        }
    }

    let outcome = if rejected == 0 {
        PnValidationOutcome::Valid
    } else {
        PnValidationOutcome::InvalidStamp
    };
    (outcome, validated, rejected)
}

#[allow(clippy::too_many_arguments)] // validation job + admission + inbox drain hook
fn spawn_propagation_validation(
    job: PnValidationJob,
    max_transfer_bytes: usize,
    min_cost: u8,
    admission: Arc<Mutex<PnInboundRuntime>>,
    local_node: Arc<Mutex<PropagationNode>>,
    pn_hash_hex: String,
    link_cmd_tx: mpsc::Sender<LinkManagerCommand>,
    on_inbound_accepted: Option<Arc<dyn Fn() + Send + Sync>>,
) {
    let token = job.token();
    let link_id = job.link_id();
    tokio::spawn(async move {
        let (outcome, entries, rejected) = match tokio::task::spawn_blocking(move || {
            validate_pn_resource_job(job, max_transfer_bytes, min_cost)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(
                    target: "propagation-deposit",
                    link_id = %hex::encode(link_id),
                    error = %error,
                    "propagation validation worker failed"
                );
                (PnValidationOutcome::Failed, Vec::new(), 0)
            }
        };

        let claim = admission
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.conclude_validation(token, link_id, outcome));
        let Some(claim) = claim else {
            tracing::debug!(
                target: "propagation-deposit",
                link_id = %hex::encode(link_id),
                "ignoring stale or duplicate propagation validation result"
            );
            return;
        };

        let mut accepted = 0usize;
        let accept_local_node = Arc::clone(&local_node);
        let accept_pn_hash_hex = pn_hash_hex.clone();
        match tokio::task::spawn_blocking(move || {
            let mut accepted = 0usize;
            if let Ok(mut node) = accept_local_node.lock() {
                for entry in &entries {
                    let stamp_value = u8::try_from(entry.stamp_value).unwrap_or(u8::MAX);
                    if node.accept_stamped_propagated_blob(
                        &entry.lxmf_data,
                        &entry.stamp_data,
                        stamp_value,
                    ) {
                        accepted += 1;
                        tracing::info!(
                            target: "propagation-deposit",
                            pn_hash = %accept_pn_hash_hex,
                            transient_id = %hex::encode(entry.transient_id),
                            stamp_value,
                            blob_len = entry.lxmf_data.len(),
                            "local PN accepted stamped propagated blob"
                        );
                    }
                }
            }
            accepted
        })
        .await
        {
            Ok(count) => accepted = count,
            Err(error) => {
                tracing::warn!(
                    target: "propagation-deposit",
                    link_id = %hex::encode(link_id),
                    error = %error,
                    "propagation accept worker failed"
                );
            }
        }

        tracing::info!(
            target: "propagation-deposit",
            link_id = %hex::encode(claim.link_id()),
            pn_hash = %pn_hash_hex,
            accepted,
            rejected,
            outcome = ?claim.outcome(),
            "processed inbound propagation Resource"
        );

        if accepted > 0 {
            if let Some(ref on_accepted) = on_inbound_accepted {
                on_accepted();
            }
        }

        if claim.should_close_link() {
            let link_id = claim.link_id();
            let _ = link_cmd_tx
                .send(LinkManagerCommand::CloseLink {
                    link_id,
                    reason: CloseReason::DestinationClosed,
                    send_teardown: true,
                })
                .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_wires_resource_accept_and_consumes_accounting() {
        let src = include_str!("propagation_serve.rs");
        assert!(
            src.contains("set_resource_accept_handler"),
            "serve must install AcceptApp resource handler"
        );
        assert!(
            src.contains("set_accounting_event_channel"),
            "serve must drain accounting (ResourceCompletion)"
        );
        // Discarded channel binding used the unused-prefix form (underscore + resource_rx).
        let discarded = format!("_{}", "resource_rx");
        assert!(
            !src.contains(&discarded),
            "must not discard resource_rx; use accounting stream"
        );
        assert!(
            src.contains("accept_stamped_propagated_blob"),
            "validated deposits must enter PropagationNode store"
        );
        assert!(
            src.contains("on_inbound_accepted") && src.contains("accepted > 0"),
            "inbound peer accept must signal inbox drain for Chat delivery"
        );
        assert!(
            src.contains("evaluate_offer_request"),
            "/offer must go through admission + evaluate_offer_request"
        );
        assert!(
            src.contains("handle_pn_offer_request"),
            "/offer must use PnInboundAdmission preflight/commit"
        );
    }

    #[test]
    fn parse_static_peers_skips_invalid() {
        let peers = parse_static_peer_hashes(&[
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            "not-hex".into(),
            "bb".into(),
        ]);
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0], [0xaa; 16]);
    }

    #[test]
    fn stamped_blob_enters_shared_store_and_bad_stamp_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");

        let mut node = PropagationNode::with_storage(
            lxmf_core::propagation_node::PropagationNodeConfig {
                min_stamp_cost: 0,
                ..Default::default()
            },
            [0xAA; 16],
            dir.path().to_path_buf(),
        )
        .expect("node");

        let mut lxmf_data = vec![0xBB; 16];
        lxmf_data.extend_from_slice(&[0xCC; 64]);
        let stamp = [0x5A; 32];
        assert!(node.accept_stamped_propagated_blob(&lxmf_data, &stamp, 0));
        assert_eq!(node.message_count(), 1);

        // Truncated stamped entry fails validate_pn_stamp (needs ≥32-byte stamp trailer).
        let bad = validate_pn_resource_job(
            PnValidationJob::for_test(vec![0x01, 0x02, 0x03], false),
            10_000,
            0,
        );
        assert_eq!(bad.0, PnValidationOutcome::Failed);
        assert!(bad.1.is_empty());
    }
}
