import { getAppSettingsRaw } from '@/renderer/lib/appSettingsStorage';
import { loadMutedViews } from '@/renderer/lib/chatPanelProtocolStorage';
import i18n from '@/renderer/lib/i18n';
import { notifyMecpAlertsSuppressed, triggerMecpAlert } from '@/renderer/lib/mecp/mecpAlert';
import { recordMecpAlert } from '@/renderer/lib/mecp/mecpAlertThrottle';
import {
  getCachedMecpLanguage,
  localizeMecpCodes,
  mecpLanguageForAppLocale,
  tryParseMecp,
} from '@/renderer/lib/mecp/mecpMessages';
import {
  describeMecpTargetChannel,
  executeMecpRebroadcast,
  MECP_REBROADCAST_SETTINGS_KEY,
  parseMecpRebroadcastRules,
} from '@/renderer/lib/mecp/mecpRebroadcast';
import {
  resolveMecpSourceChannelName,
  sendMecpRebroadcastOnProtocol,
} from '@/renderer/lib/mecp/sendMecpRebroadcast';
import { isRrcRoomMuted, rrcMuteViewKey } from '@/renderer/lib/rrcMention';
import { useIncidentStore } from '@/renderer/stores/incidentStore';
import {
  isMecpSenderBlocked,
  mecpBlockKey,
  useMecpBlockStore,
} from '@/renderer/stores/mecpBlockStore';

export interface RrcMecpInboundArgs {
  messageId: string;
  body: string;
  room: string;
  hubDestHash: string;
  senderHash: string | null;
  nickname: string | null;
  /** Own local identity hash — skip when the sender is us. */
  localIdentityHash: string | null;
  /**
   * Local RRC nickname. A hashless hub echo is own only when this matches,
   * the same rule `rrcSessionStore` uses for unread. A hash that does not
   * match is never own, even if the nickname does.
   */
  localNickname?: string | null;
  timestampMs?: number;
}

/**
 * Own when the sender hash matches ours, or when the hub omitted the hash and
 * the nickname matches exactly. Matches `rrcSessionStore` unread: any truthy
 * hash, including whitespace, counts as present, and nicknames are not trimmed.
 * A present hash that does not match is never own.
 */
export function rrcMecpSenderIsOwn(args: {
  senderHash: string | null;
  nickname: string | null;
  localIdentityHash: string | null;
  localNickname?: string | null;
}): boolean {
  const senderHash = args.senderHash ?? '';
  const localHash = args.localIdentityHash ?? '';
  const senderKey = senderHash ? senderHash.toLowerCase() : '';
  const localKey = localHash ? localHash.toLowerCase() : '';
  if (senderKey && senderKey === localKey) return true;
  if (senderHash) return false;
  const nick = args.nickname ?? '';
  const localNick = args.localNickname ?? '';
  return Boolean(nick && nick === localNick);
}

/**
 * Throttle/block identity. Hashed senders use the hash. Hashless senders are
 * keyed by nickname, or by message id when there is no nickname, so they do
 * not share one `unknown` bucket.
 */
export function rrcMecpSenderBucket(args: {
  senderHash: string | null;
  nickname: string | null;
  messageId: string;
}): string {
  const hash = args.senderHash?.trim().toLowerCase() ?? '';
  if (hash) return hash;
  const nick = args.nickname?.trim().toLowerCase() ?? '';
  if (nick) return `nick:${nick}`;
  return `anon:${args.messageId}`;
}

const seenIds = new Set<string>();
const MAX_SEEN = 500;

function remember(id: string): boolean {
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  if (seenIds.size > MAX_SEEN) {
    const first = seenIds.values().next().value;
    if (first != null) seenIds.delete(first);
  }
  return true;
}

/** Test seam. */
export function clearRrcMecpInboundSeenForTests(): void {
  seenIds.clear();
}

function loadRules() {
  try {
    const raw = getAppSettingsRaw();
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    return parseMecpRebroadcastRules(parsed?.[MECP_REBROADCAST_SETTINGS_KEY]);
  } catch {
    // catch-no-log-ok
    return [];
  }
}

/**
 * Process an RRC room `msg` that may contain MECP: incident, alert, audit, rebroadcast.
 * Called from the Reticulum runtime (RRC chat does not land in messageStore).
 */
