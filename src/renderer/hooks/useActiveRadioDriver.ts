import { useMemo } from 'react';

import { getDriver } from '../lib/radio/drivers/driverRegistry';
import type { RadioDriver } from '../lib/radio/drivers/RadioDriver';
import type { MeshProtocol } from '../lib/types';

export function useActiveRadioDriver(protocol: MeshProtocol): RadioDriver | null {
  return useMemo(() => getDriver(protocol), [protocol]);
}
