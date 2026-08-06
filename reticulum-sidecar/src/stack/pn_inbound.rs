//! Inbound LXMF propagation admission and Resource accounting (lxmd parity).
//!
//! Adapted from rsLXMF `lxmf-tools` `lxmd_pn.rs` for mesh-client local PN hosting.
//! Reticulum request Resources share a Link with ordinary propagation Resources,
//! so Link identity alone is not sufficient lifecycle ownership. Only the
//! `AcceptApp` callback may create an exact `(link_id, logical_resource_id)`
//! correlation.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use lxmf_core::propagation_admission::{
    PnCandidateDiscardResult, PnInboundAdmission, PnInboundAdmissionConfig, PnInboundState,
    PnOfferAdmission, PnOfferCandidate, PnOfferRejection, PnValidationResult,
};
use lxmf_core::propagation_offer::PnOfferEvaluation;
use lxmf_core::sync::OfferResponse;
use rns_runtime::link_manager::{
    LinkManagerAccountingEvent, LinkResourceConclusion, LinkResourceDirection, LinkResourceEvent,
};

type LinkId = [u8; 16];
type LogicalResourceId = [u8; 32];
type ResourceKey = (LinkId, LogicalResourceId);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResourceOwner {
    /// Resource promised by an accepted `WantAll` or `WantSome` offer.
    Offered,
    /// Ordinary Resource on a Link that previously proved a peering key.
    ValidatedPeer,
    /// Ordinary client/originator Resource without a peering-key proof.
    Client,
}

#[derive(Debug, Clone, Copy)]
struct ResourceCorrelation {
    owner: ResourceOwner,
    peer_destination_hash: Option<[u8; 16]>,
    started: bool,
    completion_dispatched: bool,
}

#[derive(Debug, Clone, Copy)]
struct PendingValidation {
    key: ResourceKey,
    owner: ResourceOwner,
    peer_destination_hash: Option<[u8; 16]>,
    link_closed: bool,
}

/// Opaque daemon-local identity for one dispatched validation job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct PnValidationToken(u64);

/// CPU-validation work emitted after an exact ordinary Resource completion.
#[derive(Debug)]
pub(crate) struct PnValidationJob {
    token: PnValidationToken,
    link_id: LinkId,
    data: Vec<u8>,
    allow_multiple: bool,
}

impl PnValidationJob {
    pub(crate) fn token(&self) -> PnValidationToken {
        self.token
    }

    pub(crate) fn link_id(&self) -> LinkId {
        self.link_id
    }

    pub(crate) fn into_data(self) -> Vec<u8> {
        self.data
    }

    pub(crate) fn allow_multiple(&self) -> bool {
        self.allow_multiple
    }

    #[cfg(test)]
    pub(crate) fn for_test(data: Vec<u8>, allow_multiple: bool) -> Self {
        Self {
            token: PnValidationToken(1),
            link_id: [1; 16],
            data,
            allow_multiple,
        }
    }
}

/// Semantic result of parsing and stamp-validating one completed transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PnValidationOutcome {
    Valid,
    InvalidStamp,
    UnauthorizedMultiple,
    Failed,
}

/// One accepted validation result. A missing claim means the result was stale,
/// duplicated, or did not match the token's original Link.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PnValidationClaim {
    link_id: LinkId,
    outcome: PnValidationOutcome,
}

impl PnValidationClaim {
    pub(crate) fn link_id(self) -> LinkId {
        self.link_id
    }

    pub(crate) fn outcome(self) -> PnValidationOutcome {
        self.outcome
    }

    pub(crate) fn should_close_link(self) -> bool {
        matches!(
            self.outcome,
            PnValidationOutcome::InvalidStamp | PnValidationOutcome::UnauthorizedMultiple
        )
    }
}

/// One daemon-lifetime owner for inbound offer admission, peer-key
/// authorization, exact ordinary Resource correlations, and validation tokens.
pub(crate) struct PnInboundRuntime {
    admission: PnInboundAdmission,
    validated_links: HashMap<LinkId, [u8; 16]>,
    quarantined_links: HashSet<LinkId>,
    correlations: HashMap<ResourceKey, ResourceCorrelation>,
    pending_validations: HashMap<PnValidationToken, PendingValidation>,
    next_validation_token: u64,
    max_resource_bytes: usize,
    clock_origin: Instant,
}

