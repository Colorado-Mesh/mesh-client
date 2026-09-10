//! Nomad Link scheduling: page/file preempt vs in-page media queue.
//!
//! Page and file fetches use last-wins cancel so a newer navigation aborts an
//! older Link. In-page `/media` images must queue under a request-scoped mutex
//! across the full Link + via-failover lifecycle without canceling siblings —
//! otherwise concurrent media fetches race to `nomad_busy`, including during
//! the gap when `nomad_link_lock` is released between Link attempts.

use std::time::Duration;

/// How a Nomad Link query interacts with the shared lock / cancel slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomadLinkSchedule {
    /// Page/file: bump generation and cancel any in-flight prior Link.
    Preempt,
    /// Media: wait for the request queue without canceling siblings; still abort
    /// if a later [`Preempt`] bumps generation (navigation away).
    Queue,
}

/// Whether starting this schedule cancels an in-flight prior Link.
pub fn nomad_link_schedule_cancels_prior(schedule: NomadLinkSchedule) -> bool {
    matches!(schedule, NomadLinkSchedule::Preempt)
}

/// Whether this schedule bumps the shared generation counter (last-wins).
pub fn nomad_link_schedule_bumps_generation(schedule: NomadLinkSchedule) -> bool {
    matches!(schedule, NomadLinkSchedule::Preempt)
}

/// Whether this schedule holds a request-scoped mutex across Link + failover.
///
/// Distinct from `nomad_link_lock` (per Link attempt) so Queue can release the
/// attempt lock during `suppress_via_and_rediscover` without letting another
/// media fetch start.
pub fn nomad_link_schedule_holds_request_queue(schedule: NomadLinkSchedule) -> bool {
    matches!(schedule, NomadLinkSchedule::Queue)
}

/// Lock-acquire budget for a single Link attempt / Preempt unwind.
///
/// Preempt uses a short unwind window after canceling the prior query.
/// Queue attempt waits floor at the Link query timeout (per attempt only).
pub fn nomad_link_lock_wait(
    schedule: NomadLinkSchedule,
    preempt_wait: Duration,
    query_timeout_secs: u64,
) -> Duration {
    match schedule {
        NomadLinkSchedule::Preempt => preempt_wait,
        NomadLinkSchedule::Queue => {
            let secs = query_timeout_secs.max(preempt_wait.as_secs());
            Duration::from_secs(secs)
        }
    }
}

/// Wait budget for the request-scoped `/media` queue mutex.
///
/// Covers the full protected lifecycle held under `nomad_media_queue_lock`:
/// initial Link + up to `max_via_failovers` retries, each with a rediscovery
/// window (`rediscover_secs_per_failover`), not a single `timeout_secs` attempt.
pub fn nomad_media_queue_lock_wait(
    query_timeout_secs: u64,
    preempt_wait: Duration,
    max_via_failovers: u8,
    rediscover_secs_per_failover: u64,
) -> Duration {
    let attempts = u64::from(max_via_failovers).saturating_add(1);
    let link_budget = query_timeout_secs.saturating_mul(attempts);
    let rediscover_budget =
        u64::from(max_via_failovers).saturating_mul(rediscover_secs_per_failover);
    let secs = link_budget
        .saturating_add(rediscover_budget)
        .max(preempt_wait.as_secs());
    Duration::from_secs(secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::sync::Mutex;

    #[test]
    fn preempt_cancels_and_bumps_generation() {
        assert!(nomad_link_schedule_cancels_prior(
            NomadLinkSchedule::Preempt
        ));
        assert!(nomad_link_schedule_bumps_generation(
            NomadLinkSchedule::Preempt
        ));
        assert!(!nomad_link_schedule_holds_request_queue(
            NomadLinkSchedule::Preempt
        ));
        assert!(!nomad_link_schedule_cancels_prior(NomadLinkSchedule::Queue));
        assert!(!nomad_link_schedule_bumps_generation(
            NomadLinkSchedule::Queue
        ));
        assert!(nomad_link_schedule_holds_request_queue(
            NomadLinkSchedule::Queue
        ));
    }

    #[test]
    fn queue_lock_wait_uses_query_timeout_floor_preempt() {
        let preempt = Duration::from_secs(8);
        assert_eq!(
            nomad_link_lock_wait(NomadLinkSchedule::Preempt, preempt, 120),
            preempt
        );
        assert_eq!(
            nomad_link_lock_wait(NomadLinkSchedule::Queue, preempt, 120),
            Duration::from_secs(120)
        );
        assert_eq!(
            nomad_link_lock_wait(NomadLinkSchedule::Queue, preempt, 3),
            Duration::from_secs(8)
        );
    }

    #[test]
    fn media_queue_lock_wait_covers_attempts_plus_rediscovery() {
        let preempt = Duration::from_secs(8);
        // 3 attempts × 45s + 2 × 16s rediscover = 167s
        assert_eq!(
            nomad_media_queue_lock_wait(45, preempt, 2, 16),
            Duration::from_secs(167)
        );
        // Tiny query timeout still floors at preempt unwind.
        assert_eq!(
            nomad_media_queue_lock_wait(1, preempt, 0, 0),
            Duration::from_secs(8)
        );
    }

    /// Queue B must stay blocked while Queue A holds the request mutex through
    /// a failover gap (link attempt lock released, rediscover in progress).
    #[tokio::test]
    async fn queue_request_mutex_blocks_sibling_through_failover_gap() {
        let request_queue = Arc::new(Mutex::new(()));
        let link_attempt = Arc::new(Mutex::new(()));
        let (a_holding_tx, a_holding_rx) = tokio::sync::oneshot::channel::<()>();
        let (a_in_failover_tx, a_in_failover_rx) = tokio::sync::oneshot::channel::<()>();
        let (release_failover_tx, release_failover_rx) = tokio::sync::oneshot::channel::<()>();
        let b_entered_request = Arc::new(AtomicBool::new(false));

        let queue_a = Arc::clone(&request_queue);
        let link_a = Arc::clone(&link_attempt);
        let task_a = tokio::spawn(async move {
            let _request = queue_a.lock().await;
            let _ = a_holding_tx.send(());
            {
                let _link = link_a.lock().await;
                // initial Link attempt
            }
            // Failover gap: attempt lock released; request mutex still held.
            let _ = a_in_failover_tx.send(());
            let _ = release_failover_rx.await;
            {
                let _link = link_a.lock().await;
                // failover Link attempt
            }
        });

        // Spawn B only after A holds the request mutex (deterministic ordering).
        a_holding_rx
            .await
            .expect("A acquired request mutex before spawning B");

        let queue_b = Arc::clone(&request_queue);
        let link_b = Arc::clone(&link_attempt);
        let b_flag = Arc::clone(&b_entered_request);
        let task_b = tokio::spawn(async move {
            let _request = queue_b.lock().await;
            b_flag.store(true, Ordering::SeqCst);
            let _link = link_b.lock().await;
        });

        a_in_failover_rx.await.expect("A reached failover gap");
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(
            !b_entered_request.load(Ordering::SeqCst),
            "Queue B must not enter the request mutex while A is in failover"
        );
        release_failover_tx.send(()).expect("release A failover");
        task_a.await.expect("A");
        task_b.await.expect("B");
        assert!(b_entered_request.load(Ordering::SeqCst));
    }
}
