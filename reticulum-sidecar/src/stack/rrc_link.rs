//! Persistent initiator Link for RRC (HELLO/WELCOME over encrypted Link packets).
//!
//! Uses [`rns_runtime::link_session::LinkSession`] so LRRTT / LINKIDENTIFY / app
//! data are sent on a `BindLinkEndpoint`-pinned initiator path. Raw `Outbound`
//! after LRPROOF without that bind is dropped by transport as unroutable.

use std::sync::Arc;
use std::time::Duration;

use rns_identity::identity::Identity;
use rns_runtime::destination_resolver::DestinationResolveOptions;
#[cfg(test)]
use rns_runtime::link_session::LinkSessionResourceOffer;
use rns_runtime::link_session::{
    LinkSession, LinkSessionCloseReason, LinkSessionConfig, LinkSessionError, LinkSessionEvent,
    discover_destination,
};
use rns_transport::messages::{
    PathTableRpcEntry, TransportMessage, TransportQuery, TransportQueryResponse,
};
use thiserror::Error;
use tokio::sync::{Semaphore, mpsc, oneshot};
use tracing::{debug, info, warn};

use super::path_failover::{
    self, PathSlotCandidate, VIA_FAILOVER_POLL_INTERVAL, VIA_FAILOVER_PROBE_WAIT,
    record_path_failover_attempt, select_unblocked_slot, via_prefix,
};

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
    /// Suppress the failed iface/via, DropPath + RequestPath so LRPROOF can
    /// attach on a live interface after keepalive timeout / transport death
    /// (stale TCP via pin otherwise keeps failing).
    DropAndRefresh,
}

/// Route chosen for the next RRC Link (hops must match the live path slot).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RrcResolvedRoute {
    pub hops: u8,
    pub iface: Option<String>,
    pub via: Option<String>,
}

/// Accumulated iface/via blocks across reconnect proof failures (Nomad-style).
#[derive(Debug, Clone, Default)]
pub struct RrcPathFailoverState {
    pub blocked_ifaces: Vec<String>,
    pub blocked_vias: Vec<String>,
    pub last_route: Option<RrcResolvedRoute>,
    pub rounds: u8,
}

impl RrcPathFailoverState {
    pub fn clear(&mut self) {
        self.blocked_ifaces.clear();
        self.blocked_vias.clear();
        self.last_route = None;
        self.rounds = 0;
    }
}

/// Hops for Link / reconnect_intent: prefer the rediscovered slot.
pub fn rrc_reconnect_hops(fallback: u8, route: Option<&RrcResolvedRoute>) -> u8 {
    route.map(|r| r.hops).filter(|&h| h > 0).unwrap_or(fallback)
}

/// True when establish failed because LRPROOF never arrived.
pub fn is_rrc_link_proof_timeout(err: &RrcLinkError) -> bool {
    matches!(err, RrcLinkError::Timeout(what) if *what == "link proof")
}

/// Stable warn fields for app-log assertions (one `target=rrc` line).
pub fn rrc_link_proof_timeout_log_fields(
    dest_hex: &str,
    route: Option<&RrcResolvedRoute>,
    path_refresh: RrcPathRefresh,
) -> String {
    let hops = route.map(|r| r.hops);
    let iface = route.and_then(|r| r.iface.as_deref()).unwrap_or("-");
    let via = via_prefix(route.and_then(|r| r.via.as_deref())).unwrap_or_else(|| "-".into());
    format!("hub={dest_hex} iface={iface} hops={hops:?} via={via} path_refresh={path_refresh:?}")
}

