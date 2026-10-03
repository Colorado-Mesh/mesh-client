/**
 * MeshCore contact capacity:
 * - 0x8F CONTACT_DELETED — one radio eviction; mark that contact off-radio and decrement count
 * - 0x90 CONTACTS_FULL — alarm / optional auto-offload
 * - App-side triggers (count near the radio limit, ERR_CODE_TABLE_FULL, overwrite eviction)
 *   share {@link requestMeshcoreAutoOffload} because firmware only sends 0x90 in auto-add mode
 *   with overwrite-oldest off.
 */
import { pushAppToast, type ToastAction } from '../../components/Toast';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import i18n from '../i18n';
import { isMeshcoreTableFullError } from '../meshcoreRadioErr';
import { MESHCORE_MAX_CONTACTS, meshcoreContactThresholds } from '../meshcoreUtils';
import { MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS } from '../timeConstants';
import type { IdentityId } from '../types';

export const MESHCORE_AUTO_OFFLOAD_WHEN_FULL_KEY = 'mesh-client:meshcoreAutoOffloadWhenFull';

export type MeshcoreAutoOffloadReason =
  'firmware_full' | 'count_threshold' | 'table_full_error' | 'overwrite_eviction';

/** Firmware reported contacts-full; capacity UI treats as critical until cleared. */
let firmwareContactsFullActive = false;
const firmwareFullListeners = new Set<() => void>();
const contactCountRefreshListeners = new Set<() => void>();
const radioMaxContactsListeners = new Set<() => void>();

let lastContactsFullAlarmAt = 0;
let contactsFullOffloadInFlight = false;
let radioMaxContacts: number | null = null;

/** Contact table size reported by the companion (device query v3+), or the default. */
export function getMeshcoreRadioMaxContacts(): number {
  return radioMaxContacts ?? MESHCORE_MAX_CONTACTS;
}

export function setMeshcoreRadioMaxContacts(max: number | null): void {
  const next = max !== null && Number.isInteger(max) && max > 0 ? max : null;
  if (radioMaxContacts === next) return;
  radioMaxContacts = next;
  for (const listener of radioMaxContactsListeners) listener();
}

export function subscribeMeshcoreRadioMaxContacts(listener: () => void): () => void {
  radioMaxContactsListeners.add(listener);
  return () => {
    radioMaxContactsListeners.delete(listener);
  };
}

export type MeshcoreContactsFullOffloadRunner = () => Promise<void>;

let contactsFullOffloadRunner: MeshcoreContactsFullOffloadRunner | null = null;

/** Capacity UI: subscribe to firmware contacts-full latch. */
export function subscribeMeshcoreFirmwareContactsFull(listener: () => void): () => void {
  firmwareFullListeners.add(listener);
  return () => {
    firmwareFullListeners.delete(listener);
  };
}

/** Capacity UI: refresh on_radio count after CONTACT_DELETED / offload. */
export function subscribeMeshcoreContactCountRefresh(listener: () => void): () => void {
  contactCountRefreshListeners.add(listener);
  return () => {
    contactCountRefreshListeners.delete(listener);
  };
}

export function notifyMeshcoreContactCountMaybeChanged(): void {
  for (const listener of contactCountRefreshListeners) listener();
}

export function isMeshcoreFirmwareContactsFullActive(): boolean {
  return firmwareContactsFullActive;
}

function setFirmwareContactsFullActive(active: boolean): void {
  if (firmwareContactsFullActive === active) return;
  firmwareContactsFullActive = active;
  for (const listener of firmwareFullListeners) listener();
}

export function clearMeshcoreFirmwareContactsFullLatch(): void {
  setFirmwareContactsFullActive(false);
}

export function readMeshcoreAutoOffloadWhenFull(): boolean {
  try {
    return localStorage.getItem(MESHCORE_AUTO_OFFLOAD_WHEN_FULL_KEY) === 'true';
  } catch {
    // catch-no-log-ok localStorage unavailable
    return false;
  }
}

export function writeMeshcoreAutoOffloadWhenFull(value: boolean): void {
  try {
    localStorage.setItem(MESHCORE_AUTO_OFFLOAD_WHEN_FULL_KEY, String(value));
  } catch {
    // catch-no-log-ok localStorage
  }
}

/** Runtime / panel registers the same Offload path used by Radio/Nodes buttons. */
export function registerMeshcoreContactsFullOffloadRunner(
  runner: MeshcoreContactsFullOffloadRunner | null,
): void {
  contactsFullOffloadRunner = runner;
}

function publicKeyToHex(publicKey: Uint8Array): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 0x8F: radio removed one contact. Update that row only; capacity count drops by at most 1.
 * Does not zero the counter or mark all contacts off-radio. No tombstone.
 */
export async function applyMeshcoreContactDeletedFromRadio(opts: {
  identityId: IdentityId;
  nodeId: number;
  publicKey: Uint8Array;
}): Promise<{ markedOffRadio: boolean }> {
  const { identityId, nodeId, publicKey } = opts;
  if (nodeId === 0 || publicKey.length !== 32) return { markedOffRadio: false };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Identity bucket may be absent at runtime.
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Node may be absent when its identity bucket is missing.
  if (existing) {
    upsertNodeRecord(identityId, { ...existing, nodeId, onRadio: false });
  }

  const publicKeyHex = publicKeyToHex(publicKey);
  try {
    const result = await window.electronAPI.db.markMeshcoreContactOffRadio(publicKeyHex);
    if (result.changes > 0) {
      // One slot freed — clear full latch if firmware had reported full.
      setFirmwareContactsFullActive(false);
      notifyMeshcoreContactCountMaybeChanged();
    }
    return { markedOffRadio: result.changes > 0 };
  } catch (e) {
    console.warn(
      '[meshcoreContactCapacityPush] markMeshcoreContactOffRadio failed ' + errLikeToLogString(e),
    );
    return { markedOffRadio: false };
  }
}

