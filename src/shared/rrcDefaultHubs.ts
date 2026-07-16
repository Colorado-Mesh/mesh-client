/**
 * Curated RRC hub destination hashes shown in the Recommended section.
 * Keep in sync with reticulum-sidecar `stack/rrc_defaults.rs`.
 */
export interface RrcDefaultHub {
  /** Stable id for UI keys (not a Reticulum hash). */
  id: string;
  /** Human label for Recommended section. */
  label: string;
  /** 32-char lowercase hex destination hash for `rrc.hub`. */
  destinationHash: string;
}

export const RRC_DEFAULT_HUBS: readonly RrcDefaultHub[] = [
  {
    id: 'rns-community',
    label: 'RNS Community',
    destinationHash: '28c7c1a68c735693aa8e6b8193ed44b2',
  },
  {
    id: 'rns-moscow',
    label: 'RNS Moscow',
    destinationHash: '42a97b1b07147b898f78a610dfbba587',
  },
] as const;

export const RRC_HUB_ASPECT = 'rrc.hub';