impl PnInboundRuntime {
    pub(crate) fn new<I>(
        config: PnInboundAdmissionConfig,
        static_peers: I,
        max_resource_bytes: usize,
    ) -> Self
    where
        I: IntoIterator<Item = [u8; 16]>,
    {
        let mut admission = PnInboundAdmission::new(config);
        admission.set_static_peers(static_peers);
        Self {
            admission,
            validated_links: HashMap::new(),
            quarantined_links: HashSet::new(),
            correlations: HashMap::new(),
            pending_validations: HashMap::new(),
            next_validation_token: 1,
            max_resource_bytes,
            clock_origin: Instant::now(),
        }
    }

    fn now(&self) -> Duration {
        self.clock_origin.elapsed()
    }

    /// Cheap policy preflight. The returned opaque candidate is externally
    /// bound to this Link and peer identity for the peering-key evaluator.
    pub(crate) fn preflight_offer(
        &mut self,
        link_id: LinkId,
        peer_identity_hash: Option<[u8; 16]>,
    ) -> Result<PnOfferCandidate, OfferResponse> {
        if self.quarantined_links.contains(&link_id) {
            return Err(OfferResponse::ErrorThrottled);
        }

        if let Some(peer_identity_hash) = peer_identity_hash {
            let peer_destination_hash =
                PnInboundAdmission::peer_destination_hash(&peer_identity_hash);
            if !self.resource_bypasses_limits(Some(peer_destination_hash)) {
                let config = self.admission.config();
                if config.sequential_validation && !self.pending_validations.is_empty() {
                    return Err(OfferResponse::ErrorThrottled);
                }
                if self.active_limited_resource_count() >= config.max_inbound_syncs {
                    return Err(OfferResponse::ErrorThrottled);
                }
            }
        }

        let now = self.now();
        self.admission
            .preflight_offer(link_id, peer_identity_hash, now)
            .map_err(offer_rejection_response)
    }

    /// Commit the exact externally validated candidate and remember that its
    /// Link has proved a peering key. A failed commit never grants Link-wide
    /// multi-message authorization.
    pub(crate) fn commit_offer(
        &mut self,
        candidate: PnOfferCandidate,
        evaluation: &PnOfferEvaluation,
    ) -> Result<(), OfferResponse> {
        let link_id = candidate.link_id();
        let peer_destination_hash = candidate.peer_destination_hash();

        // Match upstream's observable ordering: mutable concurrency gates are
        // rechecked before a successful peering-key proof can authorize the
        // Link. The core coordinator repeats its own record-based gates below.
        if self.quarantined_links.contains(&link_id)
            || (!self.resource_bypasses_limits(Some(peer_destination_hash))
                && ((self.admission.config().sequential_validation
                    && !self.pending_validations.is_empty())
                    || self.active_limited_resource_count()
                        >= self.admission.config().max_inbound_syncs))
        {
            self.admission.discard_candidate(candidate);
            return Err(OfferResponse::ErrorThrottled);
        }

        let now = self.now();
        match self
            .admission
            .commit_validated_offer(candidate, evaluation.admission_response(), now)
        {
            PnOfferAdmission::HaveAll | PnOfferAdmission::Accepted => {
                self.validated_links.insert(link_id, peer_destination_hash);
                Ok(())
            }
            PnOfferAdmission::Rejected(rejection) => Err(offer_rejection_response(rejection)),
        }
    }

    pub(crate) fn discard_offer(
        &mut self,
        candidate: PnOfferCandidate,
    ) -> PnCandidateDiscardResult {
        self.admission.discard_candidate(candidate)
    }

    pub(crate) fn is_link_quarantined(&self, link_id: &LinkId) -> bool {
        self.quarantined_links.contains(link_id)
    }

