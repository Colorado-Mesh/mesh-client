//! Explicit rsReticulum instance ownership for the live stack.
//!
//! mesh-client never runs as a `SharedInstanceClient` of another Reticulum app:
//! transport-layer Ratspeak features (path-medium slots, RF rebroadcast
//! exclusion, RMAP egress, BLE RNode / BLE Peer, TX-queue stats) only exist when
//! this process owns transport. With Share on we bind the shared endpoints
//! (`SharedOwner`); if another app already holds them we run `Standalone` and
//! surface `shared_instance_conflict` instead of silently attaching.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use rns_runtime::lifecycle::ShutdownSignal;
use rns_runtime::reticulum::{
    self, InitOptions, InstanceMode, ReticulumConfig, ReticulumHandle, SharedInstanceType,
};
use rns_runtime::shared_instance::{InstancePolicy, InstanceStartupError, SharedInstanceError};

pub struct OwnedInstanceStartup {
    pub handle: ReticulumHandle,
    pub shutdown: ShutdownSignal,
    /// Shared endpoint held by another Reticulum app when Share was requested.
    pub shared_instance_conflict: Option<String>,
}

pub fn policy_for_share_instance(share_instance: bool) -> InstancePolicy {
    if share_instance {
        InstancePolicy::SharedOwner
    } else {
        InstancePolicy::Standalone
    }
}

/// True when `SharedOwner` failed only because the endpoint is already bound.
pub fn is_shared_endpoint_conflict(error: &InstanceStartupError) -> bool {
    matches!(
        error,
        InstanceStartupError::Shared(
            SharedInstanceError::PacketBindFailed | SharedInstanceError::ControlBindFailed
        )
    )
}

pub fn shared_endpoint_display(config: &ReticulumConfig) -> String {
    match config.shared_instance_type {
        SharedInstanceType::Tcp => format!("127.0.0.1:{}", config.shared_instance_port),
        SharedInstanceType::Unix => format!("rns/{}", config.instance_name),
    }
}

/// Values another app's `[reticulum]` section needs to attach to this instance.
/// `rpc_key` is included so Python RPC tools (rnstatus, rnpath) authenticate.
pub fn client_settings_json(instance_mode: &str, config: &ReticulumConfig) -> serde_json::Value {
    let shared_instance_type = match config.shared_instance_type {
        SharedInstanceType::Tcp => "tcp",
        SharedInstanceType::Unix => "unix",
    };
    serde_json::json!({
        "hosting": instance_mode == "shared",
        "shared_instance_type": shared_instance_type,
        "shared_instance_port": config.shared_instance_port,
        "instance_control_port": config.control_port,
        "instance_name": config.instance_name,
        "rpc_key": config.rpc_key.as_deref().map(hex::encode),
    })
}

pub fn instance_mode_label(mode: InstanceMode) -> &'static str {
    match mode {
        InstanceMode::Shared => "shared",
        InstanceMode::Client => "client",
        InstanceMode::Standalone => "standalone",
    }
}

async fn init_once(
    config_dir: &str,
    is_foreground: Arc<AtomicBool>,
    policy: InstancePolicy,
) -> Result<(ReticulumHandle, ShutdownSignal), (InstanceStartupError, ShutdownSignal)> {
    let shutdown = ShutdownSignal::new();
    match reticulum::init_with_policy(
        Some(config_dir),
        None,
        shutdown.clone(),
        is_foreground,
        InitOptions::default(),
        rns_runtime::prelude::RNodeStartupOptions::default(),
        policy,
    )
    .await
    {
        Ok(handle) => Ok((handle, shutdown)),
        Err(error) => Err((error, shutdown)),
    }
}

