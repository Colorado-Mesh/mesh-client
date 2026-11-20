//! Dual `StackHandle` TCP interop (LXMF DM, stack settings, LXST signalling, LRGP).

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
const GAMES_TIMEOUT: Duration = Duration::from_secs(45);

struct TcpStackFixture {
    dir: tempfile::TempDir,
    handle: Arc<StackHandle>,
}

fn ephemeral_loopback_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral tcp");
    let port = listener.local_addr().expect("local_addr").port();
    drop(listener);
    port
}

fn write_tcp_stack_config(dir: &Path, server: bool, port: u16, enable_transport: bool) {
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
    let transport = if enable_transport { "Yes" } else { "No" };
    let content = format!(
        r#"[reticulum]
  share_instance = No
  enable_transport = {transport}
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
    spawn_tcp_stack_with_transport(server, port, true).await
}

async fn spawn_tcp_stack_with_transport(
    server: bool,
    port: u16,
    enable_transport: bool,
) -> TcpStackFixture {
    let dir = tempfile::tempdir().expect("temp stack dir");
    let config_dir = dir.path().join("config");
    let storage_dir = dir.path().join("storage");
    std::fs::create_dir_all(&storage_dir).expect("storage dir");
    write_tcp_stack_config(&config_dir, server, port, enable_transport);
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
    TcpStackFixture { dir, handle }
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

async fn wait_games_sessions(
    stack: &StackHandle,
    peer: &str,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let listed = stack.games_sessions(Some(peer)).await;
        let sessions = listed
            .get("sessions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if !sessions.is_empty() {
            return Ok(listed);
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(format!(
        "timeout waiting for games sessions with peer {peer}"
    ))
}

async fn wait_games_session_detail<F>(
    stack: &StackHandle,
    session_id: &str,
    timeout: Duration,
    predicate: F,
) -> Result<serde_json::Value, String>
where
    F: Fn(&serde_json::Value) -> bool,
{
    let deadline = Instant::now() + timeout;
    let mut last = serde_json::Value::Null;
    while Instant::now() < deadline {
        let detail = stack.games_session_detail(session_id).await;
        if let Some(session) = detail.get("session")
            && !session.is_null()
        {
            last = session.clone();
            if predicate(session) {
                return Ok(detail);
            }
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(format!(
        "timeout waiting for games session detail {session_id}; last={last}"
    ))
}

fn session_meta_str<'a>(session: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    session
        .get("metadata")
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
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

/// Two LXMF peers as TCP clients through a shared TCPServer transport hub.
/// Direct peer↔peer multi-message delivery is more reliable here than the
/// two-node TCPServer↔TCPClient fixture (which only delivers one Direct per
/// direction on loopback).
async fn bootstrap_hub_tcp() -> (TcpStackFixture, TcpStackFixture, TcpStackFixture) {
    let port = ephemeral_loopback_port();
    let hub = spawn_tcp_stack(true, port).await;
    let peer_a = spawn_tcp_stack(false, port).await;
    let peer_b = spawn_tcp_stack(false, port).await;
    let a_id = peer_a.handle.identity_status().await;
    let b_id = peer_b.handle.identity_status().await;
    assert!(a_id.configured);
    assert!(b_id.configured);
    peer_a.handle.announce_now().await.expect("peer_a announce");
    peer_b.handle.announce_now().await.expect("peer_b announce");
    peer_a
        .handle
        .request_peer_path_with_opts(&b_id.lxmf_hash, true)
        .await
        .expect("peer_a request path to b");
    peer_b
        .handle
        .request_peer_path_with_opts(&a_id.lxmf_hash, true)
        .await
        .expect("peer_b request path to a");
    wait_peer_lxmf_path(&peer_a.handle, &b_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("peer_a path to peer_b");
    wait_peer_lxmf_path(&peer_b.handle, &a_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("peer_b path to peer_a");
    (hub, peer_a, peer_b)
}

async fn teardown_dual(server: &TcpStackFixture, client: &TcpStackFixture) {
    let _ = server.handle.detach_live().await;
    let _ = client.handle.detach_live().await;
}

async fn teardown_hub(hub: &TcpStackFixture, a: &TcpStackFixture, b: &TcpStackFixture) {
    let _ = a.handle.detach_live().await;
    let _ = b.handle.detach_live().await;
    let _ = hub.handle.detach_live().await;
}

#[tokio::test]
async fn stack_settings_stamps_and_mtu_round_trip() {
    let dir = tempfile::tempdir().expect("tempdir");
    let config_dir = dir.path().join("config");
    std::fs::create_dir_all(&config_dir).expect("config");
    write_tcp_stack_config(&config_dir, false, 42_424, true);
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
async fn dual_tcp_four_in_a_row_wire_interop() {
    // Hub topology (manual-gold shape). Full play-to-win needs repeated Direct LXMF
    // in the same direction; on loopback dual-sidecar that currently delivers only
    // the first message per direction (challenge then accept works; moves stall).
    // This test proves LRGP four_in_a_row challenge→accept over the real wire.
    let (hub, challenger, opponent) = bootstrap_hub_tcp().await;
    let challenger_id = challenger.handle.identity_status().await;
    let opponent_id = opponent.handle.identity_status().await;

    let apps = opponent.handle.games_apps().await;
    let apps_list = apps
        .get("apps")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(
        apps_list.iter().any(|app| {
            app.get("app_id").and_then(|v| v.as_str()) == Some("four_in_a_row")
                && app.get("version").and_then(serde_json::Value::as_u64) == Some(1)
        }),
        "four_in_a_row v1 must be registered: {apps:?}"
    );

    let challenge = challenger
        .handle
        .games_send_action(
            &opponent_id.lxmf_hash,
            "four_in_a_row",
            "challenge",
            None,
            None,
        )
        .await
        .expect("challenge send");
    assert_eq!(challenge.get("ok"), Some(&serde_json::Value::Bool(true)));
    let session_id = challenge
        .get("session_id")
        .and_then(|v| v.as_str())
        .expect("session id")
        .to_string();

    wait_games_session_detail(&opponent.handle, &session_id, GAMES_TIMEOUT, |s| {
        s.get("status").and_then(|v| v.as_str()) == Some("pending")
            && session_meta_str(s, "first_turn")
                .is_some_and(|ft| ft.eq_ignore_ascii_case(&challenger_id.lxmf_hash))
            && session_meta_str(s, "board") == Some("__________________________________________")
    })
    .await
    .expect("opponent pending challenge");

    let accept = opponent
        .handle
        .games_send_action(
            &challenger_id.lxmf_hash,
            "four_in_a_row",
            "accept",
            Some(&session_id),
            None,
        )
        .await
        .expect("accept send");
    assert_eq!(accept.get("ok"), Some(&serde_json::Value::Bool(true)));

    wait_games_session_detail(&opponent.handle, &session_id, GAMES_TIMEOUT, |s| {
        s.get("status").and_then(|v| v.as_str()) == Some("active")
            && session_meta_str(s, "my_marker") == Some("B")
            && session_meta_str(s, "turn")
                .is_some_and(|t| t.eq_ignore_ascii_case(&challenger_id.lxmf_hash))
    })
    .await
    .expect("opponent active");
    wait_games_session_detail(&challenger.handle, &session_id, GAMES_TIMEOUT, |s| {
        s.get("status").and_then(|v| v.as_str()) == Some("active")
            && session_meta_str(s, "my_marker") == Some("A")
            && session_meta_str(s, "turn")
                .is_some_and(|t| t.eq_ignore_ascii_case(&challenger_id.lxmf_hash))
    })
    .await
    .expect("challenger active");

    // Confirm sessions are listed for the peer filter (wire + store path).
    wait_games_sessions(&opponent.handle, &challenger_id.lxmf_hash, GAMES_TIMEOUT)
        .await
        .expect("opponent lists challenger sessions");

    teardown_hub(&hub, &challenger, &opponent).await;
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
async fn dual_tcp_voice_audio_round_trip() {
    use base64::Engine as _;
    use lxst_core::Profile;

    let (server, client) = bootstrap_dual_tcp().await;
    let server_id = server.handle.identity_status().await;
    let call = client.handle.voice_call(&server_id.identity_hash).await;
    assert_eq!(call.get("ok"), Some(&serde_json::Value::Bool(true)));

    wait_voice_status(&server.handle, VOICE_TIMEOUT, |st| {
        st.get("active_call")
            .and_then(|c| c.get("status"))
            .and_then(|v| v.as_str())
            == Some("ringing")
    })
    .await
    .expect("server ringing");

    let answer = server.handle.voice_answer().await;
    assert_eq!(answer.get("ok"), Some(&serde_json::Value::Bool(true)));

    wait_voice_status(&client.handle, VOICE_TIMEOUT, |st| {
        st.get("active_call")
            .and_then(|c| c.get("status"))
            .and_then(|v| v.as_str())
            == Some("established")
    })
    .await
    .expect("call established");

    let mut audio_rx = server.handle.subscribe_voice_audio();
    let n = Profile::QualityHigh.sample_frames_per_packet()
        * usize::from(Profile::QualityHigh.channels());
    let mut bytes = Vec::with_capacity(n * 4);
    for _ in 0..n {
        bytes.extend_from_slice(&0f32.to_le_bytes());
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let mut got_frame = false;
    for attempt in 0..5 {
        let resp = client.handle.voice_audio(Some(1), 1, &b64).await;
        assert_eq!(
            resp.get("ok"),
            Some(&serde_json::Value::Bool(true)),
            "voice_audio attempt {attempt}: {resp:?}"
        );
        assert!(resp.get("dropped").is_none(), "frame dropped: {resp:?}");
        match tokio::time::timeout(Duration::from_secs(5), audio_rx.recv()).await {
            Ok(Ok(raw)) => {
                let parsed: serde_json::Value =
                    serde_json::from_str(&raw).expect("voice.audio json");
                let payload = parsed.get("payload").cloned().unwrap_or(parsed);
                let samples_b64 = payload
                    .get("samples_b64")
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| panic!("missing samples_b64: {payload:?}"));
                let samples = base64::engine::general_purpose::STANDARD
                    .decode(samples_b64)
                    .expect("samples_b64 must decode");
                let channels = payload
                    .get("channels")
                    .and_then(serde_json::Value::as_u64)
                    .expect("channels") as usize;
                assert_eq!(channels, 1);
                assert!(!samples.is_empty(), "PCM samples empty: {payload:?}");
                assert_eq!(
                    samples.len() % (channels * 4),
                    0,
                    "PCM byte length must align to f32 * channels: len={} channels={channels}",
                    samples.len()
                );
                got_frame = true;
                break;
            }
            Ok(Err(e)) => panic!("voice audio broadcast closed: {e}"),
            Err(_) => {}
        }
    }
    assert!(
        got_frame,
        "no PCM frame received on server after established call (Opus/headless?)"
    );

    let hang_a = client.handle.voice_hangup().await;
    let hang_b = server.handle.voice_hangup().await;
    assert_eq!(hang_a.get("ok"), Some(&serde_json::Value::Bool(true)));
    assert_eq!(hang_b.get("ok"), Some(&serde_json::Value::Bool(true)));

    teardown_dual(&server, &client).await;
}

#[tokio::test]
async fn dual_tcp_nomad_page_and_file() {
    // Direct TCPServer (host, transport) ↔ TCPClient (browser, leaf).
    let port = ephemeral_loopback_port();
    let host = spawn_tcp_stack_with_transport(true, port, true).await;
    let client = spawn_tcp_stack_with_transport(false, port, false).await;
    let host_id = host.handle.identity_status().await;
    let client_id = client.handle.identity_status().await;
    assert!(host_id.configured);
    assert!(client_id.configured);
    wait_peer_lxmf_path(&client.handle, &host_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path to host");
    wait_peer_lxmf_path(&host.handle, &client_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("host path to client");

    let site = host.dir.path().join("nomad-site");
    let pages = site.join("pages");
    let files = site.join("files");
    std::fs::create_dir_all(&pages).expect("pages dir");
    std::fs::create_dir_all(&files).expect("files dir");
    std::fs::write(
        pages.join("index.mu"),
        "# Interop\n\nHello from mesh-client.\n",
    )
    .expect("write index.mu");
    let probe_bytes = b"mesh-client-nomad-probe";
    std::fs::write(files.join("probe.bin"), probe_bytes).expect("write probe.bin");

    let status_src = host
        .handle
        .set_nomad_content_source(site.to_string_lossy().into_owned(), None)
        .await
        .expect("set_nomad_content_source");
    assert_eq!(
        status_src.content_layout.as_deref(),
        Some("site_root"),
        "content_layout={:?}",
        status_src.content_layout
    );

    host.handle
        .set_nomad_serving(true, Some("Interop Host".into()), None)
        .await
        .expect("set_nomad_serving");

    let deadline = Instant::now() + Duration::from_secs(45);
    let mut dest = String::new();
    while Instant::now() < deadline {
        let st = host.handle.nomad_serving_status().await;
        if st.running
            && let Some(hash) = st.destination_hash.clone()
        {
            dest = hash;
            break;
        }
        tokio::time::sleep(READY_POLL).await;
    }
    assert!(
        !dest.is_empty(),
        "nomad destination_hash missing while running"
    );
    let host_st = host.handle.nomad_serving_status().await;
    let host_identity = match host_st.identity_hash.clone() {
        Some(h) if !h.trim().is_empty() => h,
        _ => host.handle.identity_status().await.identity_hash,
    };
    assert!(
        !host_identity.trim().is_empty(),
        "host identity_hash missing for nomad link"
    );

    host.handle
        .set_nomad_serving(true, Some("Interop Host".into()), None)
        .await
        .expect("nomad re-announce");

    client
        .handle
        .request_peer_path_with_opts(&dest, true)
        .await
        .expect("request nomad path");
    wait_peer_lxmf_path(&client.handle, &dest, PEER_TIMEOUT)
        .await
        .expect("client path to nomad dest");

    let announce_deadline = Instant::now() + Duration::from_secs(15);
    let mut saw_announce = false;
    while Instant::now() < announce_deadline {
        let nodes = client.handle.list_nomad_nodes().await;
        if nodes.iter().any(|n| {
            n.destination_hash.eq_ignore_ascii_case(&dest)
                && n.identity_hash
                    .as_deref()
                    .is_some_and(|h| !h.trim().is_empty())
        }) {
            saw_announce = true;
            break;
        }
        tokio::time::sleep(READY_POLL).await;
    }
    let nodes = client.handle.list_nomad_nodes().await;
    assert!(
        saw_announce
            && nodes.iter().any(|n| {
                n.destination_hash.eq_ignore_ascii_case(&dest)
                    && n.identity_hash
                        .as_deref()
                        .is_some_and(|h| !h.trim().is_empty())
            }),
        "client did not discover nomad identity via announce for {dest}: {nodes:?}"
    );

    let file = client
        .handle
        .nomad_file(&dest, "/file/probe.bin", true, false)
        .await;
    assert_eq!(
        file.get("ok"),
        Some(&serde_json::Value::Bool(true)),
        "nomad_file: {file:?}"
    );
    let got = file
        .get("content_base64")
        .and_then(|v| v.as_str())
        .map(|b64| {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .expect("file b64")
        })
        .unwrap_or_default();
    assert_eq!(got, probe_bytes, "nomad_file body: {file:?}");

    let page = client
        .handle
        .nomad_page(&dest, "/page/index.mu", None, false, None, false)
        .await;
    assert_eq!(
        page.get("ok"),
        Some(&serde_json::Value::Bool(true)),
        "nomad_page: {page:?}"
    );
    let page_body = page
        .get("content")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .expect("page content");
    assert!(
        page_body.contains("Hello from mesh-client"),
        "unexpected page body: {page_body}"
    );

    // Traversal / escape must not yield the real file bytes (may surface as
    // not-found Micron with ok=true when the path hash misses the route table).
    let traversal = client
        .handle
        .nomad_file(&dest, "/page/../files/probe.bin", false, false)
        .await;
    let trav = traversal
        .get("content_base64")
        .and_then(|v| v.as_str())
        .map(|b64| {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .unwrap_or_default()
        })
        .unwrap_or_default();
    assert_ne!(
        trav.as_slice(),
        probe_bytes.as_slice(),
        "path traversal must not yield probe bytes: {traversal:?}"
    );

    std::fs::write(files.join(".secret"), b"do-not-serve").expect("dotfile");
    let dotfile = client
        .handle
        .nomad_file(&dest, "/file/.secret", false, false)
        .await;
    let dot = dotfile
        .get("content_base64")
        .and_then(|v| v.as_str())
        .map(|b64| {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .unwrap_or_default()
        })
        .unwrap_or_default();
    assert_ne!(
        dot.as_slice(),
        b"do-not-serve".as_slice(),
        "dotfile must not be served: {dotfile:?}"
    );

    teardown_dual(&host, &client).await;
}

#[tokio::test]
#[ignore = "stamp enforcement over loopback TCP is timing-sensitive in CI"]
async fn dual_tcp_require_stamps_blocks_then_retry() {
    let port = ephemeral_loopback_port();
    let server = spawn_tcp_stack(true, port).await;
    let client = spawn_tcp_stack(false, port).await;

    let server_id = server.handle.identity_status().await;
    wait_peer_lxmf_path(&client.handle, &server_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path before control send");

    // Positive control: path + LXMF delivery work before stamp enforcement.
    let control_body = format!("interop-stamp-control-{}", uuid::Uuid::new_v4());
    let control_req = LxmfSendRequest {
        destination_hash: server_id.lxmf_hash.clone(),
        text: control_body.clone(),
        reply_to_hash: None,
        reply_to_id: None,
        reply_preview_text: None,
        audio: None,
        attachments: vec![],
        image: None,
    };
    let control = client
        .handle
        .lxmf_send(control_req)
        .await
        .expect("control send");
    assert_eq!(control.get("ok"), Some(&serde_json::Value::Bool(true)));
    wait_inbound_text(&server.handle, &control_body, INBOUND_TIMEOUT)
        .await
        .expect("control dm delivered before stamp enforcement");

    server
        .handle
        .patch_stack_settings(&StackSettingsPatch {
            enforce_stamps: Some(true),
            ..StackSettingsPatch::default()
        })
        .await
        .expect("enforce on server");
    server.handle.soft_restart().await.expect("server restart");
    wait_stack_ready(&server.handle, READY_TIMEOUT)
        .await
        .expect("server ready after enforce restart");
    wait_peer_lxmf_path(&client.handle, &server_id.lxmf_hash, PEER_TIMEOUT)
        .await
        .expect("client path after enforce restart");

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

    let blocked = client.handle.lxmf_send(req.clone()).await;
    let (blocked_ok, blocked_err) = match &blocked {
        Ok(v) => (
            v.get("ok").and_then(serde_json::Value::as_bool),
            None::<String>,
        ),
        Err(e) => {
            // IPC / send-path rejection is an acceptable stamp-enforcement signal.
            let msg = e.clone();
            assert!(
                msg.to_lowercase().contains("stamp") || msg.to_lowercase().contains("enforc"),
                "unexpected lxmf_send error under stamp enforcement: {msg}"
            );
            (None, Some(msg))
        }
    };
    // Assert send outcome is inspected (not only logged). Remote drop may still
    // report ok=true; the hard gate is no delivery — positive control above proved
    // the path was healthy before enforcement.
    assert!(
        blocked.is_err() || blocked_ok.is_some(),
        "lxmf_send must return err or a JSON ok field under stamp enforcement; got {blocked:?}"
    );
    let delivery_seen = wait_inbound_text(&server.handle, &body, Duration::from_secs(8)).await;
    assert!(
        delivery_seen.is_err(),
        "unstamped message must not deliver under stamp enforcement (send ok={blocked_ok:?}, err={blocked_err:?})"
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

    let retry_body = format!("interop-stamp-retry-{}", uuid::Uuid::new_v4());
    let retry_req = LxmfSendRequest {
        text: retry_body.clone(),
        ..req
    };
    let retry = client
        .handle
        .lxmf_send(retry_req)
        .await
        .expect("stamped resend");
    assert_eq!(retry.get("ok"), Some(&serde_json::Value::Bool(true)));
    wait_inbound_text(&server.handle, &retry_body, INBOUND_TIMEOUT)
        .await
        .expect("stamped retry dm delivered");

    teardown_dual(&server, &client).await;
}
