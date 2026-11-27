//! C ABI that runs the mesh-client Reticulum sidecar in-process.
//!
//! iOS apps cannot spawn processes, so the Swift `MeshProcess` plugin runs the sidecar on a
//! background thread of the app instead of exec'ing `mesh-client-reticulum`. The contract is the
//! process contract: the same argv (minus the program name), the one-line JSON bootstrap on stdin,
//! tracing and `validate-config` output on the stdout/stderr pipes, the loopback HTTP API, and an
//! exit status. The plugin creates three pipes and hands this library one end of each; see
//! `include/mesh_reticulum.h` for the calling sequence.
//!
//! Differences from the executable, all invisible to Electron main:
//! - tracing goes to the instance's stderr descriptor (the executable writes it to stdout; main
//!   parses both pipes the same way);
//! - `RUST_LOG` comes from the spawn `env` JSON instead of the process environment;
//! - clap's `--help` / usage errors are written to the descriptors and returned as an exit code
//!   instead of calling `process::exit`, which would end the app;
//! - "kill" is [`mesh_reticulum_stop`]: it drops the sidecar future and shuts down its Tokio
//!   runtime, which cancels every task (HTTP server, live stack) and releases its sockets.

use std::cell::Cell;
use std::collections::HashMap;
use std::ffi::{CStr, c_char, c_int};
use std::fs::File;
use std::io::{self, Write};
use std::os::fd::{FromRawFd, OwnedFd};
use std::os::unix::fs::FileTypeExt;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;

use clap::Parser;
use mesh_client_reticulum::Cli;
use tokio::io::AsyncRead;
use tokio::sync::oneshot;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Registry, reload};

/// `mesh_reticulum_start`: argv/env JSON or a descriptor was invalid.
pub const MESH_RETICULUM_ERR_INVALID_ARGUMENT: i64 = -1;
/// `mesh_reticulum_start`: the sidecar thread could not be created.
pub const MESH_RETICULUM_ERR_START_FAILED: i64 = -2;
/// `mesh_reticulum_stop` / `mesh_reticulum_wait`: no such instance (or already waited).
pub const MESH_RETICULUM_ERR_UNKNOWN_INSTANCE: i32 = -1;
/// `mesh_reticulum_wait`: the instance ended because `mesh_reticulum_stop` was called.
pub const MESH_RETICULUM_EXIT_STOPPED: i32 = -15;
/// `mesh_reticulum_wait`: the sidecar panicked or its runtime could not be built.
pub const MESH_RETICULUM_EXIT_PANICKED: i32 = 101;

const PROGRAM_NAME: &str = "mesh-client-reticulum";
/// Bound on waiting for blocking-pool work after stop; tasks themselves are cancelled at once.
const RUNTIME_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

struct Instance {
    stop: Mutex<Option<oneshot::Sender<()>>>,
    thread: Mutex<Option<JoinHandle<i32>>>,
}

static NEXT_INSTANCE: AtomicI64 = AtomicI64::new(1);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn instances() -> MutexGuard<'static, HashMap<i64, Arc<Instance>>> {
    static INSTANCES: OnceLock<Mutex<HashMap<i64, Arc<Instance>>>> = OnceLock::new();
    lock(INSTANCES.get_or_init(Mutex::default))
}

// ─── Logging: one global subscriber, routed per instance ────────────────────────────────

thread_local! {
    /// Instance owning this thread (its runtime workers and blocking pool); 0 = none.
    static THREAD_INSTANCE: Cell<i64> = const { Cell::new(0) };
}

struct LogSink {
    instance: i64,
    stderr: Arc<File>,
    /// Receives events from threads no instance owns (stack-internal std threads). Only serving
    /// instances qualify, so a short `validate-config` run does not capture stack logs.
    fallback: bool,
}

fn log_sinks() -> MutexGuard<'static, Vec<LogSink>> {
    static SINKS: OnceLock<Mutex<Vec<LogSink>>> = OnceLock::new();
    lock(SINKS.get_or_init(Mutex::default))
}

