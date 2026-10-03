import type { SettingsSearchSurface } from '../settingsSearch';
import { adminSurface } from './admin';
import { modulesSurface } from './modules';
import { nodesSurface } from './nodes';
import { telemetrySurface } from './telemetry';

export const batch3Surfaces: readonly SettingsSearchSurface[] = [
  modulesSurface,
  adminSurface,
  telemetrySurface,
  nodesSurface,
];
