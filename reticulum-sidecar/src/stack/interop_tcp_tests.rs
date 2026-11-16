//! Dual `StackHandle` TCP interop (LXMF DM, stack settings, LXST signalling).

use std::net::TcpListener;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::broadcast;

use super::StackHandle;
use super::config::{self, StackSettingsPatch};
use super::types::LxmfSendRequest;

const READY_POLL: Duration = Duration::from_millis(400);
const READY_TIMEOUT: Duration = Duration::from_secs(45);
const PEER_TIMEOUT: Duration = Duration::from_secs(45);
const INBOUND_TIMEOUT: Duration = Duration::from_secs(45);
const VOICE_TIMEOUT: Duration = Duration::from_secs(45);

struct TcpStackFixture {
    _dir: tempfile::TempDir,
    handle: Arc<StackHandle>,
}

fn ephemeral_loopback_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral tcp");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

fn write_tcp_stack_config(dir: &Path, server: bool, port: u16) {
    let iface = if server {
        format!(
            r#"
  [[Interop TCP Server]]
    type = TCPServerInterface
    interface_enabled = Yes
    listen_ip = 127.0.0.1
    listen_port = {port}
"#
        )
    } else {
        format!(
            r#"
  [[Interop TCP Client]]
    type = TCPClientInterface
    interface_enabled = Yes
    target_host = 127.0.0.1
    target_port = {port}
"#
        )
    };
    let content = format!(
        r#"[reticulum]
  share_instance = No
  enable_transport = Yes
  link_mtu_discovery = Yes
[stamps]
  stamp_destinations = No
  stamp_prs = No
  enforce_stamps = No
[logging]
  loglevel = 3
[interfaces]
{iface}"#
    );
    std::fs::create_dir_all(dir).expect("config dir");
    std::fs::write(dir.join("config"), content).expect("write stack config");
}

async fn spawn_tcp_stack(server: bool, port: u16) -> TcpStackFixture {
    let dir = tempfile::tempdir().expect("temp stack dir");
    let config_dir = dir.path().join("config");
    let storage_dir = dir.path().join("storage");
    std::fs::create_dir_all(&storage_dir).expect("storage dir");
    write_tcp_stack_config(&config_dir, server, port);
    let (events, _) = broadcast::channel(256);
    let handle = Arc::new(Box::pin(StackHandle::bootstrap(config_dir, storage_dir, events)).await);
    handle
        .identity_generate(None, false)
        .await
        .expect("identity_generate");
    handle.attach_live().await.expect("attach_live");
    wait_stack_ready(&handle, READY_TIMEOUT)
        .await
        .expect("stack ready");
    TcpStackFixture { _dir: dir, handle }
}