    /// Apply the Resource-advertisement policy and create exact ownership
    /// before returning `true` to Reticulum's `AcceptApp` callback.
    ///
    /// Request/response Resources bypass this callback in Reticulum and can
    /// therefore never acquire one of these correlations.
    pub(crate) fn accept_resource(
        &mut self,
        link_id: LinkId,
        logical_resource_id: LogicalResourceId,
        data_size: usize,
        peer_identity_hash: Option<[u8; 16]>,
    ) -> bool {
        if self.quarantined_links.contains(&link_id) {
            return false;
        }

        let key = (link_id, logical_resource_id);
        let supplied_peer_destination =
            peer_identity_hash.map(|identity| PnInboundAdmission::peer_destination_hash(&identity));

        if let Some(existing) = self.correlations.get(&key) {
            // A later split segment retains the original exact owner. If its
            // advertisement is now rejected, the accounting conclusion owns
            // terminal cleanup.
            return self.resource_policy_allows(data_size, existing.peer_destination_hash);
        }

        let admission_record = self
            .admission
            .record(&link_id)
            .map(|record| (record.state(), *record.peer_destination_hash()));
        let has_offered_correlation =
            self.correlations
                .iter()
                .any(|((existing_link, _), correlation)| {
                    *existing_link == link_id && correlation.owner == ResourceOwner::Offered
                });

        let owner = match admission_record {
            Some((PnInboundState::Accepted, _)) if !has_offered_correlation => {
                // One accepted offer owns one logical Resource. A second
                // unrelated Resource remains authorized by the already-proved
                // peering key, but must not steal Offered ownership.
                ResourceOwner::Offered
            }
            Some((
                PnInboundState::Accepted
                | PnInboundState::Transferring
                | PnInboundState::Validating,
                _,
            )) => ResourceOwner::ValidatedPeer,
            None if self.validated_links.contains_key(&link_id) => ResourceOwner::ValidatedPeer,
            None => ResourceOwner::Client,
        };

        let owner_peer_destination = match owner {
            ResourceOwner::Offered => admission_record.map(|(_, peer)| peer),
            ResourceOwner::ValidatedPeer => self
                .validated_links
                .get(&link_id)
                .copied()
                .or_else(|| admission_record.map(|(_, peer)| peer)),
            ResourceOwner::Client => supplied_peer_destination,
        };

        let capacity_allows = self.resource_bypasses_limits(owner_peer_destination)
            || self.active_limited_resource_count() < self.admission.config().max_inbound_syncs;
        let policy_allows =
            capacity_allows && self.resource_policy_allows(data_size, owner_peer_destination);
        if !policy_allows {
            // A first AcceptApp rejection creates no Reticulum lifecycle event,
            // so the offer record must be released synchronously here.
            if owner == ResourceOwner::Offered {
                self.admission.resource_rejected(&link_id);
            }
            return false;
        }

        self.correlations.insert(
            key,
            ResourceCorrelation {
                owner,
                peer_destination_hash: owner_peer_destination,
                started: false,
                completion_dispatched: false,
            },
        );
        true
    }

    fn resource_policy_allows(
        &self,
        data_size: usize,
        peer_destination_hash: Option<[u8; 16]>,
    ) -> bool {
        data_size <= self.max_resource_bytes
            && (!self.admission.config().from_static_only
                || peer_destination_hash
                    .as_ref()
                    .is_some_and(|peer| self.admission.is_static_peer(peer)))
    }

    fn resource_bypasses_limits(&self, peer_destination_hash: Option<[u8; 16]>) -> bool {
        peer_destination_hash.is_some_and(|peer| {
            self.admission.is_static_peer(&peer) && !self.admission.config().static_sequential
        })
    }

    fn active_limited_resource_count(&self) -> usize {
        let correlated = self
            .correlations
            .values()
            .filter(|correlation| !self.resource_bypasses_limits(correlation.peer_destination_hash))
            .count();
        let validating = self
            .pending_validations
            .values()
            .filter(|pending| {
                !self.correlations.contains_key(&pending.key)
                    && !self.resource_bypasses_limits(pending.peer_destination_hash)
            })
            .count();
        correlated.saturating_add(validating)
    }

    /// Consume the lossless ordered Reticulum accounting stream.
    pub(crate) fn handle_accounting_event(
        &mut self,
        event: LinkManagerAccountingEvent,
    ) -> Option<PnValidationJob> {
        match event {
            LinkManagerAccountingEvent::ResourceEvent(event) => {
                self.handle_resource_event(event);
                None
            }
            LinkManagerAccountingEvent::ResourceCompletion(completion) => self.resource_completed(
                (completion.link_id, completion.resource_hash),
                completion.data,
            ),
            LinkManagerAccountingEvent::LinkClosed { link_id } => {
                self.link_closed(link_id);
                None
            }
            _ => None,
        }
    }

    fn handle_resource_event(&mut self, event: LinkResourceEvent) {
        match event {
            LinkResourceEvent::Started {
                link_id,
                resource_id,
                direction: LinkResourceDirection::Inbound,
                ..
            } => self.resource_started((link_id, resource_id)),
            LinkResourceEvent::Concluded {
                link_id,
                resource_id,
                direction: LinkResourceDirection::Inbound,
                conclusion,
            } => self.resource_concluded((link_id, resource_id), &conclusion),
            LinkResourceEvent::Started { .. }
            | LinkResourceEvent::Progress { .. }
            | LinkResourceEvent::Concluded { .. } => {}
        }
    }

