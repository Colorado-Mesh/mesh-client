use tokio::sync::broadcast;

use crate::lxmf_stack::LxmfStack;
use crate::rns_stack::RnsStack;

#[derive(Clone)]
pub struct AppState {
    pub version: String,
    pub event_tx: broadcast::Sender<String>,
    pub rns: RnsStack,
    pub lxmf: LxmfStack,
}

impl AppState {
    pub fn new(version: String, event_tx: broadcast::Sender<String>, rns: RnsStack, lxmf: LxmfStack) -> Self {
        Self {
            version,
            event_tx,
            rns,
            lxmf,
        }
    }

    pub fn rns_ready(&self) -> bool {
        self.rns.is_ready()
    }

    pub fn lxmf_ready(&self) -> bool {
        self.lxmf.is_ready()
    }

    pub fn rns_version(&self) -> Option<String> {
        self.rns.version()
    }

    pub fn lxmf_version(&self) -> Option<String> {
        self.lxmf.version()
    }
}
