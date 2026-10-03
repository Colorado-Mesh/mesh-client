import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Popup, Tooltip } from 'react-leaflet';

import { formatCoordPair } from '@/renderer/lib/coordUtils';
import { useCoordFormatStore } from '@/renderer/stores/coordFormatStore';
import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContact } from '@/shared/tak-types';

export type TakAffiliation = 'friend' | 'hostile' | 'neutral' | 'unknown' | 'point';

/** MIL-STD-2525 affiliation colors as ATAK draws them; map points use a distinct violet. */
const TAK_AFFILIATION_COLORS: Record<TakAffiliation, string> = {
  friend: '#38bdf8',
  hostile: '#ef4444',
  neutral: '#22c55e',
  unknown: '#facc15',
  point: '#a78bfa',
};

const TAK_AFFILIATION_LABEL_KEYS: Record<TakAffiliation, string> = {
  friend: 'takContacts.affiliationFriend',
  hostile: 'takContacts.affiliationHostile',
  neutral: 'takContacts.affiliationNeutral',
  unknown: 'takContacts.affiliationUnknown',
  point: 'takContacts.affiliationPoint',
};

/** CoT atoms are `a-<affiliation>-…`; assumed friend, suspect, joker and faker fold into two. */
export function takAffiliation(type: string): TakAffiliation {
  if (!type.startsWith('a-')) return 'point';
  switch (type.charAt(2)) {
    case 'f':
    case 'a':
      return 'friend';
    case 'h':
    case 's':
    case 'j':
    case 'k':
      return 'hostile';
    case 'n':
      return 'neutral';
    default:
      return 'unknown';
  }
}

/** Units and dropped map points received from ATAK clients and the remote TAK server. */
export function TakContactsLayer() {
  const { t } = useTranslation();
  const contacts = useTakContactStore((s) => s.contacts);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const list = useMemo(() => Array.from(contacts.values()), [contacts]);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((contact: TAKContact) => {
        const affiliation = takAffiliation(contact.type);
        const color = TAK_AFFILIATION_COLORS[affiliation];
        return (
          <CircleMarker
            key={`tak-${contact.uid}`}
            center={[contact.lat, contact.lon]}
            radius={affiliation === 'point' ? 6 : 8}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.55,
              weight: 2,
              ...(affiliation === 'point' ? { dashArray: '3 3' } : {}),
            }}
          >
            <Tooltip direction="top">{contact.callsign}</Tooltip>
            <Popup>
              <div className="space-y-1 p-2">
                <div className="text-ink-100 text-sm font-medium">{contact.callsign}</div>
                <div className="text-ink-400 text-xs">
                  {t(TAK_AFFILIATION_LABEL_KEYS[affiliation])} · {contact.type}
                </div>
                <div className="text-ink-400 text-xs">
                  {t(
                    contact.source === 'remote'
                      ? 'takContacts.sourceRemote'
                      : 'takContacts.sourceLocal',
                  )}
                  {contact.group ? ` · ${contact.group}` : ''}
                  {contact.role ? ` · ${contact.role}` : ''}
                </div>
                <div className="text-muted font-mono text-xs">
                  {formatCoordPair(contact.lat, contact.lon, coordinateFormat)}
                </div>
                <div className="text-muted text-xs">
                  {t('takContacts.lastSeen', {
                    time: new Date(contact.receivedAt).toLocaleTimeString(),
                  })}
                </div>
                {contact.remarks ? (
                  <div className="text-ink-300 text-xs whitespace-pre-wrap">{contact.remarks}</div>
                ) : null}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
