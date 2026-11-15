import { createRequire } from 'node:module';
import path from 'node:path';

import type { validateMqttPublishWaypointArgs as ValidateFn } from './mqttPublishWaypointValidation';

const requireFromHere = createRequire(__filename);

type ValidateMqttPublishWaypointArgs = typeof ValidateFn;

let cached: ValidateMqttPublishWaypointArgs | undefined;

/**
 * Production loads sibling `mqtt-publish-waypoint-validation.js` (out of measured index.js).
 * Vitest loads the TypeScript source; `process.env.VITEST` is defined away in prod esbuild.
 */
export function loadValidateMqttPublishWaypointArgs(): ValidateMqttPublishWaypointArgs {
  if (cached) return cached;
  const mod = (
    process.env.VITEST
      ? requireFromHere('./mqttPublishWaypointValidation')
      : requireFromHere(path.join(__dirname, 'mqtt-publish-waypoint-validation.js'))
  ) as { validateMqttPublishWaypointArgs: ValidateMqttPublishWaypointArgs };
  cached = mod.validateMqttPublishWaypointArgs;
  return cached;
}

/** @internal */
export function resetValidateMqttPublishWaypointArgsCacheForTests(): void {
  cached = undefined;
}
