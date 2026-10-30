import type { RegionalFeedProvider } from './beacon';

/** Protocols with a live traffic view. Reticulum keeps its own map and has no pop-out. */
export const LIVE_MAP_PROTOCOLS = ['meshtastic', 'meshcore'] as const;
export type LiveMapProtocol = (typeof LIVE_MAP_PROTOCOLS)[number];

export function isLiveMapProtocol(value: unknown): value is LiveMapProtocol {
  return value === 'meshtastic' || value === 'meshcore';
}

export type LiveMapTrafficSource = 'local' | RegionalFeedProvider;

/** Map position, style and source handed between the main window and the pop-out window. */
export interface LiveMapView {
  center: [number, number];
  zoom: number;
  basemapId: string;
  trafficSource: LiveMapTrafficSource;
  /** A regional session the user connected; the receiving window reconnects to it once. */
  feed: { baseUrl: string; region?: string } | null;
}

/** Sent to the main window whenever a pop-out opens, becomes ready, or closes. */
export interface LiveMapWindowState {
  protocol: LiveMapProtocol;
  open: boolean;
  /** The pop-out page is listening; the main window should publish a full snapshot. */
  ready: boolean;
  /** Last view reported by a closed pop-out, so the docked map continues from it. */
  view: LiveMapView | null;
}

/** What a pop-out window learns about itself when its page starts. */
export interface LiveMapWindowInit {
  protocol: LiveMapProtocol;
  view: LiveMapView | null;
  alwaysOnTop: boolean;
}

export interface LiveMapNodeSelection {
  protocol: LiveMapProtocol;
  nodeId: number;
}

export interface LiveMapWindowApi {
  /** False in the browser development stub, where no second window can be opened. */
  available: boolean;
  // Main window
  open: (protocol: LiveMapProtocol, view: LiveMapView | null) => Promise<void>;
  close: (protocol: LiveMapProtocol) => Promise<void>;
  getOpen: () => Promise<LiveMapProtocol[]>;
  /** Packet and node data is produced by the main window and only relayed by main. */
  publish: (protocol: LiveMapProtocol, snapshot: unknown) => void;
  onState: (callback: (state: LiveMapWindowState) => void) => () => void;
  onNodeSelected: (callback: (selection: LiveMapNodeSelection) => void) => () => void;
  // Pop-out window
  init: () => Promise<LiveMapWindowInit | null>;
  onSnapshot: (callback: (snapshot: unknown) => void) => () => void;
  reportView: (view: LiveMapView) => void;
  selectNode: (nodeId: number) => void;
  setAlwaysOnTop: (value: boolean) => Promise<boolean>;
  dock: () => Promise<void>;
}

const BASEMAP_ID = /^[a-z0-9-]{1,32}$/;
const MAX_FEED_URL_LENGTH = 2_048;
const MAX_REGION_LENGTH = 128;
const MAX_ZOOM = 22;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseFeed(value: unknown): LiveMapView['feed'] | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return undefined;
  const { baseUrl, region } = value as Record<string, unknown>;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl.length > MAX_FEED_URL_LENGTH)
    return undefined;
  if (region === undefined) return { baseUrl };
  if (typeof region !== 'string' || region.length > MAX_REGION_LENGTH) return undefined;
  return region ? { baseUrl, region } : { baseUrl };
}

/**
 * Validate a view crossing between windows. The feed URL is still checked by the regional
 * feed client before any connection, so this only bounds shape and size.
 */
export function parseLiveMapView(value: unknown): LiveMapView | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const center = raw.center;
  if (
    !Array.isArray(center) ||
    center.length !== 2 ||
    !finite(center[0]) ||
    !finite(center[1]) ||
    Math.abs(center[0]) > 90 ||
    Math.abs(center[1]) > 540
  )
    return null;
  if (!finite(raw.zoom) || raw.zoom < 0 || raw.zoom > MAX_ZOOM) return null;
  if (typeof raw.basemapId !== 'string' || !BASEMAP_ID.test(raw.basemapId)) return null;
  const trafficSource = raw.trafficSource;
  if (trafficSource !== 'local' && trafficSource !== 'beacon' && trafficSource !== 'corescope')
    return null;
  const feed = parseFeed(raw.feed);
  if (feed === undefined) return null;
  return {
    center: [center[0], center[1]],
    zoom: raw.zoom,
    basemapId: raw.basemapId,
    trafficSource,
    feed: trafficSource === 'local' ? null : feed,
  };
}
