import { useEffect, useRef } from 'react';

import { getAppSettingsRaw } from '@/renderer/lib/appSettingsStorage';
import { loadMutedViews } from '@/renderer/lib/chatPanelProtocolStorage';
import { chatViewKeyForMessage } from '@/renderer/lib/chatUnreadCounts';
import i18n from '@/renderer/lib/i18n';
import { triggerMecpAlert } from '@/renderer/lib/mecp/mecpAlert';
import {
  getCachedMecpLanguage,
  localizeMecpCodes,
  mecpLanguageForAppLocale,
  tryParseMecp,
} from '@/renderer/lib/mecp/mecpMessages';
import {
  executeMecpRebroadcast,
  MECP_REBROADCAST_SETTINGS_KEY,
  parseMecpRebroadcastRules,
} from '@/renderer/lib/mecp/mecpRebroadcast';
import { sendMecpRebroadcastOnProtocol } from '@/renderer/lib/mecp/sendMecpRebroadcast';
import type { MeshProtocol } from '@/renderer/lib/types';
import type { MessageRecord } from '@/renderer/stores/messageStore';

export interface MecpWatcherProtocolSlice {
  protocol: MeshProtocol;
  messages: readonly MessageRecord[];
  ownNodeIds: ReadonlySet<number>;
  ownSenderId?: number | null;
}

function messageDedupKey(protocol: string, id: string): string {
  return `${protocol}:${id}`;
}

function isOwnMessage(
  msg: MessageRecord,
  ownNodeIds: ReadonlySet<number>,
  ownSenderId?: number | null,
): boolean {
  if (msg.status != null) return true;
  if (ownSenderId != null && msg.from === ownSenderId) return true;
  if (ownNodeIds.has(msg.from)) return true;
  return false;
}

function loadRules() {
  try {
    const raw = getAppSettingsRaw();
    if (!raw) return parseMecpRebroadcastRules([]);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseMecpRebroadcastRules(parsed[MECP_REBROADCAST_SETTINGS_KEY]);
  } catch {
    // catch-no-log-ok corrupt settings
    return parseMecpRebroadcastRules([]);
  }
}

async function appendAudit(entry: {
  protocol: string;
  severity: number | null;
  drill: boolean;
  from?: string;
  channel?: number | string;
  payload: string;
  decoded?: string;
  direction?: 'received' | 'rebroadcast';
  toProtocol?: string;
  toChannel?: number | string;
  bidirectional?: boolean;
  messageId?: string;
}): Promise<void> {
  await window.electronAPI.mecp.appendReceived(entry);
}

