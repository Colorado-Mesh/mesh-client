export interface TAKSettings {
  enabled: boolean;
  port: number;
  serverName: string;
  requireClientCert: boolean;
  autoStart: boolean;
}

export interface TAKServerStatus {
  running: boolean;
  port: number;
  clientCount: number;
  error?: string;
}

export interface TAKClientInfo {
  id: string;
  address: string;
  callsign?: string;
  connectedAt: number;
}