    fn resource_started(&mut self, key: ResourceKey) {
        let Some(correlation) = self.correlations.get_mut(&key) else {
            return;
        };
        if correlation.started {
            return;
        }
        if correlation.owner == ResourceOwner::Offered
            && self.admission.resource_started(&key.0).is_err()
        {
            self.correlations.remove(&key);
            self.admission.resource_failed(&key.0);
            return;
        }
        correlation.started = true;
    }

    fn resource_completed(&mut self, key: ResourceKey, data: Vec<u8>) -> Option<PnValidationJob> {
        let (owner, peer_destination_hash, started, already_dispatched) =
            self.correlations.get(&key).map(|correlation| {
                (
                    correlation.owner,
                    correlation.peer_destination_hash,
                    correlation.started,
                    correlation.completion_dispatched,
                )
            })?;
        if already_dispatched {
            return None;
        }

        if !started {
            self.correlations.remove(&key);
            if owner == ResourceOwner::Offered {
                self.admission.resource_failed(&key.0);
            }
            return None;
        }
        if owner == ResourceOwner::Offered && self.admission.resource_concluded(&key.0).is_err() {
            self.correlations.remove(&key);
            self.admission.resource_failed(&key.0);
            return None;
        }

        let token = self.allocate_validation_token();
        self.pending_validations.insert(
            token,
            PendingValidation {
                key,
                owner,
                peer_destination_hash,
                link_closed: false,
            },
        );
        if let Some(correlation) = self.correlations.get_mut(&key) {
            correlation.completion_dispatched = true;
        }

        Some(PnValidationJob {
            token,
            link_id: key.0,
            data,
            allow_multiple: owner != ResourceOwner::Client,
        })
    }

    fn resource_concluded(&mut self, key: ResourceKey, conclusion: &LinkResourceConclusion) {
        let Some(correlation) = self.correlations.remove(&key) else {
            return;
        };

        match conclusion {
            LinkResourceConclusion::Complete if correlation.completion_dispatched => {
                // ResourceCompletion already moved the offered record into
                // Validating and owns the one pending validation token.
            }
            LinkResourceConclusion::Complete => {
                // Defensive fail-clean: a complete conclusion without its
                // preceding payload must not leave an accepted offer resident.
                if correlation.owner == ResourceOwner::Offered {
                    self.admission.resource_failed(&key.0);
                }
            }
            LinkResourceConclusion::Rejected => {
                self.cancel_pending_for_key(key);
                if correlation.owner == ResourceOwner::Offered {
                    self.admission.resource_rejected(&key.0);
                }
            }
            LinkResourceConclusion::Cancelled => {
                self.cancel_pending_for_key(key);
                if correlation.owner == ResourceOwner::Offered {
                    self.admission.resource_cancelled(&key.0);
                }
            }
            LinkResourceConclusion::Failed(_) => {
                self.cancel_pending_for_key(key);
                if correlation.owner == ResourceOwner::Offered {
                    self.admission.resource_failed(&key.0);
                }
            }
        }
    }

    fn cancel_pending_for_key(&mut self, key: ResourceKey) {
        self.pending_validations
            .retain(|_, pending| pending.key != key);
    }

    fn link_closed(&mut self, link_id: LinkId) {
        self.validated_links.remove(&link_id);
        self.quarantined_links.remove(&link_id);
        self.correlations
            .retain(|(correlation_link, _), _| *correlation_link != link_id);
        for pending in self.pending_validations.values_mut() {
            if pending.key.0 == link_id {
                pending.link_closed = true;
            }
        }
        self.admission.link_closed(&link_id);
        // Completed validation jobs intentionally survive Link closure. Their
        // unique token still permits exactly one result and, for invalid
        // stamps, a peer-specific throttle.
    }

