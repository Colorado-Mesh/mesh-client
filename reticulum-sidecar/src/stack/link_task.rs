//! Runs `rns-runtime` rnsh/rncp futures on a dedicated OS thread with its own
//! single-threaded Tokio runtime.
//!
//! `rnsh_client_execute` / `rncp_send_file` / `rncp_fetch_file` hold
//! non-`Sync` `Link` / `dyn MessageBase` references across internal await
//! points, so the futures they return are not `Send`. The sidecar's
//! `#[tokio::main]` runtime is multi-threaded, so `tokio::spawn` (which
//! requires `Send`) cannot drive them directly. `Runtime::block_on` has no
//! such bound, so running each call on its own current-thread runtime lets
//! it stay on one OS thread for its whole lifetime.

use std::future::Future;

use tokio::sync::oneshot;

/// `make_future` runs *on the spawned thread*, immediately before its result
/// is awaited, so the non-`Send` future it returns never has to cross a
/// thread boundary — only `make_future` itself (and whatever it captures)
/// must be `Send`.
///
/// Returns the OS thread handle (poll `is_finished()` to reclaim slots once
/// the call completes) and a `oneshot` sender: sending on it requests
/// best-effort cancellation by dropping the future without waiting for it to
/// reach a checkpoint. Cleanup that only runs on the library call's normal
/// completion/error paths (e.g. destination deregistration) may be skipped
/// when cancelled this way.
pub fn spawn_link_task<F, Fut>(
    thread_name: String,
    make_future: F,
) -> std::io::Result<(std::thread::JoinHandle<()>, oneshot::Sender<()>)>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + 'static,
{
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let thread = std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    tracing::warn!("link task runtime build failed: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                tokio::select! {
                    () = make_future() => {}
                    _ = cancel_rx => {}
                }
            });
        })?;
    Ok((thread, cancel_tx))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn runs_future_to_completion() {
        let (done_tx, done_rx) = std::sync::mpsc::channel::<u32>();
        let (thread, cancel_tx) = spawn_link_task("lt-complete".to_string(), move || async move {
            done_tx.send(42).expect("send completion marker");
        })
        .expect("spawn link task");
        assert_eq!(
            done_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("future ran"),
            42
        );
        thread.join().expect("thread joined cleanly");
        drop(cancel_tx);
    }

    #[test]
    fn cancel_drops_pending_future() {
        let (thread, cancel_tx) =
            spawn_link_task("lt-cancel".to_string(), std::future::pending::<()>)
                .expect("spawn link task");
        cancel_tx.send(()).expect("cancel signal accepted");
        thread.join().expect("thread joined after cancel");
    }

    #[test]
    fn dropping_cancel_sender_also_unblocks_pending_future() {
        // Handle teardown without an explicit cancel (e.g. prune) drops the
        // sender; the select arm must complete on the closed channel too.
        let (thread, cancel_tx) =
            spawn_link_task("lt-drop".to_string(), std::future::pending::<()>)
                .expect("spawn link task");
        drop(cancel_tx);
        thread.join().expect("thread joined after sender drop");
    }
}
