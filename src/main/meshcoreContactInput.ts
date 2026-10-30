import {
  sanitizeMeshcoreAdvLatLonForDb,
  sanitizeMeshcoreLastAdvertForDb,
} from '../shared/meshcoreContactSanitize';
import type { MeshcoreContactUpsertParams } from './database';

/** Normalize validated IPC writes; live radio rows inherit their local receive time. */
export function meshcoreContactInputToUpsertParams(
  c: Record<string, unknown>,
): MeshcoreContactUpsertParams {
  const coords = sanitizeMeshcoreAdvLatLonForDb(
    c.adv_lat != null ? Number(c.adv_lat) : null,
    c.adv_lon != null ? Number(c.adv_lon) : null,
  );
  const onRadio = c.on_radio != null ? Number(c.on_radio) : null;
  return {
    node_id: Number(c.node_id),
    public_key: c.public_key as string,
    adv_name: typeof c.adv_name === 'string' ? c.adv_name : null,
    contact_type: c.contact_type != null ? Number(c.contact_type) : 0,
    last_advert: sanitizeMeshcoreLastAdvertForDb(
      c.last_advert != null ? Number(c.last_advert) : null,
    ),
    adv_lat: coords.adv_lat,
    adv_lon: coords.adv_lon,
    last_snr: c.last_snr != null ? Number(c.last_snr) : null,
    last_rssi: c.last_rssi != null ? Number(c.last_rssi) : null,
    nickname: typeof c.nickname === 'string' ? c.nickname : null,
    contact_flags: c.contact_flags != null ? Number(c.contact_flags) : 0,
    hops_away: c.hops_away != null ? Number(c.hops_away) : null,
    on_radio: onRadio,
    last_synced_from_radio:
      typeof c.last_synced_from_radio === 'string'
        ? c.last_synced_from_radio
        : onRadio === 1
          ? new Date().toISOString()
          : null,
  };
}
