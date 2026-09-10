//! Nomad Link scheduling: page/file preempt vs in-page media queue.
//!
//! Page and file fetches use last-wins cancel so a newer navigation aborts an
//! older Link. In-page `/media` images must queue under the shared lock without
//! canceling siblings — otherwise concurrent media fetches race to `nomad_busy`.

use std::time::Duration;

/// How a Nomad Link query interacts with the shared lock / cancel slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomadLinkSchedule {
    /// Page/file: bump generation and cancel any in-flight prior Link.
    Preempt,
    /// Media: wait for the lock without canceling siblings; still abort if a
    /// later [`Preempt`] bumps generation (navigation away).
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

/// Lock-acquire budget for the given schedule.
///
/// Preempt uses a short unwind window after canceling the prior query.
/// Queue waits up to the Link query timeout so a slow sibling image does not
/// fail later images with `nomad_busy`.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preempt_cancels_and_bumps_generation() {
        assert!(nomad_link_schedule_cancels_prior(
            NomadLinkSchedule::Preempt
        ));
        assert!(nomad_link_schedule_bumps_generation(
            NomadLinkSchedule::Preempt
        ));
        assert!(!nomad_link_schedule_cancels_prior(NomadLinkSchedule::Queue));
        assert!(!nomad_link_schedule_bumps_generation(
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
}
