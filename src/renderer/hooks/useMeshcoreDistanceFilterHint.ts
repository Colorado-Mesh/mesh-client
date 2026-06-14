import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidLatLon } from '../../shared/geoCoords';
import { useToast } from '../components/Toast';
import type { MeshNode, MeshProtocol } from '../lib/types';

const HINT_STORAGE_KEY = 'mesh-client:meshcoreDistanceFilterHintShown';
const GPS_CONTACT_THRESHOLD = 200;

/** One-time toast when many GPS contacts are on the map but distance filter is off. */
export function useMeshcoreDistanceFilterHint(
  protocol: MeshProtocol,
  nodes: Map<number, MeshNode>,
  myNodeNum: number,
  locationFilterEnabled: boolean,
): void {
  const { addToast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (protocol !== 'meshcore') return;
    if (locationFilterEnabled) return;
    try {
      if (localStorage.getItem(HINT_STORAGE_KEY)) return;
    } catch {
      // catch-no-log-ok localStorage unavailable
      return;
    }

    const home = myNodeNum > 0 ? nodes.get(myNodeNum) : undefined;
    if (!home || !isValidLatLon(home.latitude, home.longitude)) return;

    let gpsCount = 0;
    for (const node of nodes.values()) {
      if (isValidLatLon(node.latitude, node.longitude)) gpsCount++;
    }
    if (gpsCount < GPS_CONTACT_THRESHOLD) return;

    try {
      localStorage.setItem(HINT_STORAGE_KEY, '1');
    } catch {
      // catch-no-log-ok localStorage unavailable
    }
    addToast(t('toasts.meshcoreDistanceFilterHint', { count: gpsCount }), 'info', 10_000);
  }, [protocol, nodes, myNodeNum, locationFilterEnabled, addToast, t]);
}
