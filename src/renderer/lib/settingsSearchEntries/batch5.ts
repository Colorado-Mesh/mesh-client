import type { SettingsSearchSurface } from '../settingsSearch';
import { diagnosticsSurface } from './diagnostics';
import { statsSurface } from './stats';

export const batch5Surfaces: readonly SettingsSearchSurface[] = [diagnosticsSurface, statsSurface];
