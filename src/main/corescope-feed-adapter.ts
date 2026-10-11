import type { BeaconConnectRequest, BeaconFeedUpdate, BeaconJsonObject } from '../shared/beacon';
import {
  boundedRegionalRecord,
  isRegionalObject,
  regionalDirectoryItems,
} from './regional-feed-data';

const PAGE_SIZE = 500;
const MAX_NODES = 5_000;
const MAX_OBSERVERS = 1_000;

type Snapshot = Extract<BeaconFeedUpdate, { type: 'snapshot' }>;
type ReadResource = (path: string) => Promise<unknown>;

/** CoreScope uses offsets and a separate observer directory, rather than Beacon's cursor API. */
export async function readCoreScopeSnapshot(
  request: BeaconConnectRequest,
  read: ReadResource,
): Promise<Snapshot> {
  const readNodes = async (): Promise<{ nodes: BeaconJsonObject[]; limited: boolean }> => {
    const nodes: BeaconJsonObject[] = [];
    for (let offset = 0; offset < MAX_NODES; offset += PAGE_SIZE) {
      const value = await read(`/api/nodes?limit=${PAGE_SIZE}&offset=${offset}`);
      const page = regionalDirectoryItems(value, PAGE_SIZE, 'nodes');
      nodes.push(...page);
      const hasMore = isRegionalObject(value) ? value.has_more : undefined;
      // CoreScope filters after paging, so an empty page can still have later visible nodes.
      if (hasMore === false || (hasMore !== true && !page.length)) {
        return { nodes, limited: false };
      }
    }
    return { nodes, limited: true };
  };
  const [nodePage, observerValue, regionValue] = await Promise.all([
    readNodes(),
    read('/api/observers'),
    read('/api/config/regions'),
  ]);
  if (!isRegionalObject(regionValue))
    throw new Error('CoreScope returned an invalid region directory.');
  const regions = Object.entries(regionValue)
    .slice(0, 100)
    .flatMap(([slug, name]) =>
      /^[a-z\d_-]{1,100}$/i.test(slug) &&
      typeof name === 'string' &&
      name.length > 0 &&
      name.length <= 160
        ? [{ slug, name }]
        : [],
    );
  if (request.region && !regions.some((region) => region.slug === request.region)) {
    throw new Error('The selected region is unavailable on this CoreScope map.');
  }
  const observers = regionalDirectoryItems(observerValue, MAX_OBSERVERS, 'observers');
  const observerRows = isRegionalObject(observerValue) ? observerValue.observers : null;
  return {
    type: 'snapshot',
    provider: 'corescope',
    nodes: nodePage.nodes,
    observers,
    regions,
    // Public plaintext arrives inside packet observations; avoid per-channel history requests.
    messages: [],
    ...(nodePage.limited || (Array.isArray(observerRows) && observerRows.length > MAX_OBSERVERS)
      ? { directoryLimited: true }
      : {}),
  };
}

/** Only explicit observer membership may filter CoreScope's otherwise global WS broadcast. */
export function coreScopeObserverRegions(
  observers: readonly BeaconJsonObject[],
): ReadonlyMap<string, string> {
  const regions = new Map<string, string>();
  for (const observer of observers) {
    if (typeof observer.id !== 'string' || typeof observer.iata !== 'string') continue;
    const id = observer.id.toLowerCase();
    const previous = regions.get(id);
    // Conflicting public directory rows must not make a receiver look geographically certain.
    regions.set(id, previous !== undefined && previous !== observer.iata ? '' : observer.iata);
  }
  return regions;
}

export function coreScopePacket(
  message: Record<string, unknown>,
  region: string | undefined,
  observerRegions: ReadonlyMap<string, string>,
): BeaconJsonObject | null {
  if (message.type !== 'packet') return null;
  const packet = boundedRegionalRecord(message.data);
  if (!packet) return null;
  if (!region) return packet;
  const iata = typeof packet.observer_iata === 'string' ? packet.observer_iata : null;
  const observer = typeof packet.observer_id === 'string' ? packet.observer_id.toLowerCase() : null;
  const observedRegion = iata || (observer ? observerRegions.get(observer) : undefined);
  return observedRegion === region ? packet : null;
}