/// `MakeWriter` that resolves the current thread's instance stderr for every event.
struct RoutedStderr;

/// One event's writer; `None` discards (no live instance).
struct SinkWriter(Option<Arc<File>>);

impl Write for SinkWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match &self.0 {
            Some(file) => (&**file).write(buf),
            None => Ok(buf.len()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match &self.0 {
            Some(file) => (&**file).flush(),
            None => Ok(()),
        }
    }
}

impl<'a> MakeWriter<'a> for RoutedStderr {
    type Writer = SinkWriter;

    fn make_writer(&'a self) -> Self::Writer {
        let instance = THREAD_INSTANCE.get();
        let sinks = log_sinks();
        let sink = sinks
            .iter()
            .find(|sink| sink.instance == instance)
            .or_else(|| sinks.iter().rev().find(|sink| sink.fallback));
        SinkWriter(sink.map(|sink| Arc::clone(&sink.stderr)))
    }
}

/// Install the process-wide subscriber once (a global default can only be set once per
/// process); later starts only swap the filter.
fn log_filter() -> Option<&'static reload::Handle<EnvFilter, Registry>> {
    static FILTER: OnceLock<Option<reload::Handle<EnvFilter, Registry>>> = OnceLock::new();
    FILTER
        .get_or_init(|| {
            let (filter, handle) = reload::Layer::new(EnvFilter::new("info"));
            // Same event format as the executable: no ANSI, default fields and timestamps.
            let fmt = tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(RoutedStderr);
            // Fails only when the host app already installed a global subscriber.
            tracing_subscriber::registry()
                .with(filter)
                .with(fmt)
                .try_init()
                .ok()
                .map(|()| handle)
        })
        .as_ref()
}

/// Apply this start's `RUST_LOG` like the executable's `EnvFilter::try_from_default_env`.
fn apply_rust_log(rust_log: Option<&str>) {
    let Some(handle) = log_filter() else { return };
    let filter = rust_log
        .and_then(|directives| EnvFilter::try_new(directives).ok())
        .unwrap_or_else(|| EnvFilter::new("info"));
    let _ = handle.reload(filter);
}

// ─── Start / stop / wait ────────────────────────────────────────────────────────────────

struct StartRequest {
    args: Vec<String>,
    stdin: OwnedFd,
    stdout: File,
    stderr: Arc<File>,
}

fn parse_args(argv_json: &str) -> Option<Vec<String>> {
    serde_json::from_str::<Vec<String>>(argv_json).ok()
}

fn parse_rust_log(env_json: Option<&str>) -> Result<Option<String>, ()> {
    let Some(json) = env_json else {
        return Ok(None);
    };
    let env: HashMap<String, String> = serde_json::from_str(json).map_err(|_| ())?;
    Ok(env.get("RUST_LOG").cloned())
}

/// Async stdin over the plugin's pipe; a pipe is registered with the reactor so stop cancels a
/// pending read, anything else falls back to a blocking-pool reader.
fn async_stdin(fd: OwnedFd) -> io::Result<Box<dyn AsyncRead + Unpin + Send>> {
    let file = File::from(fd);
    if file.metadata()?.file_type().is_fifo() {
        let receiver = tokio::net::unix::pipe::Receiver::from_file(file)?;
        Ok(Box::new(receiver))
    } else {
        Ok(Box::new(tokio::fs::File::from_std(file)))
    }
}

/// Write clap's rendered `--help` / usage error to the instance pipes (never `process::exit`).
fn report_clap_error<'a>(
    error: &clap::Error,
    stdout: &'a mut dyn Write,
    stderr: &'a mut dyn Write,
) -> i32 {
    // Same stream choice as clap's own `exit()`: help/version on stdout, errors on stderr.
    let sink = if error.use_stderr() { stderr } else { stdout };
    let _ = sink.write_all(error.render().to_string().as_bytes());
    let _ = sink.flush();
    error.exit_code()
}

