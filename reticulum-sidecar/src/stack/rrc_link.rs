//! Persistent initiator Link for RRC (HELLO/WELCOME over encrypted Link packets).
//!
//! Uses [`rns_runtime::link_session::LinkSession`] so LRRTT / LINKIDENTIFY / app
//! data are sent on a `BindLinkEndpoint`-pinned initiator path. Raw `Outbound`
//! after LRPROOF without that bind is dropped by transport as unroutable.

use std::sync::Arc;
use std::time::Duration;

use rns_identity::identity::Identity;
use rns_runtime::destination_resolver::DestinationResolveOptions;
use rns_runtime::link_session::{
    LinkSession, LinkSessionCloseReason, LinkSessionConfig, LinkSessionError, LinkSessionEvent,
    discover_destination,
};
use rns_transport::messages::{TransportMessage, TransportQuery, TransportQueryResponse};
use thiserror::Error;
use tokio::sync::{Semaphore, mpsc, oneshot};
use tracing::{debug, warn};

const PATH_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
/// Match rrc-web / rrcd default max_resource_bytes (256 KiB).
const MAX_RRC_RESOURCE_BYTES: usize = 262_144;
/// Match rrcd default max_pending and session `pending_resources` queue cap.
pub(crate) const MAX_CONCURRENT_RRC_RESOURCES: usize = 8;

#[derive(Debug, Error)]
pub enum RrcLinkError {
    #[error("transport channel closed or full")]
    TransportUnavailable,
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
    #[error("could not discover remote identity public key")]
    PubkeyNotDiscovered,
    #[error("link proof validation failed: {0}")]
    ProofInvalid(String),
    #[error("link establishment failed: {0}")]
    HandshakeFailed(String),
    #[error("local identity has no signing key")]
    NoSigningKey,
    #[error("encryption failure: {0}")]
    LinkCrypto(String),
    #[error("link is closed")]
    Closed,
    /// Frame rejected or deferred (size / resource / pending limits) — not a link teardown.
    #[error("link send not accepted ({0})")]
    SendNotAccepted(&'static str),
}

pub enum RrcLinkEvent {
    Data(Vec<u8>),
    /// Completed inbound RNS Resource payload (rrcd NOTICE/MOTD over RESOURCE_ENVELOPE).
    ResourcePayload {
        data: Vec<u8>,
    },
    Closed {
        reason: String,
    },
}

pub struct RrcLinkHandle {
    cmd_tx: mpsc::Sender<RrcLinkCommand>,
    pub event_rx: mpsc::Receiver<RrcLinkEvent>,
    #[allow(dead_code)] // exposed for session correlation / debugging
    pub link_id: [u8; 16],
}

enum RrcLinkCommand {
    Send(Vec<u8>, oneshot::Sender<Result<(), RrcLinkError>>),
    Close(oneshot::Sender<()>),
}

impl RrcLinkHandle {
    pub async fn send(&self, plaintext: Vec<u8>) -> Result<(), RrcLinkError> {
        let (tx, rx) = oneshot::channel();
        self.cmd_tx
            .send(RrcLinkCommand::Send(plaintext, tx))
            .await
            .map_err(|_| RrcLinkError::Closed)?;
        rx.await.map_err(|_| RrcLinkError::Closed)?
    }

    pub async fn close(&self) {
        let (tx, rx) = oneshot::channel();
        if self.cmd_tx.send(RrcLinkCommand::Close(tx)).await.is_ok() {
            let _ = rx.await;
        }
    }
}

/// How aggressively to rediscover the hub path before opening the Link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RrcPathRefresh {
    /// RequestPath even when identity is cached (fresh next-hop advertisement).
    Refresh,
    /// DropPath + RequestPath so LRPROOF can attach on a live interface after
    /// keepalive timeout / transport death (stale via pin otherwise keeps failing).
    DropAndRefresh,
}

