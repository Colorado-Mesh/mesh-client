/**
 * Optional curated RRC hub catalog (empty: Favourites tab is user-starred only).
 * Keep in sync with reticulum-sidecar `stack/rrc_defaults.rs`.
 */
export interface RrcDefaultHub {
  /** Stable id for UI keys (not a Reticulum hash). */
  id: string;
  /** Human label. */
  label: string;
  /** 32-char lowercase hex destination hash for `rrc.hub`. */
  destinationHash: string;
}

/** No predefined hubs — users favourite from Discovered or manual connect. */
export const RRC_DEFAULT_HUBS: readonly RrcDefaultHub[] = [];

export const RRC_HUB_ASPECT = 'rrc.hub';