fn run_instance(id: i64, request: StartRequest, stop: oneshot::Receiver<()>) -> i32 {
    THREAD_INSTANCE.set(id);
    let StartRequest {
        args,
        stdin,
        mut stdout,
        stderr,
    } = request;
    let mut stderr_writer: &File = &stderr;

    let cli = match Cli::try_parse_from(std::iter::once(PROGRAM_NAME.to_string()).chain(args)) {
        Ok(cli) => cli,
        Err(error) => return report_clap_error(&error, &mut stdout, &mut stderr_writer),
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name(format!("mesh-reticulum-{id}"))
        .on_thread_start(move || THREAD_INSTANCE.set(id))
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            let _ = writeln!(stderr_writer, "failed to start sidecar runtime: {error}");
            return MESH_RETICULUM_EXIT_PANICKED;
        }
    };

    let code = runtime.block_on(async {
        let stdin = match async_stdin(stdin) {
            Ok(stdin) => stdin,
            Err(error) => {
                let _ = writeln!(stderr_writer, "failed to open sidecar stdin: {error}");
                return 1;
            }
        };
        tokio::select! {
            code = mesh_client_reticulum::run(cli, stdin, &mut stdout, &mut stderr_writer) => {
                i32::from(code)
            }
            _ = stop => MESH_RETICULUM_EXIT_STOPPED,
        }
    });
    // Cancels every remaining task (HTTP server, live stack) and drops their sockets.
    runtime.shutdown_timeout(RUNTIME_SHUTDOWN_TIMEOUT);
    let _ = stdout.flush();
    code
}

/// Thread body: run, then unregister the log sink so the last stderr reference closes and the
/// plugin's readers see EOF (stdout closes when `run_instance` returns).
fn instance_main(id: i64, request: StartRequest, stop: oneshot::Receiver<()>) -> i32 {
    let code = catch_unwind(AssertUnwindSafe(|| run_instance(id, request, stop)))
        .unwrap_or(MESH_RETICULUM_EXIT_PANICKED);
    log_sinks().retain(|sink| sink.instance != id);
    code
}

fn start(request: StartRequest, rust_log: Option<&str>) -> i64 {
    apply_rust_log(rust_log);
    let id = NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed);
    let fallback = !request.args.iter().any(|arg| arg == "validate-config");
    log_sinks().push(LogSink {
        instance: id,
        stderr: Arc::clone(&request.stderr),
        fallback,
    });
    let (stop_tx, stop_rx) = oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name(format!("mesh-reticulum-{id}"))
        .spawn(move || instance_main(id, request, stop_rx));
    // On failure the closure (and with it every descriptor) is dropped, closing them.
    let Ok(thread) = spawned else {
        log_sinks().retain(|sink| sink.instance != id);
        return MESH_RETICULUM_ERR_START_FAILED;
    };
    instances().insert(
        id,
        Arc::new(Instance {
            stop: Mutex::new(Some(stop_tx)),
            thread: Mutex::new(Some(thread)),
        }),
    );
    id
}

/// Take ownership of a caller descriptor; `None` for negative values.
fn owned_fd(fd: c_int) -> Option<OwnedFd> {
    // SAFETY: the C contract transfers ownership of each non-negative descriptor to this
    // library, which closes it exactly once (when the returned `OwnedFd` drops).
    #[allow(unsafe_code)]
    (fd >= 0).then(|| unsafe { OwnedFd::from_raw_fd(fd) })
}

/// Darwin `<sys/fcntl.h>`: per-descriptor SIGPIPE suppression (not exported by `libc`).
#[cfg(target_vendor = "apple")]
const F_SETNOSIGPIPE: c_int = 73;

/// An embedding app keeps SIGPIPE's default disposition (terminate): Rust only ignores it in
/// executables. Without this, a log line written after the plugin closed its read end would
/// kill the app instead of failing with EPIPE. Best effort; a failure leaves the default.
#[cfg(target_vendor = "apple")]
fn suppress_sigpipe(fd: &OwnedFd) {
    use std::os::fd::AsRawFd;
    // SAFETY: fcntl on an open descriptor this library owns; the int argument is not a pointer.
    #[allow(unsafe_code)]
    unsafe {
        libc::fcntl(fd.as_raw_fd(), F_SETNOSIGPIPE, 1);
    }
}

