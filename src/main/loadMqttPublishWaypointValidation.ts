import { createRequire } from 'node:module';
import path from 'node:path';

import type { validateMqttPublishWaypointArgs as ValidateFn } from './mqttPublishWaypointValidation';
import { validateMqttPublishWaypointArgs as validateMqttPublishWaypointArgsImpl } from './mqttPublishWaypointValidation';

const requireFromHere = createRequire(__filename);

type ValidateMqttPublishWaypointArgs = typeof ValidateFn;

let cached: ValidateMqttPublishWaypointArgs | undefined;

/**
 * Production loads sibling `mqtt-publish-waypoint-validation.js` (out of measured index.js).
 * Vitest uses the TypeScript binding via a static import; `process.env.VITEST` is defined away
 * in prod esbuild so that import is tree-shaken out of measured `index.js` (no extensionless
 * or `.ts` require on Node 22.15–22.17).
 */
export function loadValidateMqttPublishWaypointArgs(): ValidateMqttPublishWaypointArgs {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = validateMqttPublishWaypointArgsImpl;
    return cached;
  }
  cached = (
    requireFromHere(path.join(__dirname, 'mqtt-publish-waypoint-validation.js')) as {
      validateMqttPublishWaypointArgs: ValidateMqttPublishWaypointArgs;
    }
  ).validateMqttPublishWaypointArgs;
  return cached;
}

/** @internal */
export function resetValidateMqttPublishWaypointArgsCacheForTests(): void {
  cached = undefined;
}