pub async fn open_rrc_link_with_path_refresh(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    dest_hash: [u8; 16],
    hops: u8,
    path_refresh: RrcPathRefresh,
    failover: &mut RrcPathFailoverState,
) -> Result<(RrcLinkHandle, RrcResolvedRoute), RrcLinkError> {
    let route = refresh_hub_path(&transport_tx, dest_hash, hops, path_refresh, failover).await?;
    let entry = discover_destination(&transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT)
        .await
        .map_err(map_link_session_error)?;
    let pubkey = entry.public_key.ok_or(RrcLinkError::PubkeyNotDiscovered)?;
    let link_hops = rrc_reconnect_hops(hops, Some(&route));

    let config = LinkSessionConfig {
        destination_hash: dest_hash,
        remote_public_key: pubkey,
        hops: link_hops,
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
                            let reason = close_reason_label(reason).to_string();
                            debug!(
                                link_id = %hex::encode(link_id),
                                reason = %reason,
                                "rrc link closed"
                            );
                            let _ = event_tx.send(RrcLinkEvent::Closed { reason }).await;
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
                            let reason = terminal_close_reason_from_event(None)
                                .expect("None event is terminal");
                            let _ = event_tx.send(RrcLinkEvent::Closed { reason }).await;
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

    Ok((
        RrcLinkHandle {
            cmd_tx,
            event_rx,
            link_id,
        },
        route,
    ))
}

/// When the resource-offers receiver ends, prefer an already-queued session
/// `Closed` reason over the synthetic `resource_offers_closed` label.
fn closed_reason_after_offers_ended(events: &mut mpsc::Receiver<LinkSessionEvent>) -> String {
    while let Ok(ev) = events.try_recv() {
        if let Some(reason) = terminal_close_reason_from_event(Some(&ev)) {
            return reason;
        }
    }
    "resource_offers_closed".into()
}

#[cfg(test)]
fn closed_reason_from_session_event(ev: &LinkSessionEvent) -> Option<String> {
    terminal_close_reason_from_event(Some(ev))
}

/// Terminal close reason from a session event recv result. Shared by the link
/// loop and race tests so biased Closed-vs-offers-end handling stays aligned.
fn terminal_close_reason_from_event(ev: Option<&LinkSessionEvent>) -> Option<String> {
    match ev {
        Some(LinkSessionEvent::Closed { reason }) => Some(close_reason_label(*reason).into()),
        None => Some("session_ended".into()),
        Some(_) => None,
    }
}

/// Production-biased race: prefer session Closed/session_ended over offers-end.
#[cfg(test)]
async fn race_session_close_vs_offers_end(
    events: &mut mpsc::Receiver<LinkSessionEvent>,
    offers: &mut mpsc::Receiver<LinkSessionResourceOffer>,
) -> String {
    tokio::select! {
        biased;
        ev = events.recv() => terminal_close_reason_from_event(ev.as_ref())
            .expect("race helper expects a terminal session event"),
        offer = offers.recv() => {
            assert!(
                offer.is_none(),
                "race helper expects offers channel closed, not an offer"
            );
            closed_reason_after_offers_ended(events)
        }
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
    fallback_hops: u8,
    mode: RrcPathRefresh,
    failover: &mut RrcPathFailoverState,
) -> Result<RrcResolvedRoute, RrcLinkError> {
    let mut options = DestinationResolveOptions::new(PATH_LOOKUP_TIMEOUT);
    options.refresh_cached_path = true;
    let mut snapshot = None;
    if mode == RrcPathRefresh::DropAndRefresh {
        snapshot = query_path_route(transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT).await;
        if let Some(ref failed) = snapshot {
            if should_apply_rrc_path_failover(failed, failover.rounds) {
                apply_failed_route_failover(transport_tx, dest_hash, failed, failover).await;
            }
        }
        // Explicit DropPath covers both cached and uncached identities. Clear
        // drop_existing_path so resolve_destination does not DropPath again on
        // a cache miss.
        match drop_path_rpc(transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT).await? {
            TransportQueryResponse::Ok => {
                debug!(
                    dest = %hex::encode(dest_hash),
                    "rrc DropPath before reconnect establish"
                );
            }
            _ => {
                debug!(
                    dest = %hex::encode(dest_hash),
                    "rrc DropPath returned unexpected response; continuing"
                );
            }
        }
        options.drop_existing_path = false;
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

    let resolved = if mode == RrcPathRefresh::DropAndRefresh && snapshot.is_some() {
        let probe_deadline = tokio::time::Instant::now() + VIA_FAILOVER_PROBE_WAIT;
        if let Some(route) = poll_unblocked_route(
            transport_tx,
            dest_hash,
            failover,
            snapshot.as_ref().and_then(|s| s.via.as_deref()),
            probe_deadline,
        )
        .await
        {
            Some(route)
        } else if let Some(timeout) = remaining_until(probe_deadline) {
            query_path_route(transport_tx, dest_hash, timeout).await
        } else {
            None
        }
        .or_else(|| snapshot.clone())
    } else {
        query_path_route(transport_tx, dest_hash, PATH_LOOKUP_TIMEOUT).await
    };

    let route = resolved.unwrap_or(RrcResolvedRoute {
        hops: fallback_hops,
        iface: snapshot.as_ref().and_then(|s| s.iface.clone()),
        via: snapshot.as_ref().and_then(|s| s.via.clone()),
    });
    failover.last_route = Some(route.clone());
    Ok(route)
}

/// True when DropAndRefresh has a concrete failed iface/via and budget remains.
fn should_apply_rrc_path_failover(failed: &RrcResolvedRoute, rounds: u8) -> bool {
    rounds < path_failover::MAX_VIA_FAILOVERS && (failed.iface.is_some() || failed.via.is_some())
}

fn remaining_until(deadline: tokio::time::Instant) -> Option<Duration> {
    let rem = deadline.saturating_duration_since(tokio::time::Instant::now());
    (!rem.is_zero()).then_some(rem)
}

/// Suppress the failed iface and drop its next hop so RequestPath can attach elsewhere.
async fn apply_failed_route_failover(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    failed: &RrcResolvedRoute,
    failover: &mut RrcPathFailoverState,
) {
    if !should_apply_rrc_path_failover(failed, failover.rounds) {
        return;
    }
    record_path_failover_attempt(
        &mut Vec::new(),
        &mut failover.blocked_ifaces,
        &mut failover.blocked_vias,
        failed.iface.as_deref(),
        failed.via.as_deref(),
    );
    let ops = path_failover::build_path_failover_control_ops(
        dest_hash,
        &failover.blocked_vias,
        failed.via.as_deref(),
        &[],
    );
    let _ = transport_rpc(
        transport_tx,
        TransportQuery::SuppressCurrentPathInterface {
            dest: dest_hash,
            duration: ops.suppress_secs,
        },
        PATH_LOOKUP_TIMEOUT,
    )
    .await;
    for via_hex in &ops.vias_to_drop {
        let Some(next_hop) = parse_dest_hash(via_hex) else {
            continue;
        };
        let _ = transport_rpc(
            transport_tx,
            TransportQuery::DropAllVia { next_hop },
            PATH_LOOKUP_TIMEOUT,
        )
        .await;
    }
    info!(
        target: "rrc",
        dest = %hex::encode(dest_hash),
        iface = ?failed.iface,
        hops = failed.hops,
        via = ?via_prefix(failed.via.as_deref()),
        blocked_ifaces = ?failover.blocked_ifaces,
        "rrc DropAndRefresh failover"
    );
}

async fn poll_unblocked_route(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    failover: &RrcPathFailoverState,
    failed_via: Option<&str>,
    deadline: tokio::time::Instant,
) -> Option<RrcResolvedRoute> {
    loop {
        let timeout = remaining_until(deadline)?;
        let slots = query_path_slots_json(transport_tx, dest_hash, timeout).await;
        if let Some(cand) = select_unblocked_slot(
            &slots,
            &failover.blocked_ifaces,
            &failover.blocked_vias,
            failed_via,
            &[],
        ) {
            return Some(route_from_candidate(cand));
        }
        let rem = remaining_until(deadline)?;
        tokio::time::sleep(rem.min(VIA_FAILOVER_POLL_INTERVAL)).await;
    }
}

async fn query_path_route(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    timeout: Duration,
) -> Option<RrcResolvedRoute> {
    let slots = query_path_slots_json(transport_tx, dest_hash, timeout).await;
    best_slot_route(&slots)
}

async fn query_path_slots_json(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    timeout: Duration,
) -> Vec<serde_json::Value> {
    let deadline = tokio::time::Instant::now() + timeout;
    let Some(first) = remaining_until(deadline) else {
        return Vec::new();
    };
    if let Ok(TransportQueryResponse::PathSlots(entry)) = transport_rpc(
        transport_tx,
        TransportQuery::GetPathSlots { dest: dest_hash },
        first,
    )
    .await
    {
        return entry
            .slots
            .iter()
            .map(|slot| {
                serde_json::json!({
                    "active": slot.active,
                    "hops": slot.hops,
                    "via_hash": slot.via.map(hex::encode),
                    "interface": slot.interface,
                    "expired": slot.expired,
                })
            })
            .collect();
    }
    let Some(second) = remaining_until(deadline) else {
        return Vec::new();
    };
    match transport_rpc(transport_tx, TransportQuery::GetPathTable, second).await {
        Ok(TransportQueryResponse::PathTable(entries)) => entries
            .iter()
            .filter(|e| e.hash == dest_hash)
            .map(path_table_slot_json)
            .collect(),
        _ => Vec::new(),
    }
}

fn path_table_slot_json(entry: &PathTableRpcEntry) -> serde_json::Value {
    serde_json::json!({
        "active": true,
        "hops": entry.hops,
        "via_hash": entry.via.map(hex::encode),
        "interface": entry.interface,
        "expired": false,
    })
}

fn best_slot_route(slots: &[serde_json::Value]) -> Option<RrcResolvedRoute> {
    let active = slots.iter().find(|slot| {
        slot.get("active")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            && !slot
                .get("expired")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
    });
    if let Some(slot) = active {
        return path_failover::slot_candidate(slot).map(route_from_candidate);
    }
    slots
        .iter()
        .filter_map(path_failover::slot_candidate)
        .min_by_key(|c| c.hops)
        .map(route_from_candidate)
}

fn route_from_candidate(cand: PathSlotCandidate) -> RrcResolvedRoute {
    RrcResolvedRoute {
        hops: cand.hops,
        iface: cand.iface,
        via: cand.via,
    }
}

fn parse_dest_hash(hex_str: &str) -> Option<[u8; 16]> {
    let clean: String = hex_str.chars().filter(char::is_ascii_hexdigit).collect();
    if clean.len() != 32 {
        return None;
    }
    let bytes = hex::decode(&clean).ok()?;
    bytes.try_into().ok()
}

async fn transport_rpc(
    transport_tx: &mpsc::Sender<TransportMessage>,
    query: TransportQuery,
    timeout: Duration,
) -> Result<TransportQueryResponse, RrcLinkError> {
    let (response_tx, response_rx) = oneshot::channel();
    let result = tokio::time::timeout(timeout, async {
        transport_tx
            .send(TransportMessage::Rpc { query, response_tx })
            .await
            .map_err(|_| RrcLinkError::TransportUnavailable)?;
        response_rx
            .await
            .map_err(|_| RrcLinkError::TransportUnavailable)
    })
    .await;
    match result {
        Err(_) => Err(RrcLinkError::Timeout("transport rpc")),
        Ok(Err(e)) => Err(e),
        Ok(Ok(response)) => Ok(response),
    }
}

/// Bound DropPath RPC (send + reply) so a hung transport cannot stall reconnect.
async fn drop_path_rpc(
    transport_tx: &mpsc::Sender<TransportMessage>,
    dest_hash: [u8; 16],
    timeout: Duration,
) -> Result<TransportQueryResponse, RrcLinkError> {
    let (response_tx, response_rx) = oneshot::channel();
    let drop_result = tokio::time::timeout(timeout, async {
        transport_tx
            .send(TransportMessage::Rpc {
                query: TransportQuery::DropPath { dest: dest_hash },
                response_tx,
            })
            .await
            .map_err(|_| RrcLinkError::TransportUnavailable)?;
        response_rx
            .await
            .map_err(|_| RrcLinkError::TransportUnavailable)
    })
    .await;
    match drop_result {
        Err(_) => Err(RrcLinkError::Timeout("DropPath")),
        Ok(Err(e)) => Err(e),
        Ok(Ok(response)) => Ok(response),
    }
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
    use rns_transport::constants::InterfaceMode;
    use rns_transport::messages::{InterfaceRole, RecalledDestinationRpcEntry};

    const TEST_TRANSPORT_RECV: Duration = Duration::from_secs(2);

    fn test_path_table_entry(
        dest: [u8; 16],
        via: [u8; 16],
        hops: u8,
        iface: &str,
    ) -> PathTableRpcEntry {
        PathTableRpcEntry {
            hash: dest,
            timestamp: 1.0,
            via: Some(via),
            hops,
            expires: 100.0,
            interface: iface.into(),
            interface_id: 1,
            interface_mode: InterfaceMode::Full,
            interface_role: InterfaceRole::Normal,
        }
    }

    async fn recv_transport(
        transport_rx: &mut mpsc::Receiver<TransportMessage>,
    ) -> TransportMessage {
        tokio::time::timeout(TEST_TRANSPORT_RECV, transport_rx.recv())
            .await
            .expect("timed out waiting for transport message")
            .expect("transport channel closed")
    }

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

    /// Production-biased race helper: Closed wins over offers-end.
    #[tokio::test]
    async fn biased_select_emits_timeout_when_closed_and_offers_end_race() {
        let (ev_tx, mut events) = mpsc::channel::<LinkSessionEvent>(4);
        let (offer_tx, mut offers) = mpsc::channel::<LinkSessionResourceOffer>(1);
        ev_tx
            .send(LinkSessionEvent::Closed {
                reason: LinkSessionCloseReason::Timeout,
            })
            .await
            .unwrap();
        drop(ev_tx);
        drop(offer_tx);

        let reason = race_session_close_vs_offers_end(&mut events, &mut offers).await;
        assert_eq!(reason, "timeout");
    }

    /// When offers end first, drain any already-queued Closed reason.
    #[tokio::test]
    async fn offers_end_first_drains_queued_closed_reason() {
        let (ev_tx, mut events) = mpsc::channel::<LinkSessionEvent>(4);
        let (offer_tx, mut offers) = mpsc::channel::<LinkSessionResourceOffer>(1);
        ev_tx
            .send(LinkSessionEvent::Closed {
                reason: LinkSessionCloseReason::Remote,
            })
            .await
            .unwrap();
        drop(ev_tx);
        drop(offer_tx);

        let offer = offers.recv().await;
        assert!(offer.is_none());
        let reason = closed_reason_after_offers_ended(&mut events);
        assert_eq!(reason, "remote_close");
    }

    #[tokio::test]
    async fn drop_and_refresh_sends_drop_path_before_request_path() {
        let dest = [0xAB; 16];
        let failed_via = [0x7C; 16];
        let alt_via = [0xAA; 16];
        let public_key = [0xCD; 64];
        let (transport_tx, mut transport_rx) = mpsc::channel(16);
        let responder = tokio::spawn(async move {
            let mut drop_count = 0usize;
            let mut saw_request = false;
            let mut answered_unblocked = false;
            let mut seq = Vec::new();
            while !(saw_request && answered_unblocked) {
                let msg = recv_transport(&mut transport_rx).await;
                match msg {
                    TransportMessage::Rpc {
                        query: TransportQuery::GetPathSlots { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::GetPathTable,
                        response_tx,
                    } => {
                        let entry = if saw_request {
                            answered_unblocked = true;
                            test_path_table_entry(dest, alt_via, 3, "Ratspeak")
                        } else {
                            test_path_table_entry(dest, failed_via, 2, "RNS DFW Central")
                        };
                        response_tx
                            .send(TransportQueryResponse::PathTable(vec![entry]))
                            .unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::SuppressCurrentPathInterface { dest: d, duration },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        assert!(duration > 0.0);
                        seq.push("SuppressCurrentPathInterface");
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::DropAllVia { next_hop },
                        response_tx,
                    } => {
                        assert_eq!(next_hop, failed_via);
                        seq.push("DropAllVia");
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::DropPath { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        assert!(!saw_request, "DropPath must precede RequestPath");
                        drop_count += 1;
                        assert!(
                            drop_count <= 1,
                            "explicit DropPath must not be followed by a second resolver DropPath"
                        );
                        seq.push("DropPath");
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::RecallDestination { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        // Cache miss then hit after RequestPath — exercises the
                        // uncached path where a second DropPath would otherwise fire.
                        if drop_count == 1 && !saw_request {
                            response_tx
                                .send(TransportQueryResponse::RecalledDestination(None))
                                .unwrap();
                        } else {
                            response_tx
                                .send(TransportQueryResponse::RecalledDestination(Some(
                                    RecalledDestinationRpcEntry {
                                        dest_hash: dest,
                                        public_key,
                                        app_data: None,
                                        ratchet: None,
                                        hops: 1,
                                        timestamp: 1.0,
                                    },
                                )))
                                .unwrap();
                        }
                    }
                    TransportMessage::RequestPath {
                        destination_hash: d,
                    } => {
                        assert_eq!(d, dest);
                        assert_eq!(drop_count, 1, "exactly one DropPath before RequestPath");
                        seq.push("RequestPath");
                        saw_request = true;
                    }
                    other => panic!("unexpected transport message: {other:?}"),
                }
            }
            seq
        });

        let mut failover = RrcPathFailoverState::default();
        let route = refresh_hub_path(
            &transport_tx,
            dest,
            1,
            RrcPathRefresh::DropAndRefresh,
            &mut failover,
        )
        .await
        .expect("refresh_hub_path");
        assert_eq!(
            responder.await.expect("responder join"),
            [
                "SuppressCurrentPathInterface",
                "DropAllVia",
                "DropPath",
                "RequestPath"
            ]
        );
        assert_eq!(route.hops, 3);
        assert_eq!(route.iface.as_deref(), Some("Ratspeak"));
    }

    #[tokio::test]
    async fn drop_and_refresh_without_live_route_skips_failover() {
        let dest = [0xAB; 16];
        let public_key = [0xCD; 64];
        let (transport_tx, mut transport_rx) = mpsc::channel(8);
        let responder = tokio::spawn(async move {
            let mut drop_count = 0usize;
            let mut saw_request = false;
            let mut saw_failover = false;
            while !saw_request {
                let msg = recv_transport(&mut transport_rx).await;
                match msg {
                    TransportMessage::Rpc {
                        query: TransportQuery::GetPathSlots { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::GetPathTable,
                        response_tx,
                    } => {
                        response_tx
                            .send(TransportQueryResponse::PathTable(Vec::new()))
                            .unwrap();
                    }
                    TransportMessage::Rpc {
                        query:
                            TransportQuery::SuppressCurrentPathInterface { .. }
                            | TransportQuery::DropAllVia { .. },
                        ..
                    } => {
                        saw_failover = true;
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::DropPath { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        drop_count += 1;
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::RecallDestination { dest: d },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        if drop_count == 1 && !saw_request {
                            response_tx
                                .send(TransportQueryResponse::RecalledDestination(None))
                                .unwrap();
                        } else {
                            response_tx
                                .send(TransportQueryResponse::RecalledDestination(Some(
                                    RecalledDestinationRpcEntry {
                                        dest_hash: dest,
                                        public_key,
                                        app_data: None,
                                        ratchet: None,
                                        hops: 1,
                                        timestamp: 1.0,
                                    },
                                )))
                                .unwrap();
                        }
                    }
                    TransportMessage::RequestPath {
                        destination_hash: d,
                    } => {
                        assert_eq!(d, dest);
                        saw_request = true;
                    }
                    other => panic!("unexpected transport message: {other:?}"),
                }
            }
            // Allow the post-RequestPath recall / path query to complete.
            if let Ok(msg) = tokio::time::timeout(TEST_TRANSPORT_RECV, transport_rx.recv()).await {
                match msg {
                    Some(TransportMessage::Rpc {
                        query: TransportQuery::RecallDestination { .. },
                        response_tx,
                    }) => {
                        response_tx
                            .send(TransportQueryResponse::RecalledDestination(Some(
                                RecalledDestinationRpcEntry {
                                    dest_hash: dest,
                                    public_key,
                                    app_data: None,
                                    ratchet: None,
                                    hops: 1,
                                    timestamp: 1.0,
                                },
                            )))
                            .unwrap();
                    }
                    Some(TransportMessage::Rpc {
                        query: TransportQuery::GetPathSlots { dest: d },
                        response_tx,
                    }) => {
                        assert_eq!(d, dest);
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    Some(TransportMessage::Rpc {
                        query: TransportQuery::GetPathTable,
                        response_tx,
                    }) => {
                        response_tx
                            .send(TransportQueryResponse::PathTable(Vec::new()))
                            .unwrap();
                    }
                    Some(TransportMessage::Rpc {
                        query: TransportQuery::DropPath { .. },
                        ..
                    }) => panic!("second DropPath must not occur after explicit drop"),
                    Some(other) => panic!("unexpected trailing message: {other:?}"),
                    None => {}
                }
            }
            !saw_failover && drop_count == 1 && saw_request
        });

        let mut failover = RrcPathFailoverState::default();
        refresh_hub_path(
            &transport_tx,
            dest,
            1,
            RrcPathRefresh::DropAndRefresh,
            &mut failover,
        )
        .await
        .expect("refresh_hub_path");
        assert!(
            responder.await.expect("responder join"),
            "empty path table must DropPath then RequestPath without failover RPCs"
        );
        assert!(failover.blocked_ifaces.is_empty());
        assert!(failover.blocked_vias.is_empty());
    }

    #[tokio::test]
    async fn drop_path_rpc_timeout_maps_to_timeout_error() {
        let dest = [0x11; 16];
        let (transport_tx, mut transport_rx) = mpsc::channel(1);
        let _hold = tokio::spawn(async move {
            // Keep the Rpc (and its response_tx) alive so the caller blocks on reply.
            let _keep = transport_rx.recv().await;
            std::future::pending::<()>().await;
        });
        let err = drop_path_rpc(&transport_tx, dest, Duration::from_millis(30))
            .await
            .expect_err("must time out");
        assert!(
            matches!(err, RrcLinkError::Timeout("DropPath")),
            "hung DropPath must be Timeout, got {err}"
        );
    }

    #[tokio::test]
    async fn drop_path_rpc_closed_channel_is_transport_unavailable() {
        let dest = [0x22; 16];
        let (transport_tx, transport_rx) = mpsc::channel(1);
        drop(transport_rx);
        let err = drop_path_rpc(&transport_tx, dest, Duration::from_secs(1))
            .await
            .expect_err("must fail");
        assert!(
            matches!(err, RrcLinkError::TransportUnavailable),
            "closed transport must be TransportUnavailable, got {err}"
        );
    }

    #[test]
    fn disconnect_reasons_that_need_path_drop() {
        assert!(rrc_disconnect_should_drop_path("timeout"));
        assert!(rrc_disconnect_should_drop_path("transport_error"));
        assert!(rrc_disconnect_should_drop_path("resource_offers_closed"));
        assert!(!rrc_disconnect_should_drop_path("local_close"));
        assert!(!rrc_disconnect_should_drop_path("local_disconnect"));
        // Silent event-channel end — reconnect with Refresh, not DropPath.
        assert!(!rrc_disconnect_should_drop_path("link_ended"));
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

    #[test]
    fn reconnect_hops_prefers_resolved_route() {
        let route = RrcResolvedRoute {
            hops: 4,
            iface: Some("Ratspeak".into()),
            via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
        };
        assert_eq!(rrc_reconnect_hops(2, Some(&route)), 4);
        assert_eq!(rrc_reconnect_hops(2, None), 2);
        assert_eq!(
            rrc_reconnect_hops(
                2,
                Some(&RrcResolvedRoute {
                    hops: 0,
                    iface: None,
                    via: None
                })
            ),
            2
        );
    }

    #[test]
    fn link_proof_timeout_log_includes_route_fields() {
        let route = RrcResolvedRoute {
            hops: 2,
            iface: Some("RNS DFW Central".into()),
            via: Some("7cbbe5ada62d88ee2d4dbe0c3cb1bceb".into()),
        };
        let line = rrc_link_proof_timeout_log_fields(
            "d765e919676aa0340412a1afae006553",
            Some(&route),
            RrcPathRefresh::DropAndRefresh,
        );
        assert!(line.contains("hub=d765e919676aa0340412a1afae006553"));
        assert!(line.contains("iface=RNS DFW Central"));
        assert!(line.contains("hops=Some(2)"));
        assert!(line.contains("via=7cbbe5ad"));
        assert!(line.contains("path_refresh=DropAndRefresh"));
        assert!(is_rrc_link_proof_timeout(&RrcLinkError::Timeout(
            "link proof"
        )));
        assert!(!is_rrc_link_proof_timeout(&RrcLinkError::Timeout(
            "DropPath"
        )));
    }

    #[test]
    fn unblocked_slot_rejects_pre_drop_via() {
        let failed_via = "7cbbe5ada62d88ee2d4dbe0c3cb1bceb";
        let slots = vec![
            serde_json::json!({
                "active": true,
                "hops": 2,
                "via_hash": failed_via,
                "interface": "RNS DFW Central",
                "expired": false,
            }),
            serde_json::json!({
                "active": false,
                "hops": 3,
                "via_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "interface": "Ratspeak",
                "expired": false,
            }),
        ];
        let picked = select_unblocked_slot(
            &slots,
            &["RNS DFW Central".into()],
            &[],
            Some(failed_via),
            &[],
        )
        .expect("alternate slot");
        assert_eq!(picked.iface.as_deref(), Some("Ratspeak"));
        assert_eq!(picked.hops, 3);
        assert_eq!(
            select_unblocked_slot(
                &slots,
                &["RNS DFW Central".into()],
                &[failed_via.into()],
                Some(failed_via),
                &[]
            ),
            Some(PathSlotCandidate {
                hops: 3,
                iface: Some("Ratspeak".into()),
                via: Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()),
            })
        );
    }

    #[tokio::test]
    async fn drop_and_refresh_failover_sends_suppress_and_drop_all_via() {
        let dest = [0xD7; 16];
        let failed_via = [0x7C; 16];
        let failed = RrcResolvedRoute {
            hops: 2,
            iface: Some("RNS DFW Central".into()),
            via: Some(hex::encode(failed_via)),
        };
        let (transport_tx, mut transport_rx) = mpsc::channel(8);
        let responder = tokio::spawn(async move {
            let mut saw_suppress = false;
            let mut saw_drop_via = false;
            for _ in 0..2 {
                let msg = recv_transport(&mut transport_rx).await;
                match msg {
                    TransportMessage::Rpc {
                        query: TransportQuery::SuppressCurrentPathInterface { dest: d, duration },
                        response_tx,
                    } => {
                        assert_eq!(d, dest);
                        assert!(duration > 0.0);
                        saw_suppress = true;
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    TransportMessage::Rpc {
                        query: TransportQuery::DropAllVia { next_hop },
                        response_tx,
                    } => {
                        assert_eq!(next_hop, failed_via);
                        saw_drop_via = true;
                        response_tx.send(TransportQueryResponse::Ok).unwrap();
                    }
                    other => panic!("unexpected transport message: {other:?}"),
                }
            }
            saw_suppress && saw_drop_via
        });

        let mut failover = RrcPathFailoverState::default();
        apply_failed_route_failover(&transport_tx, dest, &failed, &mut failover).await;
        assert!(
            responder.await.expect("responder join"),
            "expected Suppress then DropAllVia"
        );
        assert!(
            failover
                .blocked_ifaces
                .iter()
                .any(|n| n.eq_ignore_ascii_case("RNS DFW Central"))
        );
        assert!(
            failover
                .blocked_vias
                .iter()
                .any(|v| v.eq_ignore_ascii_case(&hex::encode(failed_via)))
        );
    }

    #[tokio::test]
    async fn apply_failed_route_failover_skips_when_rounds_exhausted() {
        let dest = [0xD7; 16];
        let failed = RrcResolvedRoute {
            hops: 2,
            iface: Some("RNS DFW Central".into()),
            via: Some(hex::encode([0x7C; 16])),
        };
        let (transport_tx, mut transport_rx) = mpsc::channel(4);
        let mut failover = RrcPathFailoverState {
            rounds: path_failover::MAX_VIA_FAILOVERS,
            ..RrcPathFailoverState::default()
        };
        apply_failed_route_failover(&transport_tx, dest, &failed, &mut failover).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), transport_rx.recv())
                .await
                .is_err(),
            "SuppressCurrentPathInterface and DropAllVia stay gated by MAX_VIA_FAILOVERS"
        );
        assert!(failover.blocked_ifaces.is_empty());
        assert!(failover.blocked_vias.is_empty());
    }

    #[test]
    fn path_failover_requires_failed_route_and_remaining_rounds() {
        let failed = RrcResolvedRoute {
            hops: 2,
            iface: Some("RNS DFW Central".into()),
            via: Some(hex::encode([0x7C; 16])),
        };
        let empty = RrcResolvedRoute {
            hops: 2,
            iface: None,
            via: None,
        };
        assert!(should_apply_rrc_path_failover(&failed, 0));
        assert!(should_apply_rrc_path_failover(&failed, 1));
        assert!(!should_apply_rrc_path_failover(
            &failed,
            path_failover::MAX_VIA_FAILOVERS
        ));
        assert!(!should_apply_rrc_path_failover(&empty, 0));
    }
}
