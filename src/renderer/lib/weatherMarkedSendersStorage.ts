import { errLikeToLogString } from './errLikeToLogString';
import { parseStoredJson } from './parseStoredJson';
import type { MeshProtocol } from './types';

const WEATHER_MARKED_SENDERS_MAX = 500;

/** Load sender node ids the user marked as weather posters for this protocol. */
export function loadWeatherMarkedSenders(protocol: MeshProtocol): Set<number> {
  try {
    const raw = localStorage.getItem(`mesh-client:weatherMarkedSenders:${protocol}`);
    if (!raw) return new Set();
    const parsed = parseStoredJson<unknown>(raw, 'ChatPanel weatherMarkedSenders');
    if (Array.isArray(parsed)) {
      return new Set(
        parsed.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0),
      );
    }
  } catch (e) {
    console.debug(
      '[weatherMarkedSendersStorage] loadWeatherMarkedSenders failed ' + errLikeToLogString(e),
    );
  }
  return new Set();
}

/** Persist weather-marked sender ids for this protocol (newest kept when over the cap). */
export function saveWeatherMarkedSenders(
  protocol: MeshProtocol,
  senders: ReadonlySet<number>,
): void {
  try {
    localStorage.setItem(
      `mesh-client:weatherMarkedSenders:${protocol}`,
      JSON.stringify([...senders].slice(-WEATHER_MARKED_SENDERS_MAX)),
    );
  } catch (e) {
    console.debug(
      '[weatherMarkedSendersStorage] saveWeatherMarkedSenders failed ' + errLikeToLogString(e),
    );
  }
}
