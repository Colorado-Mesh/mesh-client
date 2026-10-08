import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { playMecpEasAttention, playMecpSiren } from '../lib/chatNotifications';
import { selectUnseenCriticalIncidents, useIncidentStore } from '../stores/incidentStore';

/**
 * Attention for live MAYDAY/URGENT incidents nobody has looked at (mount once from App).
 * A newly unseen incident flashes the taskbar / bounces the dock; when `repeatMinutes` is set the
 * alert tone replays at that interval until every incident is seen. The first tone is owned by
 * `triggerMecpAlert`, so the repeat only starts one interval later.
 */
export function useUnseenEmergencyAlerts(repeatMinutes: number | null): void {
  const unseen = useIncidentStore(useShallow(selectUnseenCriticalIncidents));
  const idsKey = unseen.map((inc) => inc.id).join('|');
  const hasUnseen = unseen.length > 0;
  const mostSevere = unseen[0]?.severity ?? null;

  const knownIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = new Set(idsKey === '' ? [] : idsKey.split('|'));
    const hasNew = [...ids].some((id) => !knownIdsRef.current.has(id));
    knownIdsRef.current = ids;
    if (!hasNew) return;
    window.electronAPI.app.requestAttention().catch((e: unknown) => {
      console.warn('[useUnseenEmergencyAlerts] requestAttention failed', e);
    });
  }, [idsKey]);

  const mostSevereRef = useRef(mostSevere);
  useEffect(() => {
    mostSevereRef.current = mostSevere;
  }, [mostSevere]);
  useEffect(() => {
    if (!hasUnseen || repeatMinutes == null) return;
    const timer = setInterval(() => {
      if (mostSevereRef.current === 0) playMecpSiren();
      else playMecpEasAttention();
    }, repeatMinutes * MS_PER_MINUTE);
    return () => {
      clearInterval(timer);
    };
  }, [hasUnseen, repeatMinutes]);
}
