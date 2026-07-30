//! Network-visible LXMF propagation-node serve path (`/offer` + `/get`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lxmf_core::handlers::PropagationRequestHandler;
use lxmf_core::propagation_node::PropagationNode;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_runtime::link_manager::{LinkManager, register_destination};
use rns_transport::messages::TransportMessage;
use tokio::sync::mpsc;

pub const LXMF_PROPAGATION_APP: &str = "lxmf.propagation";

/// Owns the inbound LinkManager task for local PN hosting.
pub struct PropagationServeHandle {
    active: AtomicBool,
    stop_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
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
            let _ = tx.send(());
        }
    }

    /// Register `lxmf.propagation` and spawn LinkManager with `/offer` + `/get` handlers.
    pub fn start(
        &self,
        transport_tx: &mpsc::Sender<TransportMessage>,
        identity: &Identity,
        propagation_dest_hash: [u8; 16],
        local_node: Arc<Mutex<PropagationNode>>,
    ) -> Result<(), String> {
        self.stop();

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

        let (resource_tx, _resource_rx) = mpsc::channel::<(Vec<u8>, [u8; 16])>(256);
        prop_link_mgr.set_resource_completed_channel(resource_tx);

        let pn_for_handler = local_node;
        let offer_path_hash =
            rns_crypto::sha::truncated_hash(lxmf_core::constants::OFFER_REQUEST_PATH.as_bytes());
        let get_path_hash =
            rns_crypto::sha::truncated_hash(lxmf_core::constants::MESSAGE_GET_PATH.as_bytes());
        let link_identities = prop_link_mgr.link_identities_handle();
        let local_identity_hash = identity.hash;
        prop_link_mgr.set_request_handler(move |link_id, path_hash, data| {
            let remote_identity_hash = link_identities
                .lock()
                .ok()
                .and_then(|ids| ids.get(&link_id).copied());
            let remote_identity_ref = remote_identity_hash.as_ref();
            let client_dest_hash = remote_identity_hash
                .map(|identity_hash| {
                    Destination::hash_from_name_and_identity("lxmf.delivery", Some(&identity_hash))
                })
                .unwrap_or([0; 16]);
            let handler = PropagationRequestHandler::new(local_identity_hash);
            if path_hash == offer_path_hash {
                tracing::info!(target: "propagation-serve", "handling /offer request");
                let Ok(mut node) = pn_for_handler.lock() else {
                    tracing::warn!(
                        target: "propagation-serve",
                        "pn lock failed; dropping /offer request"
                    );
                    return None;
                };
                Some(handler.handle_offer_request(remote_identity_ref, &data, &mut node))
            } else if path_hash == get_path_hash {
                tracing::info!(target: "propagation-serve", "handling /get request");
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
                Some(action.into_response())
            } else {
                tracing::debug!(
                    target: "propagation-serve",
                    path = %hex::encode(path_hash),
                    "unknown request path"
                );
                None
            }
        });

        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        if let Ok(mut slot) = self.stop_tx.lock() {
            *slot = Some(stop_tx);
        }
        self.active.store(true, Ordering::SeqCst);

        tokio::spawn(async move {
            tokio::select! {
                () = prop_link_mgr.run() => {
                    tracing::warn!(
                        target: "propagation-serve",
                        "LinkManager run completed unexpectedly (not stop-requested)"
                    );
                }
                _ = &mut stop_rx => {
                    tracing::info!(target: "propagation-serve", "LinkManager stop requested");
                }
            }
        });

        Ok(())
    }
}

impl Default for PropagationServeHandle {
    fn default() -> Self {
        Self::new()
    }
}
