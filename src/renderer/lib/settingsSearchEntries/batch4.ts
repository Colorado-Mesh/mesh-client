import type { SettingsSearchSurface } from '../settingsSearch';
import { nomadNetworkSurface } from './nomadNetwork';
import { remoteSurface } from './remote';
import { reticulumAdminSurface } from './reticulumAdmin';
import { reticulumConnectionSurface } from './reticulumConnection';
import { reticulumRadioSurface } from './reticulumRadio';
import { roomsSurface } from './rooms';
import { rrcSurface } from './rrc';

export const batch4Surfaces: readonly SettingsSearchSurface[] = [
  reticulumConnectionSurface,
  reticulumRadioSurface,
  reticulumAdminSurface,
  remoteSurface,
  nomadNetworkSurface,
  rrcSurface,
  roomsSurface,
];
