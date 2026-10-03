import type { SettingsSearchSurface } from '../settingsSearch';
import { connectionSurface } from './connection';
import { securitySurface } from './security';
import { takSurface } from './tak';

export const batch2Surfaces: readonly SettingsSearchSurface[] = [
  connectionSurface,
  securitySurface,
  takSurface,
];
