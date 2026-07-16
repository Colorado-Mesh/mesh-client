//! Curated RRC hub destination hashes (keep in sync with `src/shared/rrcDefaultHubs.ts`).

pub const RRC_HUB_ASPECT: &str = "rrc.hub";

#[derive(Debug, Clone, Copy)]
pub struct RrcDefaultHub {
    pub id: &'static str,
    pub label: &'static str,
    pub destination_hash: &'static str,
}

pub const RRC_DEFAULT_HUBS: &[RrcDefaultHub] = &[
    RrcDefaultHub {
        id: "rns-community",
        label: "RNS Community",
        destination_hash: "28c7c1a68c735693aa8e6b8193ed44b2",
    },
    RrcDefaultHub {
        id: "rns-moscow",
        label: "RNS Moscow",
        destination_hash: "42a97b1b07147b898f78a610dfbba587",
    },
];
