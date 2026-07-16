//! Optional curated RRC hub catalog (keep in sync with `src/shared/rrcDefaultHubs.ts`).
//! Empty: Favourites are user-starred only; discovery uses `RRC_HUB_ASPECT`.

pub const RRC_HUB_ASPECT: &str = "rrc.hub";

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // catalog fields kept for TS parity when hubs are added
pub struct RrcDefaultHub {
    pub id: &'static str,
    pub label: &'static str,
    pub destination_hash: &'static str,
}

/// No predefined hubs — users favourite from discovery or manual connect.
pub const RRC_DEFAULT_HUBS: &[RrcDefaultHub] = &[];
