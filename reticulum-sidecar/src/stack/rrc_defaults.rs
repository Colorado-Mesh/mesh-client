//! Optional curated RRC hub catalog (keep in sync with `src/shared/rrcDefaultHubs.ts`).
//! Empty: Favourites are user-starred only; discovery uses `RRC_HUB_ASPECT`.

pub const RRC_HUB_ASPECT: &str = "rrc.hub";

/// Destination hashes of curated hubs (empty until hubs are added).
pub const RRC_DEFAULT_HUBS: &[&str] = &[];
