import L from 'leaflet';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Marker, Popup, Tooltip } from 'react-leaflet';

import { formatCoordPair } from '@/renderer/lib/coordUtils';
import {
  parseTakSymbol,
  TAK_AFFILIATION_COLORS,
  type TakAffiliation,
  type TakSymbol,
  takSymbolKey,
  takSymbolSvg,
} from '@/renderer/lib/tak/takSymbol';
import { useCoordFormatStore } from '@/renderer/stores/coordFormatStore';
import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContact } from '@/shared/tak-types';

const TAK_AFFILIATION_LABEL_KEYS: Record<TakAffiliation, string> = {
  friend: 'takContacts.affiliationFriend',
  hostile: 'takContacts.affiliationHostile',
  neutral: 'takContacts.affiliationNeutral',
  unknown: 'takContacts.affiliationUnknown',
  point: 'takContacts.affiliationPoint',
};

/** Symbols come from a small fixed set, so icons are shared instead of rebuilt per contact. */
const iconCache = new Map<string, L.DivIcon>();

function symbolIcon(symbol: TakSymbol): L.DivIcon {
  const key = takSymbolKey(symbol);
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      html: takSymbolSvg(symbol),
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      tooltipAnchor: [0, -14],
      popupAnchor: [0, -14],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function TakContactPopup({ contact, symbol }: { contact: TAKContact; symbol: TakSymbol }) {
  const { t } = useTranslation();
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  return (
    <>
      <Tooltip direction="top">{contact.callsign}</Tooltip>
      <Popup>
        <div className="space-y-1 p-2">
          <div className="text-ink-100 text-sm font-medium">{contact.callsign}</div>
          <div className="text-ink-400 text-xs">
            {t(TAK_AFFILIATION_LABEL_KEYS[symbol.affiliation])} · {contact.type}
          </div>
          <div className="text-ink-400 text-xs">
            {t(
              contact.source === 'remote' ? 'takContacts.sourceRemote' : 'takContacts.sourceLocal',
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
    </>
  );
}

/** Units and dropped map points received from ATAK clients and the remote TAK server. */
export function TakContactsLayer() {
  const contacts = useTakContactStore((s) => s.contacts);
  const list = useMemo(() => Array.from(contacts.values()), [contacts]);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((contact: TAKContact) => {
        const symbol = parseTakSymbol(contact.type);
        if (symbol.affiliation === 'point') {
          const color = TAK_AFFILIATION_COLORS.point;
          return (
            <CircleMarker
              key={`tak-${contact.uid}`}
              center={[contact.lat, contact.lon]}
              radius={6}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.55,
                weight: 2,
                dashArray: '3 3',
              }}
            >
              <TakContactPopup contact={contact} symbol={symbol} />
            </CircleMarker>
          );
        }
        return (
          <Marker
            // react-leaflet only applies title/alt at creation, so a rename remounts the marker.
            key={`tak-${contact.uid}:${contact.callsign}`}
            position={[contact.lat, contact.lon]}
            icon={symbolIcon(symbol)}
            title={contact.callsign}
            alt={contact.callsign}
          >
            <TakContactPopup contact={contact} symbol={symbol} />
          </Marker>
        );
      })}
    </>
  );
}