pub async fn open_rrc_link_with_path_refresh(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    dest_hash: [u8; 16],
    hops: u8,
    path_refresh: RrcPathRefresh,
) -> Result<RrcLinkHandle, RrcLinkError> {
    refresh_hub_path(&transport_tx, dest_hash, path_refresh).await?;
    let entry = discover_destination(&transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT)
        .await
        .map_err(map_link_session_error)?;
    let pubkey = entry.public_key.ok_or(RrcLinkError::PubkeyNotDiscovered)?;

    let config = LinkSessionConfig {
        destination_hash: dest_hash,
        remote_public_key: pubkey,
        hops,
        establishment_timeout: HANDSHAKE_TIMEOUT,
        client_label: "rrc.link".into(),
        identify: true,
        track_phy_stats: false,
    };

    let session = LinkSession::connect(transport_tx, identity, config)
        .await
        .map_err(map_link_session_error)?;

    let link_id = session.handle.link_id();
    let handle = session.handle;
    let mut events = session.events;
    let mut resource_offers = session.resource_offers;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<RrcLinkCommand>(32);
    let (event_tx, event_rx) = mpsc::channel::<RrcLinkEvent>(128);
    let resource_slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RRC_RESOURCES));

    tokio::spawn(async move {
        loop {
            // Prefer link session events over resource-offer channel close so a
            // real Closed { timeout|remote_close|… } is not mislabeled when the
            // session actor exits (drops offer_tx right after sending Closed).
            tokio::select! {
                biased;
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(RrcLinkCommand::Send(plaintext, reply)) => {
                            let result = match handle.send_packet(plaintext).await {
                                Ok(_) => Ok(()),
                                Err(e) => Err(map_link_session_error(e)),
                            };
                            let _ = reply.send(result);
                        }
                        Some(RrcLinkCommand::Close(reply)) => {
                            handle.close().await;
                            let _ = reply.send(());
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "local_close".into(),
                                })
                                .await;
                            return;
                        }
                        None => {
                            handle.close().await;
                            return;
                        }
                    }
                }
                ev = events.recv() => {
                    match ev {
                        Some(LinkSessionEvent::Packet { data, .. }) => {
                            if !data.is_empty()
                                && event_tx.send(RrcLinkEvent::Data(data)).await.is_err()
                            {
                                handle.close().await;
                                return;
                            }
                        }
                        Some(LinkSessionEvent::Closed { reason }) => {
                            let label = close_reason_label(reason);
                            debug!(
                                link_id = %hex::encode(link_id),
                                reason = label,
                                "rrc link closed"
                            );
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: label.into(),
                                })
                                .await;
                            return;
                        }
                        Some(LinkSessionEvent::Stale) => {
                            debug!(link_id = %hex::encode(link_id), "rrc link stale");
                        }
                        Some(LinkSessionEvent::Recovered) => {
                            debug!(link_id = %hex::encode(link_id), "rrc link recovered from stale");
                        }
                        Some(_) => {}
                        None => {
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "session_ended".into(),
                                })
                                .await;
                            return;
                        }
                    }
                }
                offer = resource_offers.recv() => {
                    let Some(offer) = offer else {
                        let reason = closed_reason_after_offers_ended(&mut events);
                        debug!(
                            link_id = %hex::encode(link_id),
                            reason = %reason,
                            "rrc link offers channel ended"
                        );
                        let _ = event_tx
                            .send(RrcLinkEvent::Closed { reason })
                            .await;
                        return;
                    };
                    let size = offer.data_size();
                    if size == 0 || size > MAX_RRC_RESOURCE_BYTES {
                        let _ = offer.reject().await;
                        continue;
                    }
                    let Ok(permit) = resource_slots.clone().try_acquire_owned() else {
                        let _ = offer.reject().await;
                        continue;
                    };
                    match offer.accept().await {
                        Ok(inbound) => {
                            let tx = event_tx.clone();
                            tokio::spawn(async move {
                                let _permit = permit;
                                match inbound.concluded().await {
                                    Ok(received) => {
                                        let _ = tx
                                            .send(RrcLinkEvent::ResourcePayload {
                                                data: received.data,
                                            })
                                            .await;
                                    }
                                    Err(e) => {
                                        warn!("rrc inbound resource failed: {e}");
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            drop(permit);
                            debug!("rrc resource offer accept failed: {e}");
                        }
                    }
                }
            }
        }
    });

    Ok(RrcLinkHandle {
        cmd_tx,
        event_rx,
        link_id,
    })
}

