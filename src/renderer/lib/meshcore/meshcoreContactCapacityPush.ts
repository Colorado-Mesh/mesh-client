/**
 * MeshCore companion pushes for contact capacity:
 * - 0x8F CONTACT_DELETED — one radio eviction; mark that contact off-radio and decrement count
 * - 0x90 CONTACTS_FULL — alarm / optional auto-offload
 */
import { pushAppToast, type ToastAction } from '../../components/Toast';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import i18n from '../i18n';
import { MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS } from '../timeConstants';
import type { IdentityId } from '../types';

export const MESHCORE_AUTO_OFFLOAD_WHEN_FULL_KEY = 'mesh-client:meshcoreAutoOffloadWhenFull';

/** Firmware reported contacts-full; capacity UI treats as critical until cleared. */
let firmwareContactsFullActive = false;
const firmwareFullListeners = new Set<() => void>();
const contactCountRefreshListeners = new Set<() => void>();

let lastContactsFullAlarmAt = 0;
let contactsFullOffloadInFlight = false;

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

/**
 * 0x90: companion contact table full. Latch critical UI; auto-offload or sticky alarm+CTA.
 */
export function handleMeshcoreContactsFullPush(now = Date.now()): void {
  setFirmwareContactsFullActive(true);
  notifyMeshcoreContactCountMaybeChanged();

  if (readMeshcoreAutoOffloadWhenFull()) {
    if (contactsFullOffloadInFlight) return;
    pushAppToast(i18n.t('radioPanel.contactsFullAutoOffloadStarted'), 'warning', 6000);
    void runContactsFullOffload().catch((e: unknown) => {
      console.warn('[meshcoreContactCapacityPush] auto-offload failed ' + errLikeToLogString(e));
      pushAppToast(i18n.t('radioPanel.failedOffloadContacts'), 'error');
    });
    return;
  }

  if (
    lastContactsFullAlarmAt > 0 &&
    now - lastContactsFullAlarmAt < MESHCORE_CONTACTS_FULL_ALARM_DEBOUNCE_MS
  )
    return;
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

export function resetMeshcoreContactCapacityPushForTests(): void {
  firmwareContactsFullActive = false;
  lastContactsFullAlarmAt = 0;
  contactsFullOffloadInFlight = false;
  contactsFullOffloadRunner = null;
  firmwareFullListeners.clear();
  contactCountRefreshListeners.clear();
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
        break;
      case 'meshcore_contacts_full':
        handleMeshcoreContactsFullPush();
        break;
      default:
        break;
    }
  };
}