export async function handleRrcMecpInbound(args: RrcMecpInboundArgs): Promise<void> {
  const parsed = tryParseMecp(args.body);
  if (parsed?.severity == null) return;
  if (!remember(`reticulum:rrc:${args.messageId}`)) return;

  const hub = args.hubDestHash.trim().toLowerCase();
  const room = args.room.trim();
  if (!hub || !room || room.startsWith('[') || room.startsWith('@')) return;

  if (
    rrcMecpSenderIsOwn({
      senderHash: args.senderHash,
      nickname: args.nickname,
      localIdentityHash: args.localIdentityHash,
      localNickname: args.localNickname,
    })
  ) {
    return;
  }

  const senderId = rrcMecpSenderBucket({
    senderHash: args.senderHash,
    nickname: args.nickname,
    messageId: args.messageId,
  });

  const senderLabel = args.nickname?.trim() || senderId.slice(0, 8) || 'unknown';
  const blocked = isMecpSenderBlocked('reticulum', senderId);
  const lang = getCachedMecpLanguage(mecpLanguageForAppLocale(i18n.language || 'en'));
  const decoded = localizeMecpCodes(parsed, lang);
  const sourceChannelName = resolveMecpSourceChannelName('reticulum', 0, {
    rrcRoom: room,
    rrcHubDestHash: hub,
  });

  if (!blocked) {
    // Drills skip throttle/alert noise but still upsert + audit (matches useMecpAlertWatcher).
    const decision = parsed.isDrill ? null : recordMecpAlert(mecpBlockKey('reticulum', senderId));
    const quiet = decision?.alert === false;
    useIncidentStore.getState().upsertFromMecp({
      protocol: 'reticulum',
      parsed,
      senderId,
      senderName: senderLabel,
      channel: `${hub.slice(0, 8)}/${room}`,
      messageId: args.messageId,
      receivedAt: args.timestampMs ?? Date.now(),
      lastKnown: null,
      ...(quiet ? { quiet: true } : {}),
    });
    if (!quiet) {
      const mutedViews = loadMutedViews('reticulum');
      const viewKey = rrcMuteViewKey(hub, room);
      // Soft room match (#/case) — seed exact viewKey when muted so triggerMecpAlert.has works.
      const effectiveMuted = isRrcRoomMuted(hub, room, mutedViews)
        ? new Set([...mutedViews, viewKey])
        : mutedViews;
      triggerMecpAlert({
        severity: parsed.severity,
        isDrill: parsed.isDrill,
        senderLabel,
        viewKey,
        mutedViews: effectiveMuted,
        notifyHiddenWindow: true,
        dedupeKey: `reticulum:rrc:${args.messageId}`,
      });
    }
    if (decision?.notify) {
      notifyMecpAlertsSuppressed(decision.notify, senderLabel, () => {
        useMecpBlockStore.getState().block('reticulum', senderId, senderLabel);
      });
    }
  }

  try {
    await window.electronAPI.mecp.appendReceived({
      protocol: 'reticulum',
      severity: parsed.severity,
      drill: parsed.isDrill,
      from: senderLabel,
      channel: `${hub.slice(0, 8)}/${room}`,
      payload: args.body,
      decoded,
      direction: 'received',
      messageId: args.messageId,
      ...(blocked ? { blocked: true } : {}),
    });
  } catch (e) {
    console.warn('[rrcMecpInbound] appendReceived failed', e);
  }

  if (blocked) return;

  await executeMecpRebroadcast(
    {
      protocol: 'reticulum',
      channelIndex: 0,
      payload: args.body,
      receivedVia: 'rf',
      isOwn: false,
      isDrill: parsed.isDrill,
      senderLabel,
      sourceChannelName,
      rrcHubDestHash: hub,
      rrcRoom: room,
    },
    loadRules(),
    async (target, payload) => {
      await sendMecpRebroadcastOnProtocol(target, payload);
      if (!tryParseMecp(payload)) return;
      try {
        await window.electronAPI.mecp.appendReceived({
          protocol: 'reticulum',
          severity: parsed.severity,
          drill: parsed.isDrill,
          from: senderLabel,
          channel: `${hub.slice(0, 8)}/${room}`,
          payload,
          decoded,
          direction: 'rebroadcast',
          toProtocol: target.protocol,
          toChannel: describeMecpTargetChannel(target),
          bidirectional: target.bidirectional,
          messageId: args.messageId,
        });
      } catch (e) {
        console.warn('[rrcMecpInbound] rebroadcast audit failed', e);
      }
    },
  );
}
