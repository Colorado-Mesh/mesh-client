//! Persistent initiator Link for RRC (keeps Link open for bidirectional CBOR frames).

use std::sync::Arc;
use std::time::{Duration, Instant};

use bytes::Bytes;
use rns_crypto::ed25519::Ed25519PublicKey;
use rns_identity::identity::Identity;
use rns_link::constants::KEEPALIVE_REQUEST;
use rns_link::link::{CloseReason, Link, LinkAction};
use rns_transport::await_path::{AwaitPathError, await_path};
use rns_transport::link_messages::DestinationEvent;
use rns_transport::messages::{
    AnnounceHandlerEvent, OutboundRequest, TransportMessage, TransportQuery, TransportQueryResponse,
};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

const PATH_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const TICK_INTERVAL: Duration = Duration::from_secs(5);

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

/// Deregisters a destination hash if dropped before the link task takes ownership.
/// Failure point: handshake error after `RegisterDestination`. Fallback: Drop
/// sends `DeregisterDestination`. Logging: best-effort try_send (no log).
struct DestinationRegistrationGuard {
    transport_tx: mpsc::Sender<TransportMessage>,
    link_id: [u8; 16],
    armed: bool,
}

impl DestinationRegistrationGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for DestinationRegistrationGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let _ = self
            .transport_tx
            .try_send(TransportMessage::DeregisterDestination { hash: self.link_id });
    }
}

