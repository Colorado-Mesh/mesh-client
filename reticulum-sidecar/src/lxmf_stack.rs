//! LXMF stack wrapper. Full rsLXMF wiring behind `rns-stack` Cargo feature.

#[derive(Clone, Default)]
pub struct LxmfStack {
    #[cfg(feature = "rns-stack")]
    ready: bool,
}

impl LxmfStack {
    pub fn init(_storage_dir: Option<&str>) -> Self {
        #[cfg(feature = "rns-stack")]
        {
            tracing::info!("rns-stack feature enabled; LxmfManager init pending pin");
            return Self { ready: false };
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = _storage_dir;
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
            Some("lxmf-core (stub)".into())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = self;
            None
        }
    }
}