/// When the resource-offers receiver ends, prefer an already-queued session
/// `Closed` reason over the synthetic `resource_offers_closed` label.
fn closed_reason_after_offers_ended(events: &mut mpsc::Receiver<LinkSessionEvent>) -> String {
    while let Ok(ev) = events.try_recv() {
        if let Some(reason) = closed_reason_from_session_event(&ev) {
            return reason;
        }
    }
    "resource_offers_closed".into()
}

fn closed_reason_from_session_event(ev: &LinkSessionEvent) -> Option<String> {
    match ev {
        LinkSessionEvent::Closed { reason } => Some(close_reason_label(*reason).into()),
        _ => None,
    }
}

fn close_reason_label(reason: LinkSessionCloseReason) -> &'static str {
    match reason {
        LinkSessionCloseReason::Local => "local_close",
        LinkSessionCloseReason::Remote => "remote_close",
        LinkSessionCloseReason::Timeout => "timeout",
        LinkSessionCloseReason::TransportUnavailable => "transport_error",
    }
}

/// True when a disconnect reason means the prior path/iface is suspect and the
/// next establish should DropPath before rediscovery.
pub fn rrc_disconnect_should_drop_path(reason: &str) -> bool {
    matches!(
        reason,
        "timeout" | "transport_error" | "resource_offers_closed" | "session_ended" | "remote_close"
    )
}

async fn refresh_hub_path(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    mode: RrcPathRefresh,
) -> Result<(), RrcLinkError> {
    let mut options = DestinationResolveOptions::new(PATH_LOOKUP_TIMEOUT);
    options.refresh_cached_path = true;
    if mode == RrcPathRefresh::DropAndRefresh {
        options.drop_existing_path = true;
        // When identity is already cached, resolve_destination returns early
        // after RequestPath only — still DropPath so a dead via cannot stick.
        let (response_tx, response_rx) = oneshot::channel();
        transport_tx
            .send(TransportMessage::Rpc {
                query: TransportQuery::DropPath { dest: dest_hash },
                response_tx,
            })
            .await
            .map_err(|_| RrcLinkError::TransportUnavailable)?;
        match response_rx.await {
            Ok(TransportQueryResponse::Ok) => {
                debug!(
                    dest = %hex::encode(dest_hash),
                    "rrc DropPath before reconnect establish"
                );
            }
            Ok(_) => {
                debug!(
                    dest = %hex::encode(dest_hash),
                    "rrc DropPath returned unexpected response; continuing"
                );
            }
            Err(_) => return Err(RrcLinkError::TransportUnavailable),
        }
    }
    // Fire RequestPath via resolve options when identity is missing; when
    // identity is cached, refresh_cached_path still emits RequestPath.
    let _ = rns_runtime::destination_resolver::resolve_destination_on_transport(
        transport_tx,
        dest_hash,
        options,
    )
    .await
    .map_err(|e| map_resolve_error(&e))?;
    Ok(())
}

fn map_resolve_error(
    e: &rns_runtime::destination_resolver::DestinationResolveError,
) -> RrcLinkError {
    use rns_runtime::destination_resolver::DestinationResolveError as E;
    match e {
        E::Timeout => RrcLinkError::Timeout("destination identity"),
        E::TransportUnavailable => RrcLinkError::TransportUnavailable,
        E::UnexpectedResponse(op) => {
            RrcLinkError::HandshakeFailed(format!("unexpected transport response during {op}"))
        }
    }
}