/// Start the runtime as shared-instance owner or standalone — never as a client.
pub async fn init_owned_or_standalone(
    config_dir: &str,
    share_instance: bool,
    is_foreground: Arc<AtomicBool>,
) -> Result<OwnedInstanceStartup, String> {
    match init_once(
        config_dir,
        is_foreground.clone(),
        policy_for_share_instance(share_instance),
    )
    .await
    {
        Ok((handle, shutdown)) => Ok(OwnedInstanceStartup {
            handle,
            shutdown,
            shared_instance_conflict: None,
        }),
        Err((error, failed_shutdown)) if share_instance && is_shared_endpoint_conflict(&error) => {
            failed_shutdown.trigger();
            tracing::warn!(
                "shared instance endpoint owned by another Reticulum app ({error}); starting standalone"
            );
            let (handle, shutdown) =
                init_once(config_dir, is_foreground, InstancePolicy::Standalone)
                    .await
                    .map_err(|(e, s)| {
                        s.trigger();
                        format!("RNS init failed: {e}")
                    })?;
            let endpoint = shared_endpoint_display(&handle.config);
            Ok(OwnedInstanceStartup {
                handle,
                shutdown,
                shared_instance_conflict: Some(endpoint),
            })
        }
        Err((error, failed_shutdown)) => {
            failed_shutdown.trigger();
            Err(format!("RNS init failed: {error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_on_requires_ownership_share_off_is_standalone() {
        assert!(matches!(
            policy_for_share_instance(true),
            InstancePolicy::SharedOwner
        ));
        assert!(matches!(
            policy_for_share_instance(false),
            InstancePolicy::Standalone
        ));
    }

    #[test]
    fn only_bind_failures_count_as_conflict() {
        assert!(is_shared_endpoint_conflict(&InstanceStartupError::Shared(
            SharedInstanceError::PacketBindFailed
        )));
        assert!(is_shared_endpoint_conflict(&InstanceStartupError::Shared(
            SharedInstanceError::ControlBindFailed
        )));
        assert!(!is_shared_endpoint_conflict(&InstanceStartupError::Shared(
            SharedInstanceError::Cancelled
        )));
        assert!(!is_shared_endpoint_conflict(&InstanceStartupError::Shared(
            SharedInstanceError::InvalidKey
        )));
    }

    fn write_tcp_shared_config(dir: &std::path::Path, share: bool, port: u16, control: u16) {
        std::fs::write(
            dir.join("config"),
            format!(
                "[reticulum]\nenable_transport = No\nshare_instance = {}\nshared_instance_type = tcp\nshared_instance_port = {port}\ninstance_control_port = {control}\n\n[logging]\nloglevel = 2\n\n[interfaces]\n",
                if share { "Yes" } else { "No" }
            ),
        )
        .unwrap();
    }

    async fn free_port() -> u16 {
        let l = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        l.local_addr().unwrap().port()
    }

    #[tokio::test]
    async fn share_on_with_foreign_owner_falls_back_to_standalone() {
        let dir =
            std::env::temp_dir().join(format!("mesh_instance_policy_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let foreign = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = foreign.local_addr().unwrap().port();
        let control = free_port().await;
        write_tcp_shared_config(&dir, true, port, control);

        let startup =
            init_owned_or_standalone(dir.to_str().unwrap(), true, Arc::new(AtomicBool::new(true)))
                .await
                .expect("standalone fallback");
        assert_eq!(startup.handle.instance_mode, InstanceMode::Standalone);
        assert_eq!(
            startup.shared_instance_conflict.as_deref(),
            Some(format!("127.0.0.1:{port}").as_str())
        );
        startup.shutdown.trigger();
        drop(foreign);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn share_on_with_free_endpoint_owns_shared_instance() {
        let dir =
            std::env::temp_dir().join(format!("mesh_instance_policy_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let port = free_port().await;
        let mut control = free_port().await;
        while control == port {
            control = free_port().await;
        }
        write_tcp_shared_config(&dir, true, port, control);

        let startup =
            init_owned_or_standalone(dir.to_str().unwrap(), true, Arc::new(AtomicBool::new(true)))
                .await
                .expect("shared owner");
        assert_eq!(startup.handle.instance_mode, InstanceMode::Shared);
        assert!(startup.shared_instance_conflict.is_none());
        let settings = client_settings_json(
            instance_mode_label(startup.handle.instance_mode),
            &startup.handle.config,
        );
        assert_eq!(settings["hosting"], true);
        assert_eq!(settings["shared_instance_type"], "tcp");
        assert_eq!(settings["shared_instance_port"], port);
        assert_eq!(settings["instance_control_port"], control);
        assert!(settings["rpc_key"].as_str().is_some_and(|k| !k.is_empty()));
        startup.shutdown.trigger();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn share_off_never_attaches_to_running_instance() {
        let dir =
            std::env::temp_dir().join(format!("mesh_instance_policy_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let foreign = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = foreign.local_addr().unwrap().port();
        let control = free_port().await;
        write_tcp_shared_config(&dir, false, port, control);

        let startup = init_owned_or_standalone(
            dir.to_str().unwrap(),
            false,
            Arc::new(AtomicBool::new(true)),
        )
        .await
        .expect("standalone");
        assert_eq!(startup.handle.instance_mode, InstanceMode::Standalone);
        assert!(startup.shared_instance_conflict.is_none());
        startup.shutdown.trigger();
        drop(foreign);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mode_labels_are_stable_wire_values() {
        assert_eq!(instance_mode_label(InstanceMode::Shared), "shared");
        assert_eq!(instance_mode_label(InstanceMode::Standalone), "standalone");
        assert_eq!(instance_mode_label(InstanceMode::Client), "client");
    }
}
