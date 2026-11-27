//! Host tests of the C ABI with real pipes: the same sequence the Swift plugin performs.

use std::ffi::CString;
use std::io::{PipeReader, PipeWriter, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::fd::{IntoRawFd, OwnedFd};
use std::sync::{Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::*;

/// Instances share the global subscriber and registry; run scenarios one at a time.
static SERIAL: Mutex<()> = Mutex::new(());

const AUTH_TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ISSUER_TOKEN: &str = "ggggggggggggggggggggggggggggggggggggggggggg";
const SESSION_ID: &str = "QQQQQQQQQQQQQQQQQQQQQQ";

struct Spawned {
    id: i64,
    stdin: Option<PipeWriter>,
    stdout: JoinHandle<String>,
    stderr: JoinHandle<String>,
}

fn drain(mut reader: PipeReader) -> JoinHandle<String> {
    thread::spawn(move || {
        let mut text = String::new();
        let _ = reader.read_to_string(&mut text);
        text
    })
}

fn raw(fd: impl Into<OwnedFd>) -> c_int {
    fd.into().into_raw_fd()
}

fn spawn(args: &[&str], env: Option<&str>) -> Spawned {
    let (stdin_read, stdin_write) = std::io::pipe().unwrap();
    let (stdout_read, stdout_write) = std::io::pipe().unwrap();
    let (stderr_read, stderr_write) = std::io::pipe().unwrap();
    let argv_json = CString::new(serde_json::to_string(args).unwrap()).unwrap();
    let env = env.map(|json| CString::new(json).unwrap());
    // SAFETY: valid C strings for the call; ownership of the three fds moves to the library.
    #[allow(unsafe_code)]
    let id = unsafe {
        mesh_reticulum_start(
            argv_json.as_ptr(),
            env.as_ref().map_or(std::ptr::null(), |env| env.as_ptr()),
            raw(stdin_read),
            raw(stdout_write),
            raw(stderr_write),
        )
    };
    assert!(id > 0, "start failed: {id}");
    Spawned {
        id,
        stdin: Some(stdin_write),
        stdout: drain(stdout_read),
        stderr: drain(stderr_read),
    }
}

/// Wait for exit and both pipes' EOF, like the plugin does before emitting `exit`.
fn finish(mut spawned: Spawned) -> (i32, String, String) {
    drop(spawned.stdin.take());
    let code = mesh_reticulum_wait(spawned.id);
    (
        code,
        spawned.stdout.join().unwrap(),
        spawned.stderr.join().unwrap(),
    )
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Minimal HTTP/1.1 client: `(status code, raw response)`, `None` when nothing listens.
fn http(port: u16, request_line: &str, auth: bool, body: &str) -> Option<(u16, String)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .ok()?;
    let auth = if auth {
        format!("Authorization: Bearer {AUTH_TOKEN}\r\n")
    } else {
        String::new()
    };
    write!(
        stream,
        "{request_line} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let code = response.split(' ').nth(1)?.parse().ok()?;
    Some((code, response))
}

fn get_status(port: u16) -> Option<(u16, String)> {
    http(port, "GET /api/v1/status", true, "")
}

fn wait_for_status(port: u16, needle: &str, budget: Duration) -> String {
    let deadline = Instant::now() + budget;
    loop {
        if let Some((200, body)) = get_status(port)
            && body.contains(needle)
        {
            return body;
        }
        assert!(Instant::now() < deadline, "no {needle} on :{port}");
        thread::sleep(Duration::from_millis(200));
    }
}

fn serve_args<'a>(port: &'a str, config: &'a str, storage: &'a str) -> Vec<&'a str> {
    vec![
        "--headless",
        "--host",
        "127.0.0.1",
        "--port",
        port,
        "--reticulum-config-dir",
        config,
        "--storage-dir",
        storage,
    ]
}

/// Local stand-in for a Reticulum TCP hub: hands every accepted connection to the test.
struct FakeHub {
    port: u16,
    connections: mpsc::Receiver<TcpStream>,
}

impl FakeHub {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, connections) = mpsc::channel();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if tx.send(stream).is_err() {
                    break;
                }
            }
        });
        Self { port, connections }
    }

    fn accept(&self) -> TcpStream {
        self.connections
            .recv_timeout(Duration::from_secs(30))
            .expect("live TCPClientInterface must connect to the hub")
    }
}