async fn wait_stack_ready(stack: &StackHandle, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if stack.rns_ready().await && stack.lxmf_ready().await {
            return Ok(());
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err("timeout waiting for rns_ready/lxmf_ready".into())
}

async fn wait_peer_lxmf_path(
    stack: &StackHandle,
    peer_lxmf_hash: &str,
    timeout: Duration,
) -> Result<(), String> {
    let needle = peer_lxmf_hash.to_lowercase();
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let peers = stack.list_peers().await;
        if peers
            .iter()
            .any(|row| row.destination_hash.eq_ignore_ascii_case(&needle))
        {
            return Ok(());
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(format!(
        "timeout waiting for path to peer lxmf hash {peer_lxmf_hash}"
    ))
}

async fn wait_inbound_text(
    stack: &StackHandle,
    expected_text: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let rows = stack.list_recent_inbound_lxmf(None, None, 32);
        if rows.iter().any(|row| {
            row.get("text")
                .and_then(|v| v.as_str())
                .is_some_and(|t| t == expected_text)
        }) {
            return Ok(());
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(format!(
        "timeout waiting for inbound lxmf text {expected_text:?}"
    ))
}

async fn wait_voice_status<F>(
    stack: &StackHandle,
    timeout: Duration,
    predicate: F,
) -> Result<serde_json::Value, String>
where
    F: Fn(&serde_json::Value) -> bool,
{
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let status = stack.voice_status().await;
        if predicate(&status) {
            return Ok(status);
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err("timeout waiting for voice status".into())
}

async fn bootstrap_dual_tcp() -> (TcpStackFixture, TcpStackFixture) {
    let port = ephemeral_loopback_port();
    let server = spawn_tcp_stack(true, port).await;
    // Server listener should be up before the client dials in.
    let client = spawn_tcp_stack(false, port).await;
    let server_id = server.handle.identity_status().await;
    let client_id = client.handle.identity_status().await;
    assert!(server_id.configured);
    assert!(client_id.configured);
    wait_peer_lxmf_path(&client.handle, &server_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path to server");
    wait_peer_lxmf_path(&server.handle, &client_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("server path to client");
    (server, client)
}

async fn teardown_dual(server: &TcpStackFixture, client: &TcpStackFixture) {
    let _ = server.handle.detach_live().await;
    let _ = client.handle.detach_live().await;
}

#[tokio::test]
async fn stack_settings_stamps_and_mtu_round_trip() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config_dir = dir.path().join("config");
    std::fs::create_dir_all(&config_dir).expect("config");
    write_tcp_stack_config(&config_dir, false, 42_424);
    let (events, _) = broadcast::channel(8);
    let storage_dir = dir.path().join("storage");
    std::fs::create_dir_all(&storage_dir).expect("storage");
    let stack = Arc::new(
        Box::pin(StackHandle::bootstrap(
            config_dir.clone(),
            storage_dir,
            events,
        ))
        .await,
    );

    stack
        .patch_stack_settings(&StackSettingsPatch {
            enable_stamping: Some(true),
            enforce_stamps: Some(true),
            link_mtu_discovery: Some(false),
            ..StackSettingsPatch::default()
        })
        .await
        .expect("patch stamps/mtu");

    let loaded = config::get_stack_settings(&config_dir).expect("get settings");
    assert!(loaded.enable_stamping);
    assert!(loaded.enforce_stamps);
    assert!(!loaded.link_mtu_discovery);

    stack
        .patch_stack_settings(&StackSettingsPatch {
            enable_stamping: Some(false),
            enforce_stamps: Some(false),
            link_mtu_discovery: Some(true),
            ..StackSettingsPatch::default()
        })
        .await
        .expect("patch revert");

    let reread = config::get_stack_settings(&config_dir).expect("get settings again");
    assert!(!reread.enable_stamping);
    assert!(!reread.enforce_stamps);
    assert!(reread.link_mtu_discovery);
}

#[tokio::test]
async fn dual_tcp_lxmf_dm_stamps_off() {
    let (server, client) = bootstrap_dual_tcp().await;
    let server_id = server.handle.identity_status().await;
    let body = format!("interop-tcp-dm-{}", uuid::Uuid::new_v4());
    let req = LxmfSendRequest {
        destination_hash: server_id.lxmf_hash.clone(),
        text: body.clone(),
        reply_to_hash: None,
        reply_to_id: None,
        reply_preview_text: None,
        audio: None,
        attachments: vec![],
        image: None,
    };
    let send = client.handle.lxmf_send(req).await.expect("lxmf_send");
    assert_eq!(send.get("ok"), Some(&serde_json::Value::Bool(true)));
    wait_inbound_text(&server.handle, &body, INBOUND_TIMEOUT)
        .await
        .expect("inbound dm");
    teardown_dual(&server, &client).await;
}

#[tokio::test]
async fn dual_tcp_voice_signalling_smoke() {
    let (server, client) = bootstrap_dual_tcp().await;
    let server_id = server.handle.identity_status().await;
    let call = client.handle.voice_call(&server_id.identity_hash).await;
    assert_eq!(call.get("ok"), Some(&serde_json::Value::Bool(true)));

    let _incoming = wait_voice_status(&server.handle, VOICE_TIMEOUT, |st| {
        st.get("active_call")
            .and_then(|c| c.get("status"))
            .and_then(|v| v.as_str())
            == Some("ringing")
    })
    .await
    .expect("server ringing");

    let answer = server.handle.voice_answer().await;
    assert_eq!(answer.get("ok"), Some(&serde_json::Value::Bool(true)));

    let _established = wait_voice_status(&client.handle, VOICE_TIMEOUT, |st| {
        st.get("active_call")
            .and_then(|c| c.get("status"))
            .and_then(|v| v.as_str())
            == Some("established")
    })
    .await
    .expect("call established");

    let hang_a = client.handle.voice_hangup().await;
    let hang_b = server.handle.voice_hangup().await;
    assert_eq!(hang_a.get("ok"), Some(&serde_json::Value::Bool(true)));
    assert_eq!(hang_b.get("ok"), Some(&serde_json::Value::Bool(true)));

    teardown_dual(&server, &client).await;
}

#[tokio::test]
#[ignore = "stamp enforcement over loopback TCP is timing-sensitive in CI"]
async fn dual_tcp_require_stamps_blocks_then_retry() {
    let port = ephemeral_loopback_port();
    let server = spawn_tcp_stack(true, port).await;
    let client = spawn_tcp_stack(false, port).await;

    server
        .handle
        .patch_stack_settings(&StackSettingsPatch {
            enforce_stamps: Some(true),
            ..StackSettingsPatch::default()
        })
        .await
        .expect("enforce on server");
    server.handle.soft_restart().await.expect("server restart");

    let server_id = server.handle.identity_status().await;
    let body = format!("interop-stamp-{}", uuid::Uuid::new_v4());
    let req = LxmfSendRequest {
        destination_hash: server_id.lxmf_hash.clone(),
        text: body.clone(),
        reply_to_hash: None,
        reply_to_id: None,
        reply_preview_text: None,
        audio: None,
        attachments: vec![],
        image: None,
    };

    wait_peer_lxmf_path(&client.handle, &server_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path before blocked send");

    let blocked = client.handle.lxmf_send(req.clone()).await;
    let blocked_ok = blocked
        .as_ref()
        .ok()
        .and_then(|v| v.get("ok"))
        .and_then(serde_json::Value::as_bool);
    let delivery_seen = wait_inbound_text(&server.handle, &body, Duration::from_secs(8)).await;
    assert!(
        blocked_ok != Some(true) || delivery_seen.is_err(),
        "expected stamp enforcement to block or prevent delivery"
    );

    client
        .handle
        .patch_stack_settings(&StackSettingsPatch {
            enable_stamping: Some(true),
            ..StackSettingsPatch::default()
        })
        .await
        .expect("enable stamping on client");
    client.handle.soft_restart().await.expect("client restart");
    wait_stack_ready(&client.handle, READY_TIMEOUT)
        .await
        .expect("client ready after restart");
    wait_peer_lxmf_path(&client.handle, &server_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path after restart");

    let retry = client.handle.lxmf_send(req).await.expect("stamped resend");
    assert_eq!(retry.get("ok"), Some(&serde_json::Value::Bool(true)));
    wait_inbound_text(&server.handle, &body, INBOUND_TIMEOUT)
        .await
        .expect("stamped dm delivered");

    teardown_dual(&server, &client).await;
}