async function runContactsFullOffload(): Promise<void> {
  if (contactsFullOffloadInFlight) return;
  const runner = contactsFullOffloadRunner;
  if (!runner) {
    console.warn('[meshcoreContactCapacityPush] contacts-full offload requested but no runner');
    return;
  }
  contactsFullOffloadInFlight = true;
  try {
    await runner();
    setFirmwareContactsFullActive(false);
    lastContactsFullAlarmAt = 0;
  } finally {
    contactsFullOffloadInFlight = false;
  }
}

export function isMeshcoreAutoOffloadInFlight(): boolean {
  return contactsFullOffloadInFlight;
}

/**
 * Single entry for every "radio is (nearly) full" signal. With auto-offload on, runs the
 * registered offload runner; otherwise shows the sticky alarm with an Offload CTA.
 * In-flight guard + debounce prevent loops when the post-offload contact refresh re-checks.
 */
export function requestMeshcoreAutoOffload(
  reason: MeshcoreAutoOffloadReason,
  now = Date.now(),
): void {
  const autoOffload = readMeshcoreAutoOffloadWhenFull();
  console.debug(
    `[meshcoreContactCapacityPush] auto-offload requested reason=${reason} enabled=${autoOffload}`,
  );
  if (reason === 'firmware_full' || reason === 'table_full_error') {
    setFirmwareContactsFullActive(true);
  }
  notifyMeshcoreContactCountMaybeChanged();

  if (contactsFullOffloadInFlight) {
    console.debug(
      `[meshcoreContactCapacityPush] auto-offload skipped (in flight) reason=${reason}`,
    );
    return;
  }
  if (
    lastContactsFullAlarmAt > 0 &&
    now - lastContactsFullAlarmAt < MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS
  ) {
    console.debug(
      `[meshcoreContactCapacityPush] auto-offload skipped (debounced) reason=${reason}`,
    );
    return;
  }

  if (autoOffload) {
    if (!contactsFullOffloadRunner) {
      console.warn(
        `[meshcoreContactCapacityPush] auto-offload requested but no runner reason=${reason}`,
      );
      return;
    }
    lastContactsFullAlarmAt = now;
    console.debug(`[meshcoreContactCapacityPush] auto-offload starting reason=${reason}`);
    pushAppToast(i18n.t('radioPanel.contactsFullAutoOffloadStarted'), 'warning', 6000);
    void runContactsFullOffload().catch((e: unknown) => {
      console.warn('[meshcoreContactCapacityPush] auto-offload failed ' + errLikeToLogString(e));
      pushAppToast(i18n.t('radioPanel.failedOffloadContacts'), 'error');
    });
    return;
  }

  // Count/eviction signals stay silent when auto-offload is off; the capacity badge covers them.
  if (reason === 'count_threshold' || reason === 'overwrite_eviction') return;

  lastContactsFullAlarmAt = now;

  const action: ToastAction = {
    label: i18n.t('radioPanel.contactsFullAlarmAction'),
    onClick: () => {
      void runContactsFullOffload().catch((e: unknown) => {
        console.warn('[meshcoreContactCapacityPush] offload CTA failed ' + errLikeToLogString(e));
        pushAppToast(i18n.t('radioPanel.failedOffloadContacts'), 'error');
      });
    },
  };
  pushAppToast(i18n.t('radioPanel.contactsFullAlarm'), 'error', 20_000, { action });
}

/** 0x90: companion contact table full. */
export function handleMeshcoreContactsFullPush(now = Date.now()): void {
  requestMeshcoreAutoOffload('firmware_full', now);
}

/**
 * App-side count check (connect, contact sync, new contact). Fires before the table is full so
 * offload wins over firmware overwrite-oldest. Returns true when a request was made.
 */
export function maybeRequestMeshcoreAutoOffloadForCount(
  onRadioCount: number,
  now = Date.now(),
): boolean {
  if (!readMeshcoreAutoOffloadWhenFull()) return false;
  const { critical } = meshcoreContactThresholds(getMeshcoreRadioMaxContacts());
  if (onRadioCount < critical) return false;
  requestMeshcoreAutoOffload('count_threshold', now);
  return true;
}

/** Routes a TABLE_FULL rejection from add/import into auto-offload. Returns true when handled. */
export function maybeRequestMeshcoreAutoOffloadForError(err: unknown, now = Date.now()): boolean {
  if (!isMeshcoreTableFullError(err)) return false;
  requestMeshcoreAutoOffload('table_full_error', now);
  return true;
}

export function resetMeshcoreContactCapacityPushForTests(): void {
  firmwareContactsFullActive = false;
  lastContactsFullAlarmAt = 0;
  contactsFullOffloadInFlight = false;
  contactsFullOffloadRunner = null;
  radioMaxContacts = null;
  firmwareFullListeners.clear();
  contactCountRefreshListeners.clear();
  radioMaxContactsListeners.clear();
}

export function attachMeshcoreContactCapacityPush(identityId: IdentityId): () => void {
  return packetRouter.addListener(createListener(identityId));
}

function createListener(identityId: IdentityId): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'meshcore_contact_deleted':
        void applyMeshcoreContactDeletedFromRadio({
          identityId,
          nodeId: event.payload.nodeId,
          publicKey: event.payload.publicKey,
        });
        // Firmware only pushes 0x8F for overwrite-oldest: the table is full and evicting.
        requestMeshcoreAutoOffload('overwrite_eviction');
        break;
      case 'meshcore_contacts_full':
        handleMeshcoreContactsFullPush();
        break;
      default:
        break;
    }
  };
}