    /// Claim a worker result exactly once and perform terminal admission
    /// cleanup. Valid message ingestion happens only after this succeeds.
    pub(crate) fn conclude_validation(
        &mut self,
        token: PnValidationToken,
        link_id: LinkId,
        outcome: PnValidationOutcome,
    ) -> Option<PnValidationClaim> {
        let pending = self.pending_validations.get(&token).copied()?;
        if pending.key.0 != link_id {
            return None;
        }
        self.pending_validations.remove(&token);

        if matches!(
            outcome,
            PnValidationOutcome::InvalidStamp | PnValidationOutcome::UnauthorizedMultiple
        ) && !pending.link_closed
        {
            self.quarantined_links.insert(link_id);
        }

        let now = self.now();
        let validation_result = match outcome {
            PnValidationOutcome::Valid => PnValidationResult::Valid,
            PnValidationOutcome::InvalidStamp => PnValidationResult::InvalidStamp,
            PnValidationOutcome::UnauthorizedMultiple | PnValidationOutcome::Failed => {
                PnValidationResult::Failed
            }
        };

        if pending.owner == ResourceOwner::Offered {
            match self
                .admission
                .validation_concluded(&link_id, validation_result, now)
            {
                Ok(lxmf_core::propagation_admission::PnCleanupResult::NotTracked)
                    if outcome == PnValidationOutcome::InvalidStamp =>
                {
                    self.install_untracked_invalid_throttle(pending.peer_destination_hash, now);
                }
                Err(_) => {
                    self.admission.resource_failed(&link_id);
                    if outcome == PnValidationOutcome::InvalidStamp {
                        self.install_untracked_invalid_throttle(pending.peer_destination_hash, now);
                    }
                }
                Ok(_) => {}
            }
        } else if outcome == PnValidationOutcome::InvalidStamp {
            self.install_untracked_invalid_throttle(pending.peer_destination_hash, now);
        }

        Some(PnValidationClaim { link_id, outcome })
    }

    fn install_untracked_invalid_throttle(
        &mut self,
        peer_destination_hash: Option<[u8; 16]>,
        now: Duration,
    ) {
        if let Some(peer_destination_hash) = peer_destination_hash {
            let _ = self
                .admission
                .install_invalid_stamp_throttle(peer_destination_hash, now);
        }
    }

    fn allocate_validation_token(&mut self) -> PnValidationToken {
        loop {
            let token = PnValidationToken(self.next_validation_token);
            self.next_validation_token = self.next_validation_token.wrapping_add(1).max(1);
            if !self.pending_validations.contains_key(&token) {
                return token;
            }
        }
    }

    #[cfg(test)]
    fn admission_state(&self, link_id: &LinkId) -> Option<PnInboundState> {
        self.admission
            .record(link_id)
            .map(lxmf_core::propagation_admission::PnInboundRecord::state)
    }

    #[cfg(test)]
    fn correlation_count(&self) -> usize {
        self.correlations.len()
    }

    #[cfg(test)]
    fn pending_validation_count(&self) -> usize {
        self.pending_validations.len()
    }

    #[cfg(test)]
    fn throttle_count(&self) -> usize {
        self.admission.throttle_count()
    }
}

pub(crate) fn logical_resource_id(
    resource_hash: LogicalResourceId,
    original_hash: LogicalResourceId,
    split: bool,
    total_segments: usize,
) -> LogicalResourceId {
    if split || total_segments > 1 {
        original_hash
    } else {
        resource_hash
    }
}

pub(crate) fn offer_rejection_response(rejection: PnOfferRejection) -> OfferResponse {
    match rejection {
        PnOfferRejection::NoIdentity => OfferResponse::ErrorNoIdentity,
        PnOfferRejection::NoAccess => OfferResponse::ErrorNoAccess,
        PnOfferRejection::InvalidStampThrottle
        | PnOfferRejection::SequentialValidationActive
        | PnOfferRejection::InboundSyncLimit
        | PnOfferRejection::LinkAlreadyTracked
        | PnOfferRejection::LinkCandidatePending
        | PnOfferRejection::StaleCandidate => OfferResponse::ErrorThrottled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lxmf_core::propagation_admission::PnInboundAdmissionConfig;

    #[test]
    fn accept_resource_tracks_client_correlation() {
        let config = PnInboundAdmissionConfig {
            sequential_validation: true,
            static_sequential: false,
            max_inbound_syncs: 4,
            from_static_only: false,
        };
        let mut runtime = PnInboundRuntime::new(config, None, 64 * 1024);
        let link_id = [0x11; 16];
        let resource_id = [0x22; 32];
        assert!(runtime.accept_resource(link_id, resource_id, 128, None));
        // Client deposits without a prior /offer leave no admission record.
        assert_eq!(runtime.admission_state(&link_id), None);
        assert_eq!(runtime.correlation_count(), 1);
        assert_eq!(runtime.pending_validation_count(), 0);
        assert_eq!(runtime.throttle_count(), 0);
        let _ = PnValidationJob::for_test(vec![1, 2, 3], false);
    }
}
