//! Nomad Link reuse: keep one initiator session per remote node.
//!
//! `LinkClient::query` opens a Link, serves one request, then closes. Zeva-style
//! pages pay a full TCP handshake (and can drop the cached path) for every
//! `/media` image. Reuse the same dest's session across page + queued images.

/// True when the cached initiator dest matches the next Nomad query dest.
pub fn nomad_link_cache_should_reuse(cached_dest: &[u8; 16], dest: &[u8; 16]) -> bool {
    cached_dest == dest
}

/// Outcome of `handle.request` on a session `ensure` just cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomadFreshRequestOutcome {
    /// Request succeeded — keep the cached initiator for the same dest.
    Success,
    Timeout,
    RequestError,
}

/// Fresh sessions are inserted into the cache before `request`. Timeout and
/// request errors must drop that handle so via-failover cannot reuse it.
pub fn nomad_fresh_request_must_drop_cache(outcome: NomadFreshRequestOutcome) -> bool {
    !matches!(outcome, NomadFreshRequestOutcome::Success)
}

#[cfg(test)]
mod tests {
    use super::{
        NomadFreshRequestOutcome, nomad_fresh_request_must_drop_cache,
        nomad_link_cache_should_reuse,
    };

    fn cache_after_fresh_request(
        dest: [u8; 16],
        outcome: NomadFreshRequestOutcome,
    ) -> Option<[u8; 16]> {
        if nomad_fresh_request_must_drop_cache(outcome) {
            None
        } else {
            Some(dest)
        }
    }

    #[test]
    fn reuses_only_the_same_nomad_dest() {
        let dest_a = [0x78; 16];
        let dest_b = [0x32; 16];
        assert!(nomad_link_cache_should_reuse(&dest_a, &dest_a));
        assert!(!nomad_link_cache_should_reuse(&dest_a, &dest_b));
    }

    #[test]
    fn failed_fresh_retry_opens_a_new_session_on_failover() {
        let dest = [0x44; 16];
        for outcome in [
            NomadFreshRequestOutcome::Timeout,
            NomadFreshRequestOutcome::RequestError,
        ] {
            assert!(nomad_fresh_request_must_drop_cache(outcome));
            let cached = cache_after_fresh_request(dest, outcome);
            assert!(
                cached.is_none(),
                "failed fresh retry must clear the cached handle"
            );
            assert!(
                !cached.is_some_and(|c| nomad_link_cache_should_reuse(&c, &dest)),
                "failover must not reuse a failed fresh handle"
            );
        }
    }

    #[test]
    fn successful_fresh_request_keeps_cache_for_same_dest() {
        let dest = [0x44; 16];
        assert!(!nomad_fresh_request_must_drop_cache(
            NomadFreshRequestOutcome::Success
        ));
        let cached = cache_after_fresh_request(dest, NomadFreshRequestOutcome::Success);
        assert!(cached.is_some_and(|c| nomad_link_cache_should_reuse(&c, &dest)));
    }
}