fn map_link_session_error(e: LinkSessionError) -> RrcLinkError {
    match e {
        LinkSessionError::TransportUnavailable => RrcLinkError::TransportUnavailable,
        LinkSessionError::Timeout(what) => RrcLinkError::Timeout(what),
        LinkSessionError::PublicKeyUnavailable => RrcLinkError::PubkeyNotDiscovered,
        LinkSessionError::ProofInvalid(msg) => RrcLinkError::ProofInvalid(msg),
        LinkSessionError::HandshakeFailed(msg) => RrcLinkError::HandshakeFailed(msg),
        LinkSessionError::IdentificationUnavailable => RrcLinkError::NoSigningKey,
        LinkSessionError::LinkCrypto => RrcLinkError::LinkCrypto("link crypto".into()),
        LinkSessionError::LinkNotActive | LinkSessionError::SessionClosed => RrcLinkError::Closed,
        LinkSessionError::PayloadTooLarge { .. } => {
            RrcLinkError::SendNotAccepted("payload_too_large")
        }
        LinkSessionError::RequestRequiresResource { .. } => {
            RrcLinkError::SendNotAccepted("requires_resource")
        }
        LinkSessionError::RequestResourceFailed(_) => {
            RrcLinkError::SendNotAccepted("resource_failed")
        }
        LinkSessionError::TooManyPendingRequests => {
            RrcLinkError::SendNotAccepted("too_many_pending")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn excess_resource_offers_rejected_when_slots_full() {
        let sem = Arc::new(Semaphore::new(MAX_CONCURRENT_RRC_RESOURCES));
        let mut permits = Vec::new();
        for _ in 0..MAX_CONCURRENT_RRC_RESOURCES {
            permits.push(sem.clone().try_acquire_owned().expect("slot"));
        }
        assert!(sem.try_acquire_owned().is_err());
    }

    #[tokio::test]
    async fn closed_reason_prefers_queued_timeout_over_offers_label() {
        let (tx, mut rx) = mpsc::channel::<LinkSessionEvent>(4);
        tx.send(LinkSessionEvent::Stale).await.unwrap();
        tx.send(LinkSessionEvent::Closed {
            reason: LinkSessionCloseReason::Timeout,
        })
        .await
        .unwrap();
        drop(tx);
        assert_eq!(closed_reason_after_offers_ended(&mut rx), "timeout");
    }

    #[tokio::test]
    async fn closed_reason_falls_back_when_no_closed_event() {
        let (tx, mut rx) = mpsc::channel::<LinkSessionEvent>(4);
        tx.send(LinkSessionEvent::Stale).await.unwrap();
        drop(tx);
        assert_eq!(
            closed_reason_after_offers_ended(&mut rx),
            "resource_offers_closed"
        );
    }

    #[tokio::test]
    async fn closed_reason_prefers_transport_error() {
        let (tx, mut rx) = mpsc::channel::<LinkSessionEvent>(1);
        tx.send(LinkSessionEvent::Closed {
            reason: LinkSessionCloseReason::TransportUnavailable,
        })
        .await
        .unwrap();
        drop(tx);
        assert_eq!(closed_reason_after_offers_ended(&mut rx), "transport_error");
    }

    #[test]
    fn disconnect_reasons_that_need_path_drop() {
        assert!(rrc_disconnect_should_drop_path("timeout"));
        assert!(rrc_disconnect_should_drop_path("transport_error"));
        assert!(rrc_disconnect_should_drop_path("resource_offers_closed"));
        assert!(!rrc_disconnect_should_drop_path("local_close"));
        assert!(!rrc_disconnect_should_drop_path("local_disconnect"));
    }

    #[test]
    fn closed_reason_from_session_event_maps_labels() {
        assert_eq!(
            closed_reason_from_session_event(&LinkSessionEvent::Closed {
                reason: LinkSessionCloseReason::Remote,
            })
            .as_deref(),
            Some("remote_close")
        );
        assert!(closed_reason_from_session_event(&LinkSessionEvent::Stale).is_none());
    }
}