async function processNewMessages(
  seen: Set<string>,
  alerted: Set<string>,
  slice: MecpWatcherProtocolSlice,
): Promise<void> {
  const lang = getCachedMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en'));
  const mutedViews = loadMutedViews(slice.protocol);

  for (const msg of slice.messages) {
    const key = messageDedupKey(slice.protocol, msg.id);
    if (seen.has(key)) continue;

    const parsed = tryParseMecp(msg.payload);
    if (!parsed) {
      seen.add(key);
      continue;
    }

    const own = isOwnMessage(msg, slice.ownNodeIds, slice.ownSenderId);
    const decoded = localizeMecpCodes(parsed, lang);

    if (!own) {
      try {
        await appendAudit({
          protocol: slice.protocol,
          severity: parsed.severity,
          drill: parsed.isDrill,
          from: msg.senderName ?? String(msg.from),
          channel: msg.channelIndex,
          payload: msg.payload,
          decoded,
          direction: 'received',
          messageId: msg.id,
        });
      } catch (e) {
        console.warn('[useMecpAlertWatcher] appendReceived failed', e);
        // Leave out of `seen` so audit can retry; alert at most once.
        if (
          !alerted.has(key) &&
          !msg.isHistory &&
          !msg.viaStoreForward &&
          !msg.tapback &&
          parsed.severity != null
        ) {
          alerted.add(key);
          const viewKey = chatViewKeyForMessage(
            {
              channel: msg.channelIndex,
              to: msg.to,
              sender_id: msg.from,
              reticulum_sender_hash: msg.reticulumSenderHash,
            },
            slice.protocol,
            slice.ownNodeIds,
          );
          triggerMecpAlert({
            severity: parsed.severity,
            isDrill: parsed.isDrill,
            senderLabel: msg.senderName ?? String(msg.from),
            viewKey,
            mutedViews,
            notifyHiddenWindow: true,
          });
        }
        continue;
      }
    }

    seen.add(key);

    if (own || msg.isHistory || msg.viaStoreForward || msg.tapback || parsed.severity == null) {
      continue;
    }

    if (!alerted.has(key)) {
      alerted.add(key);
      const viewKey = chatViewKeyForMessage(
        {
          channel: msg.channelIndex,
          to: msg.to,
          sender_id: msg.from,
          reticulum_sender_hash: msg.reticulumSenderHash,
        },
        slice.protocol,
        slice.ownNodeIds,
      );
      triggerMecpAlert({
        severity: parsed.severity,
        isDrill: parsed.isDrill,
        senderLabel: msg.senderName ?? String(msg.from),
        viewKey,
        mutedViews,
        notifyHiddenWindow: true,
      });
    }

    if (slice.protocol === 'meshtastic' || slice.protocol === 'meshcore') {
      void executeMecpRebroadcast(
        {
          protocol: slice.protocol,
          channelIndex: msg.channelIndex,
          payload: msg.payload,
          receivedVia: msg.receivedVia,
          isOwn: own,
          isDrill: parsed.isDrill,
          isHistory: msg.isHistory,
          viaStoreForward: msg.viaStoreForward,
        },
        loadRules(),
        async (target, payload) => {
          await sendMecpRebroadcastOnProtocol(target, payload);
          try {
            await appendAudit({
              protocol: slice.protocol,
              severity: parsed.severity,
              drill: parsed.isDrill,
              from: msg.senderName ?? String(msg.from),
              channel: msg.channelIndex,
              payload,
              decoded,
              direction: 'rebroadcast',
              toProtocol: target.protocol,
              toChannel: target.channelIndex,
              bidirectional: target.bidirectional,
              messageId: msg.id,
            });
          } catch (e) {
            console.warn('[useMecpAlertWatcher] rebroadcast audit failed', e);
          }
        },
      );
    }
  }
}

/**
 * Mount once from App. Watches per-protocol message stores for new inbound MECP:
 * audit log, severity-aware alerts, optional RF rebroadcast.
 */
export function useMecpAlertWatcher(
  meshtastic: MecpWatcherProtocolSlice,
  meshcore: MecpWatcherProtocolSlice,
  reticulum: MecpWatcherProtocolSlice,
): void {
  const seenRef = useRef<Set<string> | null>(null);
  const alertedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  // Seed once from the current snapshot so hydration does not alert/audit.
  useEffect(() => {
    if (seededRef.current) return;
    const seed = new Set<string>();
    for (const slice of [meshtastic, meshcore, reticulum]) {
      for (const msg of slice.messages) {
        seed.add(messageDedupKey(slice.protocol, msg.id));
      }
    }
    seenRef.current = seed;
    seededRef.current = true;
  }, [meshtastic, meshcore, reticulum]);

  useEffect(() => {
    const seen = seenRef.current;
    if (!seen || !seededRef.current) return;
    const alerted = alertedRef.current;
    void (async () => {
      await processNewMessages(seen, alerted, meshtastic);
      await processNewMessages(seen, alerted, meshcore);
      await processNewMessages(seen, alerted, reticulum);
    })();
  }, [meshtastic.messages, meshcore.messages, reticulum.messages, meshtastic, meshcore, reticulum]);
}