/// Elsewhere (host tests) the process already ignores SIGPIPE.
#[cfg(not(target_vendor = "apple"))]
fn suppress_sigpipe(_fd: &OwnedFd) {}

/// Borrow an optional NUL-terminated UTF-8 C string.
///
/// # Safety
/// `ptr` must be null or point to a NUL-terminated string valid for this call.
#[allow(unsafe_code)]
unsafe fn c_str<'a>(ptr: *const c_char) -> Result<Option<&'a str>, ()> {
    if ptr.is_null() {
        return Ok(None);
    }
    // SAFETY: non-null and NUL-terminated per this function's contract.
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .map(Some)
        .map_err(|_| ())
}

/// Start one sidecar instance on a new background thread. See `include/mesh_reticulum.h`.
///
/// Returns a positive instance id, or a negative `MESH_RETICULUM_ERR_*`. The library owns all
/// three descriptors from this call on, including on error.
///
/// # Safety
/// `argv_json` must be a NUL-terminated string and `env_json` null or NUL-terminated, both
/// valid for the duration of the call. Each descriptor must be open and owned by the caller,
/// who must not use or close it afterwards.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mesh_reticulum_start(
    argv_json: *const c_char,
    env_json: *const c_char,
    stdin_fd: c_int,
    stdout_fd: c_int,
    stderr_fd: c_int,
) -> i64 {
    let (stdin, stdout, stderr) = (owned_fd(stdin_fd), owned_fd(stdout_fd), owned_fd(stderr_fd));
    // SAFETY: forwarded caller contract for both strings.
    let (argv_text, env_text) = unsafe { (c_str(argv_json), c_str(env_json)) };
    let (Some(stdin), Some(stdout), Some(stderr), Ok(Some(argv_text)), Ok(env_text)) =
        (stdin, stdout, stderr, argv_text, env_text)
    else {
        return MESH_RETICULUM_ERR_INVALID_ARGUMENT;
    };
    let (Some(args), Ok(rust_log)) = (parse_args(argv_text), parse_rust_log(env_text)) else {
        return MESH_RETICULUM_ERR_INVALID_ARGUMENT;
    };
    suppress_sigpipe(&stdout);
    suppress_sigpipe(&stderr);
    start(
        StartRequest {
            args,
            stdin,
            stdout: File::from(stdout),
            stderr: Arc::new(File::from(stderr)),
        },
        rust_log.as_deref(),
    )
}

/// Ask an instance to stop (the in-process equivalent of killing the child). Non-blocking;
/// returns 0, or `MESH_RETICULUM_ERR_UNKNOWN_INSTANCE`. Stopping an exited instance is a no-op.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn mesh_reticulum_stop(instance: i64) -> i32 {
    let Some(entry) = instances().get(&instance).cloned() else {
        return MESH_RETICULUM_ERR_UNKNOWN_INSTANCE;
    };
    if let Some(stop) = lock(&entry.stop).take() {
        let _ = stop.send(());
    }
    0
}

/// Block until an instance exits and release it; call exactly once per started instance, off
/// the main thread. Returns the exit status (0-255), `MESH_RETICULUM_EXIT_STOPPED`,
/// `MESH_RETICULUM_EXIT_PANICKED`, or `MESH_RETICULUM_ERR_UNKNOWN_INSTANCE`.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn mesh_reticulum_wait(instance: i64) -> i32 {
    let Some(entry) = instances().get(&instance).cloned() else {
        return MESH_RETICULUM_ERR_UNKNOWN_INSTANCE;
    };
    let Some(thread) = lock(&entry.thread).take() else {
        return MESH_RETICULUM_ERR_UNKNOWN_INSTANCE;
    };
    let code = thread.join().unwrap_or(MESH_RETICULUM_EXIT_PANICKED);
    instances().remove(&instance);
    code
}

#[cfg(test)]
mod tests;
