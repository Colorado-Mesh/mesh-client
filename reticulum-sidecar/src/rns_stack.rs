//! RNS stack wrapper. Full rsReticulum wiring behind `rns-stack` Cargo feature.

#[derive(Clone, Default)]
pub struct RnsStack {
    #[cfg(feature = "rns-stack")]
    ready: bool,
}

impl RnsStack {
    pub fn init(_config_dir: Option<&str>) -> Self {
        #[cfg(feature = "rns-stack")]
        {
            // Phase B follow-up: initialize rns-runtime RnsManager (Ratspeak patterns).
            tracing::info!("rns-stack feature enabled; RnsManager init pending pin");
            return Self { ready: false };
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = _config_dir;
            Self::default()
        }
    }

    pub fn is_ready(&self) -> bool {
        #[cfg(feature = "rns-stack")]
        {
            self.ready
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            false
        }
    }

    pub fn version(&self) -> Option<String> {
        #[cfg(feature = "rns-stack")]
        {
            Some("rns-runtime (stub)".into())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = self;
            None
        }
    }
}
