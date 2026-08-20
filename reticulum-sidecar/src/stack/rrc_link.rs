//! Persistent initiator Link for RRC (HELLO/WELCOME over encrypted Link packets).
//!
//! Uses [`rns_runtime::link_session::LinkSession`] so LRRTT / LINKIDENTIFY / app
//! data are sent on a `BindLinkEndpoint`-pinned initiator path. Raw `Outbound`
//! after LRPROOF without that bind is dropped by transport as unroutable.

use std::time::Duration;

use rns_identity::identity::Identity;
use rns_runtime::link_session::{
    LinkSession, LinkSessionCloseReason, LinkSessionConfig, LinkSessionError, LinkSessionEvent,
    discover_destination,
};
use rns_transport::messages::TransportMessage;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};

const PATH_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

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
}

pub enum RrcLinkEvent {
    Data(Vec<u8>),
    Closed { reason: String },
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

pub async fn open_rrc_link(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    dest_hash: [u8; 16],
    hops: u8,
) -> Result<RrcLinkHandle, RrcLinkError> {
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

    // Resource offers are unused by RRC; drain so the channel cannot fill.
    tokio::spawn(async move { while resource_offers.recv().await.is_some() {} });

    tokio::spawn(async move {
        loop {
            tokio::select! {
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
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: close_reason_label(reason).into(),
                                })
                                .await;
                            return;
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
            }
        }
    });

    Ok(RrcLinkHandle {
        cmd_tx,
        event_rx,
        link_id,
    })
}

fn close_reason_label(reason: LinkSessionCloseReason) -> &'static str {
    match reason {
        LinkSessionCloseReason::Local => "local_close",
        LinkSessionCloseReason::Remote => "remote_close",
        LinkSessionCloseReason::Timeout => "timeout",
        LinkSessionCloseReason::TransportUnavailable => "transport_unavailable",
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
        LinkSessionError::LinkNotActive
        | LinkSessionError::SessionClosed
        | LinkSessionError::PayloadTooLarge { .. }
        | LinkSessionError::RequestRequiresResource { .. }
        | LinkSessionError::RequestResourceFailed(_)
        | LinkSessionError::TooManyPendingRequests => RrcLinkError::Closed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_link_session_timeout_preserves_label() {
        assert!(matches!(
            map_link_session_error(LinkSessionError::Timeout("link proof")),
            RrcLinkError::Timeout("link proof")
        ));
    }

    #[test]
    fn close_reason_labels_are_stable() {
        assert_eq!(
            close_reason_label(LinkSessionCloseReason::Remote),
            "remote_close"
        );
        assert_eq!(
            close_reason_label(LinkSessionCloseReason::Timeout),
            "timeout"
        );
    }
}