pub async fn open_rrc_link(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    dest_hash: [u8; 16],
    hops: u8,
) -> Result<RrcLinkHandle, RrcLinkError> {
    let identity = Arc::new(identity);
    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;

    let pubkey = discover_remote_public_key(&transport_tx, dest_hash, deadline).await?;

    let (mut link, request_data) = Link::new_initiator(dest_hash, hops);
    let link_id = link.link_id;

    let (dest_tx, mut dest_rx) = mpsc::channel::<DestinationEvent>(128);
    send_msg(
        &transport_tx,
        TransportMessage::RegisterDestination {
            hash: link_id,
            app_name: "rrc.link".to_string(),
            delivery_tx: Some(dest_tx),
        },
    )
    .await?;
    // Failure point: handshake/send after RegisterDestination. Fallback: Drop
    // deregisters so a cancelled or failed establish does not leak a destination.
    let mut registration = DestinationRegistrationGuard {
        transport_tx: transport_tx.clone(),
        link_id,
        armed: true,
    };

    let req_pkt = build_link_request_packet(dest_hash, &request_data);
    send_msg(
        &transport_tx,
        TransportMessage::Outbound(OutboundRequest {
            raw: req_pkt,
            destination_hash: dest_hash,
        }),
    )
    .await?;

    let proof_data = wait_for_proof(&mut dest_rx, link_id, time_remaining(deadline)?).await?;

    let identity_ed25519_pub: [u8; 32] = pubkey[32..64]
        .try_into()
        .map_err(|_| RrcLinkError::ProofInvalid("remote public key is not 64 bytes".into()))?;
    let identity_verify_key = Ed25519PublicKey::from_bytes(&identity_ed25519_pub)
        .map_err(|e| RrcLinkError::ProofInvalid(format!("verify key: {e}")))?;

    let rtt_data = link
        .validate_proof(&proof_data, &identity_verify_key, &identity_ed25519_pub)
        .map_err(|e| RrcLinkError::ProofInvalid(format!("{e:?}")))?;

    let rtt_pkt = build_data_packet(link_id, rns_wire::context::PacketContext::Lrrtt, &rtt_data);
    send_msg(
        &transport_tx,
        TransportMessage::Outbound(OutboundRequest {
            raw: rtt_pkt,
            destination_hash: link_id,
        }),
    )
    .await?;

    let our_pub = identity.get_public_key();
    let our_priv = identity
        .get_signing_key()
        .ok_or(RrcLinkError::NoSigningKey)?;
    let identify_data = link
        .identify(&our_pub, &our_priv)
        .map_err(|e| RrcLinkError::LinkCrypto(format!("identify: {e:?}")))?;
    let identify_pkt = build_data_packet(
        link_id,
        rns_wire::context::PacketContext::LinkIdentify,
        &identify_data,
    );
    send_msg(
        &transport_tx,
        TransportMessage::Outbound(OutboundRequest {
            raw: identify_pkt,
            destination_hash: link_id,
        }),
    )
    .await?;

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<RrcLinkCommand>(32);
    let (event_tx, event_rx) = mpsc::channel::<RrcLinkEvent>(128);
    let transport_for_task = transport_tx.clone();

    // Link task owns deregistration from here on.
    registration.disarm();

    tokio::spawn(async move {
        let mut tick = tokio::time::interval(TICK_INTERVAL);
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    match link.tick() {
                        LinkAction::None => {}
                        LinkAction::TransitionedToStale => {
                            // Match link_manager: initiator double-sends keepalive on stale.
                            send_keepalive_packet(&transport_for_task, link_id);
                        }
                        LinkAction::SendKeepalive => {
                            send_keepalive_packet(&transport_for_task, link_id);
                        }
                        LinkAction::SendTeardownAndClose(data) => {
                            let pkt = build_data_packet(
                                link_id,
                                rns_wire::context::PacketContext::LinkClose,
                                &data,
                            );
                            let _ = transport_for_task.try_send(TransportMessage::Outbound(
                                OutboundRequest {
                                    raw: pkt,
                                    destination_hash: link_id,
                                },
                            ));
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "timeout".into(),
                                })
                                .await;
                            return;
                        }
                        LinkAction::Closed(_) => {
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "timeout".into(),
                                })
                                .await;
                            return;
                        }
                    }
                }
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(RrcLinkCommand::Send(plaintext, reply)) => {
                            let result = match link.encrypt(&plaintext) {
                                Ok(cipher) => {
                                    let pkt = build_data_packet(
                                        link_id,
                                        rns_wire::context::PacketContext::None,
                                        &cipher,
                                    );
                                    let raw_len = pkt.len();
                                    let send_result = transport_for_task
                                        .send(TransportMessage::Outbound(OutboundRequest {
                                            raw: pkt,
                                            destination_hash: link_id,
                                        }))
                                        .await
                                        .map_err(|_| RrcLinkError::TransportUnavailable);
                                    if send_result.is_ok() {
                                        link.record_tx(raw_len);
                                    }
                                    send_result
                                }
                                Err(e) => Err(RrcLinkError::LinkCrypto(format!("{e:?}"))),
                            };
                            let _ = reply.send(result);
                        }
                        Some(RrcLinkCommand::Close(reply)) => {
                            let _ = send_close(&transport_for_task, &mut link).await;
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            let _ = reply.send(());
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "local_close".into(),
                                })
                                .await;
                            return;
                        }
                        None => {
                            let _ = send_close(&transport_for_task, &mut link).await;
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            return;
                        }
                    }
                }
                ev = dest_rx.recv() => {
                    match ev {
                        Some(DestinationEvent::LinkClosed { link_id: closed })
                            if closed == link_id =>
                        {
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "remote_close".into(),
                                })
                                .await;
                            return;
                        }
                        Some(DestinationEvent::InboundPacket { raw, .. }) => {
                            let Ok((header, data_offset)) =
                                rns_wire::header::PacketHeader::unpack(&raw)
                            else {
                                continue;
                            };
                            if header.destination_hash != link_id || raw.len() <= data_offset {
                                continue;
                            }
                            let body = &raw[data_offset..];
                            match header.context {
                                rns_wire::context::PacketContext::LinkClose => {
                                    if link.receive_teardown(body) {
                                        let _ = transport_for_task.try_send(
                                            TransportMessage::DeregisterDestination {
                                                hash: link_id,
                                            },
                                        );
                                        let _ = event_tx
                                            .send(RrcLinkEvent::Closed {
                                                reason: "remote_teardown".into(),
                                            })
                                            .await;
                                        return;
                                    }
                                }
                                rns_wire::context::PacketContext::Keepalive => {
                                    // Keepalives are NOT encrypted (RNS Packet.py).
                                    // Must refresh inbound clock or the initiator
                                    // watchdog tears the link down as stale.
                                    link.record_inbound();
                                }
                                rns_wire::context::PacketContext::None => {
                                    if let Ok(plain) = link.decrypt(body) {
                                        link.record_inbound();
                                        link.record_rx(body.len());
                                        if !plain.is_empty()
                                            && event_tx
                                                .send(RrcLinkEvent::Data(plain))
                                                .await
                                                .is_err()
                                        {
                                            let _ = send_close(
                                                &transport_for_task,
                                                &mut link,
                                            )
                                            .await;
                                            let _ = transport_for_task.try_send(
                                                TransportMessage::DeregisterDestination {
                                                    hash: link_id,
                                                },
                                            );
                                            return;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        Some(_) => {}
                        None => {
                            let _ = send_close(&transport_for_task, &mut link).await;
                            let _ = transport_for_task.try_send(
                                TransportMessage::DeregisterDestination { hash: link_id },
                            );
                            let _ = event_tx
                                .send(RrcLinkEvent::Closed {
                                    reason: "channel_closed".into(),
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

async fn discover_remote_public_key(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    deadline: Instant,
) -> Result<[u8; 64], RrcLinkError> {
    let path_budget = PATH_LOOKUP_TIMEOUT.min(time_remaining(deadline)?);

    if let Some(pubkey) = recall_destination_public_key(transport_tx, dest_hash).await? {
        match await_path(transport_tx, dest_hash, path_budget).await {
            Ok(()) => return Ok(pubkey),
            Err(AwaitPathError::Timeout) => return Err(RrcLinkError::Timeout("path lookup")),
            Err(AwaitPathError::TransportDown) => return Err(RrcLinkError::TransportUnavailable),
        }
    }

    let (ann_tx, mut ann_rx) = mpsc::channel::<AnnounceHandlerEvent>(64);
    send_msg(
        transport_tx,
        TransportMessage::RegisterAnnounceHandler {
            aspect_filter: Some(super::rrc_defaults::RRC_HUB_ASPECT.to_string()),
            receive_path_responses: true,
            callback_tx: ann_tx,
        },
    )
    .await?;

    let discovery = async {
        send_msg(
            transport_tx,
            TransportMessage::RequestPath {
                destination_hash: dest_hash,
            },
        )
        .await?;
        let fut = async {
            while let Some(ev) = ann_rx.recv().await {
                if ev.destination_hash == dest_hash {
                    if let Some(pk) = ev.public_key {
                        return Ok(pk);
                    }
                }
            }
            Err(RrcLinkError::PubkeyNotDiscovered)
        };
        timeout(time_remaining(deadline)?, fut)
            .await
            .map_err(|_| RrcLinkError::Timeout("path/announce discovery"))?
    }
    .await;

    drop(ann_rx);
    let _ = transport_tx.try_send(TransportMessage::DeregisterAnnounceHandler {
        aspect_filter: None,
    });
    discovery
}

async fn recall_destination_public_key(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
) -> Result<Option<[u8; 64]>, RrcLinkError> {
    let (response_tx, response_rx) = oneshot::channel();
    send_msg(
        transport_tx,
        TransportMessage::Rpc {
            query: TransportQuery::RecallDestinationPublicKey { dest: dest_hash },
            response_tx,
        },
    )
    .await?;
    match timeout(Duration::from_secs(5), response_rx).await {
        Ok(Ok(TransportQueryResponse::PublicKeyResult(pk))) => Ok(pk),
        Ok(Ok(_)) => Ok(None),
        Ok(Err(_)) => Err(RrcLinkError::TransportUnavailable),
        Err(_) => Err(RrcLinkError::Timeout("pubkey recall")),
    }
}

async fn wait_for_proof(
    rx: &mut mpsc::Receiver<DestinationEvent>,
    link_id: [u8; 16],
    deadline: Duration,
) -> Result<Vec<u8>, RrcLinkError> {
    let fut = async {
        while let Some(ev) = rx.recv().await {
            match ev {
                DestinationEvent::LinkClosed { link_id: closed_id } if closed_id == link_id => {
                    return Err(RrcLinkError::HandshakeFailed("link closed".into()));
                }
                DestinationEvent::InboundPacket { raw, .. } => {
                    let Ok((header, data_offset)) = rns_wire::header::PacketHeader::unpack(&raw)
                    else {
                        continue;
                    };
                    let is_proof = header.flags.packet_type == rns_wire::flags::PacketType::Proof
                        && header.destination_hash == link_id;
                    if is_proof && raw.len() > data_offset {
                        return Ok(raw[data_offset..].to_vec());
                    }
                }
                _ => {}
            }
        }
        Err(RrcLinkError::HandshakeFailed(
            "destination channel closed".into(),
        ))
    };
    timeout(deadline, fut)
        .await
        .map_err(|_| RrcLinkError::Timeout("link proof"))?
}

async fn send_close(
    transport_tx: &mpsc::Sender<TransportMessage>,
    link: &mut Link,
) -> Result<(), RrcLinkError> {
    let link_id = link.link_id;
    let Some(teardown_data) = link.teardown(CloseReason::InitiatorClosed) else {
        return Ok(());
    };
    let close_pkt = build_data_packet(
        link_id,
        rns_wire::context::PacketContext::LinkClose,
        &teardown_data,
    );
    send_msg(
        transport_tx,
        TransportMessage::Outbound(OutboundRequest {
            raw: close_pkt,
            destination_hash: link_id,
        }),
    )
    .await
}

/// Initiator keepalive: unencrypted CONTEXT_KEEPALIVE + 0xFF (matches link_manager).
fn send_keepalive_packet(transport_tx: &mpsc::Sender<TransportMessage>, link_id: [u8; 16]) {
    let pkt = build_data_packet(
        link_id,
        rns_wire::context::PacketContext::Keepalive,
        &[KEEPALIVE_REQUEST],
    );
    let _ = transport_tx.try_send(TransportMessage::Outbound(OutboundRequest {
        raw: pkt,
        destination_hash: link_id,
    }));
}

async fn send_msg(
    transport_tx: &mpsc::Sender<TransportMessage>,
    msg: TransportMessage,
) -> Result<(), RrcLinkError> {
    transport_tx
        .send(msg)
        .await
        .map_err(|_| RrcLinkError::TransportUnavailable)
}

fn time_remaining(deadline: Instant) -> Result<Duration, RrcLinkError> {
    let now = Instant::now();
    if now >= deadline {
        Err(RrcLinkError::Timeout("overall handshake"))
    } else {
        Ok(deadline - now)
    }
}

fn build_link_request_packet(dest_hash: [u8; 16], request_data: &[u8]) -> Bytes {
    let header = rns_wire::header::PacketHeader {
        flags: rns_wire::flags::PacketFlags {
            header_type: rns_wire::flags::HeaderType::Header1,
            context_flag: false,
            transport_type: rns_wire::flags::TransportType::Broadcast,
            destination_type: rns_wire::flags::DestinationType::Single,
            packet_type: rns_wire::flags::PacketType::LinkRequest,
        },
        hops: 0,
        transport_id: None,
        destination_hash: dest_hash,
        context: rns_wire::context::PacketContext::None,
    };
    let mut raw = header.pack();
    raw.extend_from_slice(request_data);
    Bytes::from(raw)
}

fn build_data_packet(
    link_id: [u8; 16],
    context: rns_wire::context::PacketContext,
    body: &[u8],
) -> Bytes {
    let header = rns_wire::header::PacketHeader {
        flags: rns_wire::flags::PacketFlags {
            header_type: rns_wire::flags::HeaderType::Header1,
            context_flag: false,
            transport_type: rns_wire::flags::TransportType::Broadcast,
            destination_type: rns_wire::flags::DestinationType::Link,
            packet_type: rns_wire::flags::PacketType::Data,
        },
        hops: 0,
        transport_id: None,
        destination_hash: link_id,
        context,
    };
    let mut raw = header.pack();
    raw.extend_from_slice(body);
    Bytes::from(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_guard_deregisters_when_armed() {
        let (tx, mut rx) = mpsc::channel::<TransportMessage>(4);
        {
            let _guard = DestinationRegistrationGuard {
                transport_tx: tx,
                link_id: [0xab; 16],
                armed: true,
            };
        }
        match rx.try_recv() {
            Ok(TransportMessage::DeregisterDestination { hash }) => {
                assert_eq!(hash, [0xab; 16]);
            }
            other => panic!("expected DeregisterDestination, got {other:?}"),
        }
    }

    #[test]
    fn registration_guard_skips_when_disarmed() {
        let (tx, mut rx) = mpsc::channel::<TransportMessage>(4);
        {
            let mut guard = DestinationRegistrationGuard {
                transport_tx: tx,
                link_id: [0xcd; 16],
                armed: true,
            };
            guard.disarm();
        }
        assert!(rx.try_recv().is_err());
    }
}