/// Drain a hub-side connection until the sidecar closes it (EOF or reset).
fn assert_closed_by_peer(mut stream: TcpStream) {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut buf = [0_u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => return,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => return,
            Err(error) => panic!("hub connection still open after stop: {error}"),
        }
    }
}

/// One serve cycle: bootstrap, authenticated status, stop. With the full stack it also brings up
/// live RNS with a TCP interface to `hub`, and checks stop tears that connection down.
fn serve_once(port: u16, config: &str, storage: &str, hub: &FakeHub) {
    let port_arg = port.to_string();
    let mut spawned = spawn(
        &serve_args(&port_arg, config, storage),
        Some(r#"{"RUST_LOG":"info","HOME":"/nonexistent"}"#),
    );
    let mut stdin = spawned.stdin.take().unwrap();
    writeln!(
        stdin,
        r#"{{"auth_token":"{AUTH_TOKEN}","capability_issuer_token":"{ISSUER_TOKEN}","capability_session_id":"{SESSION_ID}"}}"#
    )
    .unwrap();
    drop(stdin);

    wait_for_status(port, r#""status":"ok""#, Duration::from_secs(30));
    let mut hub_connection = None;
    if cfg!(feature = "rns-stack") {
        // Live RNS needs an identity and the hub interface (first cycle creates both; the
        // restart reuses the persisted ones), then the same `stack/start` Electron sends.
        let (code, response) = http(port, "GET /api/v1/identity/status", true, "").unwrap();
        assert_eq!(code, 200);
        if response.contains(r#""configured":false"#) {
            let generate = r#"{"display_name":"ffi-test"}"#;
            let (code, response) =
                http(port, "POST /api/v1/identity/generate", true, generate).unwrap();
            assert_eq!(code, 200, "{response}");
            let interface = format!(
                r#"{{"type":"tcp","name":"ffi test hub","host":"127.0.0.1","port":{}}}"#,
                hub.port
            );
            let (code, response) = http(port, "POST /api/v1/interfaces", true, &interface).unwrap();
            assert_eq!(code, 200, "{response}");
        }
        let (code, response) = http(port, "POST /api/v1/stack/start", true, "").unwrap();
        assert_eq!(code, 200, "{response}");
        wait_for_status(port, r#""rns_ready":true"#, Duration::from_secs(60));
        hub_connection = Some(hub.accept());
    }
    let (unauthorized, _) = http(port, "GET /api/v1/status", false, "").unwrap();
    assert_eq!(unauthorized, 401);

    assert_eq!(mesh_reticulum_stop(spawned.id), 0);
    let (code, stdout, stderr) = finish(spawned);
    assert_eq!(code, MESH_RETICULUM_EXIT_STOPPED);
    assert_eq!(stdout, "", "serve mode writes nothing to stdout");
    assert!(
        stderr.contains("INFO mesh_client_reticulum: listening"),
        "tracing must reach the instance stderr pipe: {stderr}"
    );
    assert!(get_status(port).is_none(), "port must be released on stop");
    if let Some(connection) = hub_connection {
        assert_closed_by_peer(connection);
    }
}

#[test]
fn start_status_stop_restart_on_same_port() {
    let _serial = lock(&SERIAL);
    let dirs = tempfile::tempdir().unwrap();
    let config = format!("{}/config", dirs.path().display());
    let storage = format!("{}/storage", dirs.path().display());
    let port = free_port();
    let hub = FakeHub::start();
    serve_once(port, &config, &storage, &hub);
    // Same process, same port and data dirs: nothing from the first instance may linger, and
    // the persisted hub interface must reconnect.
    serve_once(port, &config, &storage, &hub);
}

#[test]
fn help_and_usage_errors_return_instead_of_exiting() {
    let _serial = lock(&SERIAL);
    let (code, stdout, stderr) = finish(spawn(&["--help"], None));
    assert_eq!(code, 0);
    assert!(stdout.starts_with("Usage: mesh-client-reticulum [OPTIONS] [COMMAND]"));
    assert_eq!(stderr, "");

    let (code, stdout, stderr) = finish(spawn(&["--bogus"], None));
    assert_eq!(code, 2);
    assert_eq!(stdout, "");
    assert!(stderr.contains("unexpected argument '--bogus'"));
}

#[test]
fn validate_config_json_reaches_stdout_pipe() {
    let _serial = lock(&SERIAL);
    let dir = tempfile::tempdir().unwrap();
    let dir = dir.path().to_str().unwrap();
    let (code, stdout, _) = finish(spawn(
        &["validate-config", "--reticulum-config-dir", dir, "--json"],
        None,
    ));
    assert_eq!(code, 0);
    assert_eq!(stdout, "{\"issues\":[],\"ok\":true}\n");
}

#[test]
fn stop_cancels_a_pending_bootstrap_read() {
    let _serial = lock(&SERIAL);
    let dirs = tempfile::tempdir().unwrap();
    let port = free_port().to_string();
    let config = format!("{}/config", dirs.path().display());
    let storage = format!("{}/storage", dirs.path().display());
    // Keep stdin open and silent: the instance blocks on the bootstrap line.
    let spawned = spawn(&serve_args(&port, &config, &storage), None);
    thread::sleep(Duration::from_millis(300));
    let started = Instant::now();
    assert_eq!(mesh_reticulum_stop(spawned.id), 0);
    let code = mesh_reticulum_wait(spawned.id);
    assert_eq!(code, MESH_RETICULUM_EXIT_STOPPED);
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(
        mesh_reticulum_wait(spawned.id),
        MESH_RETICULUM_ERR_UNKNOWN_INSTANCE
    );
    drop(spawned.stdin);
    assert_eq!(spawned.stdout.join().unwrap(), "");
}

#[test]
fn invalid_arguments_are_rejected_and_fds_closed() {
    let _serial = lock(&SERIAL);
    let (stdin_read, _stdin_write) = std::io::pipe().unwrap();
    let (stdout_read, stdout_write) = std::io::pipe().unwrap();
    let (stderr_read, stderr_write) = std::io::pipe().unwrap();
    let argv = CString::new("not json").unwrap();
    // SAFETY: valid C string; fd ownership moves to the library.
    #[allow(unsafe_code)]
    let result = unsafe {
        mesh_reticulum_start(
            argv.as_ptr(),
            std::ptr::null(),
            raw(stdin_read),
            raw(stdout_write),
            raw(stderr_write),
        )
    };
    assert_eq!(result, MESH_RETICULUM_ERR_INVALID_ARGUMENT);
    // The library closed the write ends, so the readers see EOF instead of hanging.
    assert_eq!(drain(stdout_read).join().unwrap(), "");
    assert_eq!(drain(stderr_read).join().unwrap(), "");
    assert_eq!(
        mesh_reticulum_stop(i64::MAX),
        MESH_RETICULUM_ERR_UNKNOWN_INSTANCE
    );
}

#[test]
fn header_matches_exported_abi() {
    let header = include_str!("../include/mesh_reticulum.h");
    for (name, value) in [
        (
            "MESH_RETICULUM_ERR_INVALID_ARGUMENT",
            MESH_RETICULUM_ERR_INVALID_ARGUMENT,
        ),
        (
            "MESH_RETICULUM_ERR_START_FAILED",
            MESH_RETICULUM_ERR_START_FAILED,
        ),
        (
            "MESH_RETICULUM_ERR_UNKNOWN_INSTANCE",
            i64::from(MESH_RETICULUM_ERR_UNKNOWN_INSTANCE),
        ),
        (
            "MESH_RETICULUM_EXIT_STOPPED",
            i64::from(MESH_RETICULUM_EXIT_STOPPED),
        ),
        (
            "MESH_RETICULUM_EXIT_PANICKED",
            i64::from(MESH_RETICULUM_EXIT_PANICKED),
        ),
    ] {
        let define = format!("#define {name} ({value})");
        assert!(header.contains(&define), "header must declare `{define}`");
    }
    for signature in [
        "int64_t mesh_reticulum_start(const char *argv_json,",
        "int32_t mesh_reticulum_stop(int64_t instance);",
        "int32_t mesh_reticulum_wait(int64_t instance);",
    ] {
        assert!(
            header.contains(signature),
            "header must declare `{signature}`"
        );
    }
}

/// Writes to a closed pipe must fail with EPIPE instead of signalling the embedding app.
#[cfg(target_vendor = "apple")]
#[test]
fn output_pipes_do_not_raise_sigpipe() {
    use std::os::fd::AsRawFd;
    const F_GETNOSIGPIPE: c_int = 74;
    let (_read, write) = std::io::pipe().unwrap();
    let write = OwnedFd::from(write);
    suppress_sigpipe(&write);
    // SAFETY: fcntl query on an open descriptor owned by this test.
    #[allow(unsafe_code)]
    let flag = unsafe { libc::fcntl(write.as_raw_fd(), F_GETNOSIGPIPE) };
    assert_eq!(flag, 1);
}
