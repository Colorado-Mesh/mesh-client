/** RNode platform identifiers (ROM layout). */
export type RNodePlatform = number;

export interface Esp32FlashConfig {
  flash_size: string;
  flash_files: Record<string, string>;
}

export interface RNodeModel {
  id: number;
  name: string;
  /** EEPROM model byte when it differs from catalog id (TCXO variants). */
  mapped_id?: number;
  firmware_filename?: string;
  flash_config?: Esp32FlashConfig;
}

export interface RNodeProduct {
  name: string;
  /** UI-unique key for React lists and select values (may differ from EEPROM product id). */
  catalogKey: string;
  id: number;
  platform: RNodePlatform;
  models: RNodeModel[];
  firmware_filename?: string;
  flash_config?: Esp32FlashConfig;
}

export interface RomDetails {
  is_provisioned: boolean;
  is_configured: boolean;
  product: number;
  model: number;
  hardware_revision: number;
  serial_number: number;
  made: number;
  checksum: string;
  calculated_checksum: string;
  signature: string;
  configured_spreading_factor?: number;
  configured_coding_rate?: number;
  configured_tx_power?: number;
  configured_frequency?: number;
  configured_bandwidth?: number;
}

export type FlashProgressCallback = (percentage: number) => void;
