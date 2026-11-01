import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import tls from 'tls';

import type { MeshNode } from '../renderer/lib/types';
import type { MeshProtocol } from '../shared/meshProtocol';
import type {
  TAKChannelChatMessage,
  TakChatChannel,
  TAKClientInfo,
  TAKContact,
  TAKContactsUpdate,
  TAKDirectMessage,
  TakDirectPeer,
  TakDmProtocol,
  TakDmStatusUpdate,
  TAKGeochatMessage,
  TAKInboundChat,
  TakIncidentMarker,
  TakRelayExtras,
  TAKRemoteSettings,
  TAKRemoteStatus,
  TAKServerStatus,
  TAKSettings,
  TakStyleSettings,
} from '../shared/tak-types';
import { isTakDmProtocol, TAK_CHAT_HELD_MAX, TAK_DM_PROTOCOLS } from '../shared/tak-types';
import { sanitizeLogMessage } from './log-service';
import { advertisedNodeKind, advertisedTakStyle } from './tak/advertised-style';
import {
  type CertBundle,
  loadOrGenerateCerts,
  regenerateCerts,
  type TakServerIdentity,
} from './tak/certificate-manager';
import { ChannelReplies, type ChannelReplyOutcome } from './tak/channel-replies';
import { TakContactCache } from './tak/contact-cache';
import {
  COT_STALE_MS,
  cotCallsignFor,
  cotDeleteEvent,
  cotPongEvent,
  type CotRelayNode,
  cotUidFor,
  meshNodeToCot,
  parseMeshNodeUid,
} from './tak/cot-converter';
import {
  CotFramer,
  CotFrameTooLargeError,
  type CotGeochat,
  isCotPing,
  parseCotEvent,
  parseGeochatEvent,
} from './tak/cot-parser';
import { generateDataPackage } from './tak/data-package';
import {
  buildChannelChatCot,
  buildChannelContactCot,
  buildDirectChatCot,
  buildDirectContactCot,
  buildDirectReceiptCot,
  buildGeochatCot,
  CHANNEL_NOTE_SENDER,
  type ChannelChatLine,
  channelContactUid,
  CHAT_ROOM_CONTACT_STALE_MS,
  DIRECT_CONTACT_TTL_MS,
  type DirectChatLine,
  type GeochatRecipient,
  retiredRoomContactUid,
} from './tak/geochat-cot';
import {
  buildIncidentAlarmCot,
  buildIncidentMarkerCot,
  INCIDENT_MARKER_STALE_MS,
  incidentMarkerUid,
} from './tak/incident-cot';
import { getLanIp } from './tak/lan-ip';
import { TakRemoteClient } from './tak/remote-client';
import { loadTakRemoteCredentials } from './tak/remote-credentials';
import { DEFAULT_TAK_REMOTE_PORT, saveTakRemoteSettings } from './tak/remote-settings';
import { loadTakStyleSettings } from './tak/style-settings';
import { resolveTakStyle } from './tak/unit-filters';

interface ConnectedClient {
  socket: tls.TLSSocket;
  info: TAKClientInfo;
  framer: CotFramer;
  /** Uid of the unit whose callsign labels this client: its first self-reported unit event. */
  selfUid?: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Receive times of this client's recent chat messages, for the rate limit. */
  chatTimesMs: number[];
}

/** A node update from any protocol feed; `protocol` defaults to Meshtastic (MQTT feed). */
export type TakNodeUpdate = Partial<MeshNode> &
  TakRelayExtras & { node_id: number; protocol?: MeshProtocol };

interface CachedTakNode extends MeshNode, TakRelayExtras {
  protocol: MeshProtocol;
  /** When this entry last received an update, by the main-process clock. */
  cachedAtMs: number;
}

const NODE_CACHE_MAX_SIZE = 2000;
/** Local ATAK/iTAK connections; cap prevents unbounded TLS client growth. */
const MAX_TAK_CLIENTS = 16;
/** Chat messages one client may send per window; a mesh channel carries far less than this. */
const TAK_CLIENT_CHAT_MAX_PER_WINDOW = 10;
const TAK_CLIENT_CHAT_WINDOW_MS = 60 * 1000;
/** Disconnect idle clients after 24h without inbound data. */
const TAK_CLIENT_IDLE_MS = 24 * 60 * 60 * 1000;
/** A held channel message older than this is dropped rather than delivered late. */
const TAK_CHAT_HELD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Written into a receive-only channel's conversation when a client messages it. */
const RECEIVE_ONLY_NOTE =
  'Not sent: this channel is receive only. Turn on "ATAK can send" for it in mesh-client.';
/** How many matching names a note lists before "and N more". */
const REPLY_NAMES_SHOWN = 5;

/** Why a typed `@` reply was not sent, for the conversation it was typed in. */
function channelReplyNote(reply: Exclude<ChannelReplyOutcome, { kind: 'send' }>): string {
  if (reply.kind === 'nobody') {
    return 'Not sent: nobody has spoken on this channel recently, so @@ has no one to reply to.';
  }
  if (reply.kind === 'unencodable') {
    return `Not sent: ${reply.name} has a "]" in their name, which a MeshCore reply cannot hold. Leave out the @ to send it as plain text.`;
  }
  const shown = reply.names.slice(0, REPLY_NAMES_SHOWN).join(', ');
  const more = reply.names.length - REPLY_NAMES_SHOWN;
  const rest = more > 0 ? ` and ${more} more` : '';
  return `Not sent: @${reply.typed} matches ${shown}${rest}. Type more of the name.`;
}
/** Written into a companion's conversation when its radio has direct messages off. */
const DM_OFF_NOTE =
  'Not sent: direct messages are off for this radio. Turn on "Direct messages" for it in mesh-client.';
/** Written into a conversation with a node this app cannot send a direct message to. */
const NOT_REACHABLE_NOTE = 'Not sent: not a mesh contact this radio can message.';
/** Companions remembered with the device that last wrote to them, and with a 0, 0 contact. */
const DIRECT_PEERS_MAX = 512;
/** Tries mesh-client makes at a direct message: the send and its automatic resends. */
const DM_TRIES = 4;
/**
 * How long a direct message from a TAK client waits for its outcome. Its resends are over
 * within about five minutes; this also covers a slow last acknowledgement.
 */
const PENDING_DM_TTL_MS = 30 * 60 * 1000;
/** Direct messages from TAK clients awaiting their outcome. */
const PENDING_DMS_MAX = 256;
/** How much of a message a note about it quotes. */
const NOTE_QUOTE_LEN = 40;

/** A direct message a TAK client sent, until the renderer reports how it went. */
interface PendingDm {
  /** The companion's contact uid. */
  uid: string;
  protocol: TakDmProtocol;
  nodeId: number;
  /** Uid of the device that wrote it, which hears the outcome. */
  deviceUid: string;
  /** The conversation name the device filed it under. */
  chatroom: string;
  /** The device's id for the message, which a receipt names; unset when it sent none. */
  messageId?: string;
  text: string;
  sentAtMs: number;
}

/** The note for a direct message that was not acknowledged, or never went out. */
function dmOutcomeNote(
  outcome: 'unconfirmed' | 'not-sent',
  protocol: TakDmProtocol,
  callsign: string,
  text: string,
): string {
  const quote = text.length > NOTE_QUOTE_LEN ? `${text.slice(0, NOTE_QUOTE_LEN)}…` : text;
  if (outcome === 'not-sent') return `Not sent to the mesh: ${quote}`;
  // MeshCore DMs fail both ways, every try, while either radio holds an old contact for the
  // other; channels keep working since they share a key. A flood advert refreshes both.
  const hint =
    protocol === 'meshcore'
      ? ' If this keeps happening, send a flood advert from each radio so both have current contacts.'
      : '';
  return (
    `Not confirmed: no acknowledgement from ${callsign} after ${DM_TRIES} tries.` +
    ` It may not have arrived: ${quote}${hint}`
  );
}

/**
 * A heard message waiting for a TAK client to identify itself: a channel line for the first one
 * that does, or a direct message for the device the companion's last DM came from (any device
 * when none has written to it).
 */
type HeldChat =
  | { kind: 'channel'; channelKey: string; line: ChannelChatLine; heldAtMs: number }
  | {
      kind: 'direct';
      uid: string;
      line: DirectChatLine;
      recipientUid?: string;
      heldAtMs: number;
    };

/** A peer this app already has a direct conversation with. */
interface ConversationPeer {
  uid: string;
  protocol: TakDmProtocol;
  nodeId: number;
  callsign: string;
}

/** A companion a direct message has passed with, either way, in the last day. */
interface DirectContact {
  uid: string;
  protocol: TakDmProtocol;
  nodeId: number;
  callsign: string;
  lastDmMs: number;
}

/** Insert or move `key` to the newest end of a map, dropping the oldest entries past `max`. */
function setNewest<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  for (const old of map.keys()) {
    if (map.size <= max) return;
    map.delete(old);
  }
}

export class TakServerManager extends EventEmitter {
  private server: tls.Server | null = null;
  private clients = new Map<string, ConnectedClient>();
  private settings: TAKSettings | null = null;
  /**
   * Keyed by `${protocol}:${node_id}` (node ids from different protocols can collide), or by the
   * explicit uid of a tracker fix.
   */
  private nodeCache = new Map<string, CachedTakNode>();
  private certBundle: CertBundle | null = null;
  private _status: TAKServerStatus = { running: false, port: 8089, clientCount: 0 };
  private remote: TakRemoteClient | null = null;
  private remoteSettings: TAKRemoteSettings | null = null;
  private remoteStatus: TAKRemoteStatus = {
    state: 'disconnected',
    host: '',
    port: DEFAULT_TAK_REMOTE_PORT,
  };
  private readonly contacts = new TakContactCache();
  /** Uids of the previous version's room contacts, which every client is told to drop. */
  private retiredRoomUids = new Set<string>();
  /** Channels served to TAK clients, keyed by the uid of the contact that stands for each. */
  private chatChannels = new Map<string, TakChatChannel>();
  /** Heard messages held while no local client could be addressed, oldest first. */
  private heldChat: HeldChat[] = [];
  /** Who spoke on each channel lately, so a TAK client's `@name` reply can find them. */
  private readonly channelReplies = new ChannelReplies();
  /** Radios whose companions TAK clients may message. */
  private dmProtocols = new Set<TakDmProtocol>();
  /** Companions a direct message passed with in the last day, by uid, oldest first. */
  private directContacts = new Map<string, DirectContact>();
  /** Per companion uid, the uid of the TAK device that last sent it a direct message. */
  private lastWriters = new Map<string, string>();
  /** Direct messages from TAK clients awaiting their outcome, by dmRef, oldest first. */
  private pendingDms = new Map<string, PendingDm>();
  /**
   * Peers the renderer already has a direct conversation with, by uid. Each is messageable and,
   * while it has no marker, has a contact at 0, 0.
   */
  private conversationPeers = new Map<string, ConversationPeer>();
  private chatRoomAnnounceTimer: ReturnType<typeof setInterval> | null = null;
  /** Open MECP emergencies on TAK clients' maps, by marker uid. */
  private incidentMarkers = new Map<string, TakIncidentMarker>();
  private incidentMarkerTimer: ReturnType<typeof setInterval> | null = null;

  private styleSettings: TakStyleSettings;

  constructor() {
    super();
    this.styleSettings = loadTakStyleSettings();
    this.contacts.on('update', (update: TAKContactsUpdate) => {
      this.emit('contacts', update);
    });
  }

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'tak-settings.json');
  }

  getStatus(): TAKServerStatus {
    return { ...this._status };
  }

  /** True while node updates have somewhere to go; the IPC feed skips them otherwise. */
  hasActiveSink(): boolean {
    return this._status.running || this.remote !== null;
  }

  getRemoteStatus(): TAKRemoteStatus {
    return { ...this.remoteStatus };
  }

  /** Unexpired units and map points received from local ATAK clients and the remote server. */
  getContacts(): TAKContact[] {
    return this.contacts.snapshot();
  }

  /**
   * Start (or restart with new settings) the relay to a remote TAK server. Credentials are read
   * from disk here, so an import takes effect on the next start. The relay is independent of
   * the local server: either can run without the other.
   * Throws, leaving any running relay untouched, when the stored credentials cannot be read.
   */
  async startRemote(settings: TAKRemoteSettings): Promise<void> {
    const credentials = await loadTakRemoteCredentials();
    saveTakRemoteSettings(settings);
    // A restart in place: the renderer may never see the sink drop, so it would not send the
    // markers again.
    this.stopRemote(false);
    this.remoteSettings = settings;
    const remote = new TakRemoteClient({
      host: settings.host.trim(),
      port: settings.port,
      useTls: settings.useTls,
      verifyServer: settings.verifyServer,
      allowNameMismatch: settings.allowNameMismatch,
      credentials,
    });
    remote.on('status', (status: TAKRemoteStatus) => {
      this.remoteStatus = status;
      // The client only reports disconnected once it has stopped for good (unusable
      // credentials); stopRemote() detaches it before stopping, so this is that case.
      if (status.state === 'disconnected' && this.remote === remote) {
        this.remote = null;
        this.contacts.removeSource('remote');
      }
      this.emit('remote-status', { ...status });
    });
    remote.on('connected', () => {
      this.forEachFreshCot((cot) => remote.write(cot), false);
    });
    remote.on('cot', (contact: TAKContact) => {
      if (this.remote === remote) this.contacts.upsert(contact);
    });
    this.remote = remote;
    remote.start();
  }

  /** Reconnect a running relay so newly imported credentials replace the ones it holds. */
  async restartRemote(): Promise<void> {
    if (this.remote && this.remoteSettings) await this.startRemote(this.remoteSettings);
  }

  /** Stop the remote relay; with no local server left, the incident markers go too. */
  stopRemote(clearIncidentMarkers = true): void {
    const remote = this.remote;
    if (!remote) return;
    this.remote = null;
    remote.stop();
    remote.removeAllListeners();
    this.contacts.removeSource('remote');
    if (clearIncidentMarkers && !this.server) this.clearIncidentMarkers();
  }

  getConnectedClients(): TAKClientInfo[] {
    return Array.from(this.clients.values()).map((c) => ({ ...c.info }));
  }

  /** Server cert identity: UI server name + current LAN IP for EUD hostname checks. */
  private resolveServerIdentity(serverName: string): TakServerIdentity {
    return { serverName, ipAddresses: [getLanIp()] };
  }

  async start(settings: TAKSettings): Promise<void> {
    if (this.server) {
      this.stop();
    }

    this.settings = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));

    try {
      this.certBundle = await loadOrGenerateCerts(this.resolveServerIdentity(settings.serverName));
    } catch (err) {
      const msg = `Certificate generation failed: ${String(err)}`;
      this._status = { running: false, port: settings.port, clientCount: 0, error: msg };
      this.emit('status', this.getStatus());
      throw new Error(msg);
    }

    const serverOptions: tls.TlsOptions = {
      cert: this.certBundle.serverCert,
      key: this.certBundle.serverKey,
      ca: this.certBundle.caCert,
      requestCert: settings.requireClientCert,
      rejectUnauthorized: settings.requireClientCert,
    };

    this.server = tls.createServer(serverOptions, (socket) => {
      this._handleClient(socket);
    });

    this.server.on('error', (err) => {
      const msg = `Server error: ${String(err)}`;
      const safe = sanitizeLogMessage(msg);
      console.error('[TakServer]', safe);
      this._status = { running: false, port: settings.port, clientCount: 0, error: safe };
      this.emit('status', this.getStatus());
      this.emit('error', safe);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(settings.port, () => {
        this._status = { running: true, port: settings.port, clientCount: 0 };
        this.emit('status', this.getStatus());
        console.debug(`[TakServer] Listening on port ${settings.port}`);
        resolve();
      });
      this.server!.once('error', reject);
    });
  }

  stop(): void {
    if (!this.server) return;

    for (const [id, client] of this.clients) {
      this.clearClientIdleTimer(client);
      try {
        client.socket.destroy();
      } catch {
        // catch-no-log-ok: socket may already be closed; destroy error is expected during shutdown
      }
      this.clients.delete(id);
    }

    this.server.close();
    this.server = null;
    this.contacts.removeSource('local');
    this.channelReplies.clear();
    if (!this.remote) this.clearIncidentMarkers();
    this._status = { running: false, port: this.settings?.port ?? 8089, clientCount: 0 };
    this.emit('status', this.getStatus());
    console.debug('[TakServer] Stopped');
  }

  /**
   * Evict the least recently updated entries. onNodeUpdate re-inserts every key it touches, so
   * Map order is update order by the main-process clock. Feeds report last_heard in different
   * units (MQTT milliseconds, MeshCore and Reticulum seconds), so it cannot rank entries.
   */
  private pruneNodeCache(): void {
    for (const key of this.nodeCache.keys()) {
      if (this.nodeCache.size <= NODE_CACHE_MAX_SIZE) return;
      this.nodeCache.delete(key);
    }
  }

  onNodeUpdate(node: TakNodeUpdate): void {
    const protocol = node.protocol ?? 'meshtastic';
    const key = node.uid ?? `${protocol}:${node.node_id}`;
    const existing = this.nodeCache.get(key) ?? ({} as CachedTakNode);
    const merged: CachedTakNode = { ...existing, ...node, protocol, cachedAtMs: Date.now() };
    this.nodeCache.delete(key);
    this.nodeCache.set(key, merged);
    this.pruneNodeCache();

    if (merged.latitude == null || merged.longitude == null) return;
    if (!this.hasConnectedSink()) return;

    this.broadcastNode(merged);
  }

  /**
   * Deliver one message heard on a served channel. Each local client that has identified itself
   * gets it from the channel's contact; with none yet, it is held for the first that does. A
   * channel streamed to the remote server also goes there, as a plain GeoChat room.
   */
  sendChat(msg: TAKChannelChatMessage): void {
    const channel = this.chatChannels.get(channelContactUid(msg.channelKey));
    if (!channel) return;
    this.channelReplies.heard(msg.channelKey, msg.senderCallsign, Date.now());
    const line: ChannelChatLine = {
      senderCallsign: msg.senderCallsign,
      text: msg.text,
      timeMs: msg.timeMs,
    };
    if (channel.remote && this.remote?.isConnected()) {
      const room: TAKGeochatMessage = { room: channel.name, ...line };
      if (msg.latitude != null && msg.longitude != null) {
        room.latitude = msg.latitude;
        room.longitude = msg.longitude;
      }
      this.remote.write(buildGeochatCot(room));
    }
    if (!this._status.running) return;
    if (!this.writeChannelChat(channel, line)) {
      this.holdChat({ kind: 'channel', channelKey: msg.channelKey, line, heldAtMs: Date.now() });
    }
  }

  /**
   * Deliver one direct message heard from a companion: to the device that last wrote to it, or
   * to every identified local client when none has. Held when nobody it is for is connected.
   * Never sent to the remote server.
   */
  sendDirectMessage(msg: TAKDirectMessage): void {
    if (!this._status.running || !this.dmProtocols.has(msg.protocol)) return;
    // A repeater's or room server's reply to a login or command is not a conversation.
    const node = this.cachedNodeFor(msg.protocol, msg.nodeId);
    if (node && advertisedNodeKind(node, msg.protocol) !== 'companion') return;
    const now = Date.now();
    const contact = this.touchDirectContact(msg.protocol, msg.nodeId, msg.senderCallsign, now);
    const line: DirectChatLine = { text: msg.text, timeMs: msg.timeMs };
    const recipientUid = this.lastWriters.get(contact.uid);
    if (!this.writeDirectChat(contact, line, recipientUid)) {
      this.holdChat({ kind: 'direct', uid: contact.uid, line, recipientUid, heldAtMs: now });
    }
  }

  /**
   * Turn direct messages from TAK clients on or off per radio. A radio turned off loses its
   * companions' 0, 0 contacts and held direct messages; markers of a radio that changed are
   * sent again, so they gain or lose their chat endpoint at once.
   */
  setDirectMessaging(protocols: TakDmProtocol[]): void {
    const next = new Set(protocols);
    const changed: readonly string[] = TAK_DM_PROTOCOLS.filter(
      (p) => next.has(p) !== this.dmProtocols.has(p),
    );
    if (changed.length === 0) return;
    const now = Date.now();
    for (const contact of [...this.directContacts.values()]) {
      if (next.has(contact.protocol)) continue;
      this.directContacts.delete(contact.uid);
      if (!this.hasFreshMarker(contact.protocol, contact.nodeId, now)) {
        this.writeToClients(cotDeleteEvent(contact.uid, now));
      }
    }
    this.heldChat = this.heldChat.filter(
      (h) => h.kind === 'channel' || this.directContacts.has(h.uid),
    );
    const previous = this.dmProtocols;
    this.dmProtocols = next;
    for (const peer of this.conversationPeers.values()) {
      if (next.has(peer.protocol) === previous.has(peer.protocol)) continue;
      if (this.hasFreshMarker(peer.protocol, peer.nodeId, now)) continue;
      this.writeToClients(
        next.has(peer.protocol)
          ? this.conversationPeerCot(peer, now)
          : cotDeleteEvent(peer.uid, now),
      );
    }
    const cutoff = now - COT_STALE_MS;
    for (const node of this.nodeCache.values()) {
      if (node.cachedAtMs < cutoff || !changed.includes(node.protocol)) continue;
      const cot = this.toCot(node, true);
      if (cot) this.writeToClients(cot);
    }
    this.scheduleChatRoomAnnouncements();
  }

  /**
   * Replace the peers the renderer has a direct conversation with. A peer with no marker gets
   * its contact at 0, 0 at once, while direct messages are on for its radio; one dropped from
   * the list loses it, unless a direct message passed with it in the last day.
   */
  setDirectPeers(peers: TakDirectPeer[]): void {
    const now = Date.now();
    const next = new Map<string, ConversationPeer>();
    for (const peer of peers) {
      const uid = cotUidFor({ node_id: peer.nodeId }, peer.protocol);
      next.set(uid, { uid, ...peer });
    }
    const shown = (peer: ConversationPeer): boolean =>
      this.dmProtocols.has(peer.protocol) &&
      !this.directContacts.has(peer.uid) &&
      !this.hasFreshMarker(peer.protocol, peer.nodeId, now);
    for (const old of this.conversationPeers.values()) {
      if (!next.has(old.uid) && shown(old)) this.writeToClients(cotDeleteEvent(old.uid, now));
    }
    for (const peer of next.values()) {
      const old = this.conversationPeers.get(peer.uid);
      if (old?.callsign === peer.callsign || !shown(peer)) continue;
      this.writeToClients(this.conversationPeerCot(peer, now));
    }
    this.conversationPeers = next;
    this.scheduleChatRoomAnnouncements();
  }

  /** A conversation peer's contact at 0, 0, under the name its marker would have. */
  private conversationPeerCot(peer: ConversationPeer, nowMs: number): string {
    const callsign = this.directCallsign(peer.protocol, peer.nodeId, peer.callsign);
    return this.directContactCot({ ...peer, callsign }, nowMs, nowMs);
  }

  /**
   * A companion's or peer's contact at 0, 0, styled as its marker would be: by the unit filters
   * and icons, from its cached node or, with none heard, from its name and protocol.
   */
  private directContactCot(
    contact: { uid: string; callsign: string; protocol: MeshProtocol; nodeId: number },
    lastDmMs: number,
    nowMs: number,
  ): string {
    const node: CotRelayNode = this.cachedNodeFor(contact.protocol, contact.nodeId) ?? {
      node_id: contact.nodeId,
      long_name: contact.callsign,
      short_name: '',
      hw_model: '',
      snr: 0,
      battery: 0,
      last_heard: 0,
      latitude: null,
      longitude: null,
    };
    const style =
      resolveTakStyle(this.styleSettings, node, contact.protocol)?.style ??
      advertisedTakStyle(node, contact.protocol);
    return buildDirectContactCot(contact, lastDmMs, nowMs, style);
  }

  /** Keep a message for a client yet to identify itself, dropping the oldest past the cap. */
  private holdChat(item: HeldChat): void {
    this.heldChat.push(item);
    if (this.heldChat.length > TAK_CHAT_HELD_MAX) {
      this.heldChat.splice(0, this.heldChat.length - TAK_CHAT_HELD_MAX);
    }
  }

  /**
   * Hand a client that has just identified itself the held messages for it, oldest first:
   * every channel line, and each direct message for it or for no device in particular. Direct
   * messages for another device stay held for that one.
   */
  private flushHeldChat(id: string, client: ConnectedClient): void {
    if (this.heldChat.length === 0) return;
    const recipient = this.recipientFor(client);
    if (!recipient) return;
    const held = this.heldChat;
    this.heldChat = [];
    const now = Date.now();
    for (const item of held) {
      if (now - item.heldAtMs > TAK_CHAT_HELD_MAX_AGE_MS) continue;
      if (item.kind === 'channel') {
        const channel = this.chatChannels.get(channelContactUid(item.channelKey));
        if (channel) {
          this.writeToClient(id, client, buildChannelChatCot(channel, item.line, recipient, now));
        }
        continue;
      }
      if (item.recipientUid !== undefined && item.recipientUid !== recipient.uid) {
        this.heldChat.push(item);
        continue;
      }
      const contact = this.directContacts.get(item.uid);
      if (!contact) continue;
      if (!this.hasFreshMarker(contact.protocol, contact.nodeId, now)) {
        this.writeToClient(id, client, this.directContactCot(contact, contact.lastDmMs, now));
      }
      this.writeToClient(id, client, buildDirectChatCot(contact, item.line, recipient, now));
    }
  }

  /** The cached entry for a mesh node, if one has been heard. */
  private cachedNodeFor(protocol: MeshProtocol, nodeId: number): CachedTakNode | undefined {
    return this.nodeCache.get(`${protocol}:${nodeId}`);
  }

  /**
   * Whether TAK clients may message this node: a companion, on a radio with direct messages on,
   * that the renderer can send a DM to or that a DM has passed with.
   */
  private isChatReachable(node: CachedTakNode): boolean {
    if (node.uid !== undefined) return false;
    if (!isTakDmProtocol(node.protocol) || !this.dmProtocols.has(node.protocol)) return false;
    if (advertisedNodeKind(node, node.protocol) !== 'companion') return false;
    const uid = cotUidFor(node, node.protocol);
    return (
      node.chatReachable === true || this.directContacts.has(uid) || this.conversationPeers.has(uid)
    );
  }

  /** Whether local clients show the node's own marker now, standing in for its contact. */
  private hasFreshMarker(protocol: MeshProtocol, nodeId: number, nowMs: number): boolean {
    const node = this.cachedNodeFor(protocol, nodeId);
    return (
      node !== undefined && node.cachedAtMs >= nowMs - COT_STALE_MS && !!this.toCot(node, true)
    );
  }

  /** The callsign ATAK shows for a companion: its marker's, or else the name it was heard by. */
  private directCallsign(protocol: MeshProtocol, nodeId: number, fallback: string): string {
    const node = this.cachedNodeFor(protocol, nodeId);
    if (!node) return fallback;
    return (
      resolveTakStyle(this.styleSettings, node, protocol)?.callsign ||
      cotCallsignFor(node, protocol)
    );
  }

  /**
   * Record that a direct message passed with a companion now. A companion with no marker shown
   * gets (or refreshes) its 0, 0 contact; one whose marker had no endpoint gets it again with
   * one.
   */
  private touchDirectContact(
    protocol: TakDmProtocol,
    nodeId: number,
    heardCallsign: string,
    nowMs: number,
  ): DirectContact {
    const uid = cotUidFor({ node_id: nodeId }, protocol);
    const isNew = !this.directContacts.has(uid);
    const contact: DirectContact = {
      uid,
      protocol,
      nodeId,
      callsign: this.directCallsign(protocol, nodeId, heardCallsign),
      lastDmMs: nowMs,
    };
    setNewest(this.directContacts, uid, contact, DIRECT_PEERS_MAX);
    const node = this.cachedNodeFor(protocol, nodeId);
    if (!this.hasFreshMarker(protocol, nodeId, nowMs)) {
      this.writeToClients(this.directContactCot(contact, nowMs, nowMs));
    } else if (isNew && node && node.chatReachable !== true) {
      const cot = this.toCot(node, true);
      if (cot) this.writeToClients(cot);
    }
    if (isNew) this.scheduleChatRoomAnnouncements();
    return contact;
  }

  /**
   * Deliver one direct message from `contact` to the identified local client whose uid is
   * `recipientUid`, or to every identified client when it is unset. Returns whether any got it.
   */
  private writeDirectChat(
    contact: DirectContact,
    line: DirectChatLine,
    recipientUid: string | undefined,
  ): boolean {
    const now = Date.now();
    let delivered = false;
    for (const [id, client] of this.clients) {
      const recipient = this.recipientFor(client);
      if (!recipient || (recipientUid !== undefined && recipient.uid !== recipientUid)) continue;
      this.writeToClient(id, client, buildDirectChatCot(contact, line, recipient, now));
      delivered = true;
    }
    return delivered;
  }

  /**
   * Replace the set of channels served to TAK clients. A new channel's contact is announced to
   * every local client, and announced again when its name or send setting changes; a channel
   * no longer served has its contact removed.
   */
  setChatChannels(channels: TakChatChannel[]): void {
    const next = new Map(channels.map((c) => [channelContactUid(c.key), c]));
    const now = Date.now();
    for (const uid of this.chatChannels.keys()) {
      if (!next.has(uid)) this.writeToClients(cotDeleteEvent(uid, now));
    }
    for (const [uid, channel] of next) {
      const prev = this.chatChannels.get(uid);
      if (prev?.name === channel.name && prev.send === channel.send) continue;
      this.writeToClients(buildChannelContactCot(channel, now));
    }
    this.chatChannels = next;
    this.heldChat = this.heldChat.filter(
      (h) => h.kind === 'direct' || next.has(channelContactUid(h.channelKey)),
    );
    this.scheduleChatRoomAnnouncements();
  }

  /**
   * Retire the previous version's GeoChat room contacts: every local client is told to drop
   * them now, and each client that connects while they are listed is told too. The renderer
   * lists them for a day after the upgrade, as long as ATAK would have kept them.
   */
  retireChatRooms(rooms: string[]): void {
    const next = new Set(rooms.map(retiredRoomContactUid));
    const now = Date.now();
    for (const uid of next) {
      if (!this.retiredRoomUids.has(uid) && !this.chatChannels.has(uid)) {
        this.writeToClients(cotDeleteEvent(uid, now));
      }
    }
    this.retiredRoomUids = next;
  }

  /**
   * Re-announce channel and companion contacts well inside their stale time so they do not
   * expire in ATAK. Runs while there is any contact to announce.
   */
  /**
   * Replace the open MECP emergencies on TAK clients' maps. A new or changed one is sent to every
   * local client, and one no longer open is deleted from their maps. The rest are sent again
   * every few minutes, and to each client that connects. Not sent to the remote server.
   */
  setIncidentMarkers(markers: TakIncidentMarker[]): void {
    const next = new Map(markers.map((m) => [incidentMarkerUid(m.id), m]));
    const now = Date.now();
    for (const [uid, prev] of this.incidentMarkers) {
      // ATAK's alarm for a MAYDAY is cancelled once its marker stops asking for it, or is gone.
      if (prev.alarm && !next.get(uid)?.alarm) {
        this.writeToClients(buildIncidentAlarmCot(prev, now, true));
      }
      if (!next.has(uid)) this.writeToClients(cotDeleteEvent(uid, now));
    }
    for (const [uid, marker] of next) {
      const prev = this.incidentMarkers.get(uid);
      if (JSON.stringify(prev) === JSON.stringify(marker)) continue;
      this.writeToClients(buildIncidentMarkerCot(marker, now));
      // Sounded once, when it starts asking: a device not connected then sees only the marker.
      if (marker.alarm && !prev?.alarm) this.writeToClients(buildIncidentAlarmCot(marker, now));
    }
    this.incidentMarkers = next;
    this.scheduleIncidentMarkerRefresh();
  }

  /**
   * Forget the incident markers once no sink is left. The renderer sends the current list again
   * when a sink starts; while one is still up it keeps the list current, so it is kept.
   */
  private clearIncidentMarkers(): void {
    this.incidentMarkers.clear();
    if (this.incidentMarkerTimer) {
      clearInterval(this.incidentMarkerTimer);
      this.incidentMarkerTimer = null;
    }
  }

  /** Refresh the incident markers inside their stale time while there are any. */
  private scheduleIncidentMarkerRefresh(): void {
    const needed = this.incidentMarkers.size > 0;
    if (needed === (this.incidentMarkerTimer !== null)) return;
    if (this.incidentMarkerTimer) {
      clearInterval(this.incidentMarkerTimer);
      this.incidentMarkerTimer = null;
      return;
    }
    this.incidentMarkerTimer = setInterval(() => {
      const now = Date.now();
      for (const marker of this.incidentMarkers.values()) {
        this.writeToClients(buildIncidentMarkerCot(marker, now));
      }
    }, INCIDENT_MARKER_STALE_MS / 3);
    this.incidentMarkerTimer.unref();
  }

  private scheduleChatRoomAnnouncements(): void {
    const needed =
      this.chatChannels.size > 0 || this.directContacts.size > 0 || this.conversationPeers.size > 0;
    if (needed === (this.chatRoomAnnounceTimer !== null)) return;
    if (this.chatRoomAnnounceTimer) {
      clearInterval(this.chatRoomAnnounceTimer);
      this.chatRoomAnnounceTimer = null;
      return;
    }
    this.chatRoomAnnounceTimer = setInterval(() => {
      this.forEachChatRoomContact((cot) => {
        this.writeToClients(cot);
      });
      this.scheduleChatRoomAnnouncements();
    }, CHAT_ROOM_CONTACT_STALE_MS / 4);
    this.chatRoomAnnounceTimer.unref();
  }

  /**
   * Build the contact event for every served channel, and for every companion a direct message
   * passed with in the last day that has no marker shown, and pass each to `send`. Companions
   * past the day are forgotten; their contact has gone stale in ATAK by then.
   */
  private forEachChatRoomContact(send: (cot: string) => void): void {
    const now = Date.now();
    for (const channel of this.chatChannels.values()) send(buildChannelContactCot(channel, now));
    for (const contact of [...this.directContacts.values()]) {
      if (now - contact.lastDmMs >= DIRECT_CONTACT_TTL_MS) {
        this.directContacts.delete(contact.uid);
        continue;
      }
      if (!this.hasFreshMarker(contact.protocol, contact.nodeId, now)) {
        send(this.directContactCot(contact, contact.lastDmMs, now));
      }
    }
    for (const peer of this.conversationPeers.values()) {
      if (!this.dmProtocols.has(peer.protocol) || this.directContacts.has(peer.uid)) continue;
      if (!this.hasFreshMarker(peer.protocol, peer.nodeId, now)) {
        send(this.conversationPeerCot(peer, now));
      }
    }
  }

  /** The uid and callsign a client reported for itself, once it has reported both. */
  private recipientFor(client: ConnectedClient): GeochatRecipient | null {
    if (!client.selfUid || !client.info.callsign) return null;
    return { uid: client.selfUid, callsign: client.info.callsign };
  }

  /**
   * Deliver one channel line to every local client that has identified itself, skipping
   * `exceptId`. Returns whether any client received it; one that has not said who it is yet
   * cannot be addressed and is passed over.
   */
  private writeChannelChat(
    channel: TakChatChannel,
    line: ChannelChatLine,
    exceptId?: string,
    messageId?: string,
  ): boolean {
    const now = Date.now();
    let delivered = false;
    for (const [id, client] of this.clients) {
      if (id === exceptId) continue;
      const recipient = this.recipientFor(client);
      if (!recipient) continue;
      this.writeToClient(id, client, buildChannelChatCot(channel, line, recipient, now, messageId));
      delivered = true;
    }
    return delivered;
  }

  getStyleSettings(): TakStyleSettings {
    return this.styleSettings;
  }

  /**
   * Apply new styling: re-send every fresh node so open maps restyle without waiting, and
   * retract nodes the new filters exclude so they do not linger until stale.
   */
  setStyleSettings(settings: TakStyleSettings): void {
    const previous = this.styleSettings;
    this.styleSettings = settings;
    if (!this.hasConnectedSink()) return;
    const cutoff = Date.now() - COT_STALE_MS;
    for (const node of this.nodeCache.values()) {
      if (node.cachedAtMs < cutoff) continue;
      if (this.broadcastNode(node)) continue;
      if (
        node.latitude != null &&
        node.longitude != null &&
        resolveTakStyle(previous, node, node.protocol)
      ) {
        this.broadcast(cotDeleteEvent(cotUidFor(node, node.protocol)));
      }
    }
    // Channel and 0, 0 contacts take the new styles now, not at their next announcement.
    this.forEachChatRoomContact((cot) => {
      this.writeToClients(cot);
    });
  }

  private hasConnectedSink(): boolean {
    return this.clients.size > 0 || this.remote?.isConnected() === true;
  }

  /** Write one CoT event to the remote relay and every local client. */
  private broadcast(cot: string): void {
    if (this.remote?.isConnected()) this.remote.write(cot);
    this.writeToClients(cot);
  }

  /**
   * Send a node's marker to every sink: local clients get its chat endpoint when it has one,
   * the remote server never does, since direct messages are not relayed there. Returns false
   * when the node has no marker to send.
   */
  private broadcastNode(node: CachedTakNode): boolean {
    const local = this.toCot(node, true);
    if (!local) return false;
    if (this.remote?.isConnected()) this.remote.write(this.toCot(node, false) ?? local);
    this.writeToClients(local);
    return true;
  }

  /** Write one CoT event to every local client. */
  private writeToClients(cot: string): void {
    for (const [id, client] of this.clients) this.writeToClient(id, client, cot);
  }

  /** Write one CoT event to one local client, logging rather than throwing if the write fails. */
  private writeToClient(id: string, client: ConnectedClient, cot: string): void {
    try {
      client.socket.write(cot + '\n');
    } catch (err) {
      console.warn(`[TakServer] Failed to write to client ${id}:`, sanitizeLogMessage(String(err)));
    }
  }

  /**
   * Styled CoT for a cached node, or null when it has no position or filters exclude it. For
   * `local` clients a companion they may message carries a chat endpoint.
   */
  private toCot(node: CachedTakNode, local: boolean): string | null {
    const resolved = resolveTakStyle(this.styleSettings, node, node.protocol);
    if (!resolved) return null;
    return meshNodeToCot(node, node.protocol, {
      style: resolved.style,
      callsign: resolved.callsign,
      chatEndpoint: local && this.isChatReachable(node),
    });
  }

  /**
   * CoT for every cached node updated within the CoT stale window, for a sink that just
   * connected. Older entries would already have gone stale on a client that was connected all
   * along, so sending them now would present old positions as current.
   */
  private forEachFreshCot(send: (cot: string) => void, local: boolean): void {
    const cutoff = Date.now() - COT_STALE_MS;
    for (const node of this.nodeCache.values()) {
      if (node.cachedAtMs < cutoff) continue;
      const cot = this.toCot(node, local);
      if (cot) send(cot);
    }
  }

  async generateDataPackage(): Promise<string> {
    if (!this.settings) {
      throw new Error('TAK server must be started before generating a data package');
    }
    // Align cert SAN with the LAN IP written into connection.pref (may regen + restart).
    const identity = this.resolveServerIdentity(this.settings.serverName);
    const previousServerCert = this.certBundle?.serverCert;
    this.certBundle = await loadOrGenerateCerts(identity);
    if (
      this._status.running &&
      previousServerCert &&
      previousServerCert !== this.certBundle.serverCert
    ) {
      await this.start(this.settings);
    }
    return generateDataPackage(this.certBundle, this.settings);
  }

  /**
   * Regenerates the TAK server's TLS certificate/key pair.
   *
   * Failure point: `regenerateCerts()` (crypto/fs failure) or the subsequent
   * `start()` (e.g. port bind failure) can throw after `stop()` has already
   * torn down the running server.
   * Fallback: on cert-gen failure, record an explicit error status instead of
   * leaving `{running:false}` unexplained; on restart failure after a
   * successful regen, retry once with the previous (still-valid) certificate
   * bundle so the server doesn't stay down solely because of the new pair.
   * Logging: failures are logged via `console.error`/`console.warn` with
   * sanitized messages before rethrowing, so the IPC caller/UI always learns
   * the concrete cause.
   */
  async regenerateCertificates(): Promise<void> {
    const serverName = this.settings?.serverName ?? 'mesh-client';
    const wasRunning = this._status.running;
    const previousCertBundle = this.certBundle;

    if (wasRunning) this.stop();

    let newCertBundle: CertBundle;
    try {
      newCertBundle = await regenerateCerts(this.resolveServerIdentity(serverName));
    } catch (err) {
      const msg = `Certificate regeneration failed: ${String(err)}`;
      console.error('[TakServer]', sanitizeLogMessage(msg));
      this._status = {
        running: false,
        port: this.settings?.port ?? this._status.port,
        clientCount: 0,
        error: msg,
      };
      this.emit('status', this.getStatus());
      throw err instanceof Error ? err : new Error(msg);
    }
    this.certBundle = newCertBundle;

    if (!wasRunning || !this.settings) return;

    try {
      await this.start(this.settings);
    } catch (startErr) {
      // start() already recorded a stopped+error status for this attempt.
      // Best-effort: fall back to the previous certificate bundle so a bad
      // new cert/key pair doesn't leave the server down when it was running
      // before regeneration was requested.
      if (previousCertBundle) {
        this.certBundle = previousCertBundle;
        try {
          await this.start(this.settings);
          console.warn(
            '[TakServer] Restart with regenerated certificates failed; restored previous certificate bundle and restarted',
          );
          return;
        } catch {
          // catch-no-log-ok: fallback restart failed too; start() already recorded status/error for this attempt
        }
      }
      throw startErr;
    }
  }

  private clearClientIdleTimer(client: ConnectedClient): void {
    if (client.idleTimer) {
      clearTimeout(client.idleTimer);
      client.idleTimer = null;
    }
  }

  private resetClientIdleTimer(id: string, client: ConnectedClient): void {
    this.clearClientIdleTimer(client);
    client.idleTimer = setTimeout(() => {
      console.debug(`[TakServer] Idle timeout disconnect: ${sanitizeLogMessage(id)}`);
      try {
        client.socket.destroy();
      } catch {
        // catch-no-log-ok: socket may already be closed
      }
    }, TAK_CLIENT_IDLE_MS);
  }

  /** True when another connected client already holds `uid` as its own. */
  private uidHeldByOtherClient(clientId: string, uid: string): boolean {
    for (const [otherId, other] of this.clients) {
      if (otherId !== clientId && other.selfUid === uid) return true;
    }
    return false;
  }

  /**
   * ATAK opens with its own SA (a unit event); later unit events with that uid track renames.
   * A uid another connected client holds is never adopted, so one connection cannot take over
   * another's identity.
   */
  private updateClientCallsign(client: ConnectedClient, contact: TAKContact): void {
    if (!contact.type.startsWith('a-')) return;
    if (client.selfUid === undefined && !this.uidHeldByOtherClient(client.info.id, contact.uid)) {
      client.selfUid = contact.uid;
    }
    if (contact.uid !== client.selfUid || contact.callsign === client.info.callsign) return;
    client.info = { ...client.info, callsign: contact.callsign };
    this.emit('client-updated', { ...client.info });
    this.flushHeldChat(client.info.id, client);
  }

  /** Answer a client keepalive so the EUD does not time out a connection with no mesh traffic. */
  private sendPong(socket: tls.TLSSocket, nowMs: number): void {
    try {
      socket.write(cotPongEvent(nowMs) + '\n');
    } catch {
      // catch-no-log-ok: socket may close between the ping and the reply; not actionable
    }
  }

  /** True when this client is still under its chat rate limit; records the message if so. */
  private allowClientChat(client: ConnectedClient, nowMs: number): boolean {
    const cutoff = nowMs - TAK_CLIENT_CHAT_WINDOW_MS;
    client.chatTimesMs = client.chatTimesMs.filter((t) => t > cutoff);
    if (client.chatTimesMs.length >= TAK_CLIENT_CHAT_MAX_PER_WINDOW) return false;
    client.chatTimesMs.push(nowMs);
    return true;
  }

  /**
   * Whether this connection may send chat as `senderUid`. Every client presents the same
   * data-package certificate, so there is no per-device credential to check; the boundary the
   * server can hold is one identity per connection. The uid is the one the connection announced
   * in its own position report, or else the first one it chats as, and it is refused when
   * another connected client holds it.
   */
  private claimChatSender(id: string, client: ConnectedClient, senderUid: string): boolean {
    if (client.selfUid !== undefined) return client.selfUid === senderUid;
    if (this.uidHeldByOtherClient(id, senderUid)) return false;
    client.selfUid = senderUid;
    return true;
  }

  /**
   * A GeoChat message from a local client. One to a served channel's contact goes to the other
   * local clients from that contact and to the renderer, which sends it on the channel; a
   * receive-only channel gets a note back instead. One to a mesh node's contact is a direct
   * message (see handleClientDirectChat). Any other message is passed on to the other local
   * clients, as a TAK server does. Rebuilt from the parsed fields, never forwarded raw, and
   * only under the connection's own uid and callsign.
   */
  private handleClientChat(
    id: string,
    client: ConnectedClient,
    chat: CotGeochat,
    nowMs: number,
  ): void {
    if (!this.claimChatSender(id, client, chat.senderUid)) {
      console.warn(
        `[TakServer] Client ${sanitizeLogMessage(id)} sent chat as another sender; message dropped`,
      );
      return;
    }
    if (!this.allowClientChat(client, nowMs)) {
      console.warn(`[TakServer] Client ${sanitizeLogMessage(id)} chat rate limit; message dropped`);
      return;
    }
    // The callsign from the connection's own position report wins over the one in the message.
    const senderCallsign = client.info.callsign || chat.senderCallsign || chat.senderUid;
    const node = chat.roomId ? parseMeshNodeUid(chat.roomId) : null;
    if (node) {
      this.handleClientDirectChat(id, client, chat, node, senderCallsign, nowMs);
      return;
    }
    // A message to a channel's contact is for that channel, whatever name the client filed it
    // under. Anything else is GeoChat between TAK clients, passed on as a TAK server does.
    const channel = chat.roomId ? this.chatChannels.get(chat.roomId) : undefined;
    if (!channel) {
      const message: TAKGeochatMessage = {
        room: chat.room,
        senderCallsign,
        text: chat.text,
        timeMs: nowMs,
      };
      const groupCot = buildGeochatCot(message, nowMs, chat.messageId, chat.senderUid);
      for (const [otherId, other] of this.clients) {
        if (otherId !== id) this.writeToClient(otherId, other, groupCot);
      }
      return;
    }
    if (!channel.send) {
      this.writeChannelNote(id, client, channel, RECEIVE_ONLY_NOTE, nowMs, senderCallsign);
      return;
    }
    const reply: ChannelReplyOutcome =
      channel.protocol === 'meshcore'
        ? this.channelReplies.resolve(channel.key, chat.text, nowMs)
        : { kind: 'send', text: chat.text };
    if (reply.kind !== 'send') {
      this.writeChannelNote(id, client, channel, channelReplyNote(reply), nowMs, senderCallsign);
      return;
    }
    // The other clients see a reply as one heard from the mesh reads, `@Name …`.
    const shown =
      reply.repliedTo === undefined
        ? chat.text
        : `@${reply.repliedTo}${reply.message ? ` ${reply.message}` : ''}`;
    const line: ChannelChatLine = { senderCallsign, text: shown, timeMs: nowMs };
    this.writeChannelChat(channel, line, id, chat.messageId);
    const inbound: TAKInboundChat = {
      target: { kind: 'channel', channelKey: channel.key },
      senderCallsign,
      text: reply.text,
      clientId: id,
      timeMs: nowMs,
    };
    this.emit('client-chat', inbound);
  }

  /**
   * A note from mesh-client in a channel's conversation, to the one client it concerns. A client
   * that chats before its first position report is addressed by the uid it chatted as and the
   * callsign its message carried.
   */
  private writeChannelNote(
    id: string,
    client: ConnectedClient,
    channel: TakChatChannel,
    text: string,
    nowMs: number,
    chatCallsign: string,
  ): void {
    const recipient =
      this.recipientFor(client) ??
      (client.selfUid ? { uid: client.selfUid, callsign: chatCallsign } : null);
    if (!recipient) return;
    const note = { senderCallsign: CHANNEL_NOTE_SENDER, text, timeMs: nowMs };
    this.writeToClient(id, client, buildChannelChatCot(channel, note, recipient, nowMs));
  }

  /**
   * A local client's message to a mesh node's contact. It goes to the renderer, which sends it
   * as a direct message, when the node is a companion TAK clients may message; the device is
   * then the one the companion's replies go to. Otherwise a note in the conversation says why
   * it was not sent. It is never passed on to other clients.
   */
  private handleClientDirectChat(
    id: string,
    client: ConnectedClient,
    chat: CotGeochat,
    target: { protocol: MeshProtocol; nodeId: number },
    senderCallsign: string,
    nowMs: number,
  ): void {
    const { protocol, nodeId } = target;
    const uid = cotUidFor({ node_id: nodeId }, protocol);
    const note = (text: string): void => {
      const recipient = this.recipientFor(client);
      if (!recipient) return;
      const contact = { uid, callsign: this.directCallsign(protocol, nodeId, chat.room) };
      const line = { text: `${CHANNEL_NOTE_SENDER}: ${text}`, timeMs: nowMs };
      this.writeToClient(id, client, buildDirectChatCot(contact, line, recipient, nowMs));
    };
    if (!isTakDmProtocol(protocol)) {
      note(NOT_REACHABLE_NOTE);
      return;
    }
    if (!this.dmProtocols.has(protocol)) {
      note(DM_OFF_NOTE);
      return;
    }
    const node = this.cachedNodeFor(protocol, nodeId);
    const known = this.directContacts.has(uid) || this.conversationPeers.has(uid);
    if (!known && !(node && this.isChatReachable(node))) {
      note(NOT_REACHABLE_NOTE);
      return;
    }
    if (client.selfUid) setNewest(this.lastWriters, uid, client.selfUid, DIRECT_PEERS_MAX);
    this.touchDirectContact(protocol, nodeId, chat.room, nowMs);
    const inbound: TAKInboundChat = {
      target: { kind: 'direct', protocol, nodeId },
      senderCallsign,
      text: chat.text,
      clientId: id,
      timeMs: nowMs,
    };
    if (client.selfUid) {
      inbound.dmRef = randomUUID();
      this.prunePendingDms(nowMs);
      const pending: PendingDm = {
        uid,
        protocol,
        nodeId,
        deviceUid: client.selfUid,
        chatroom: chat.room,
        text: chat.text,
        sentAtMs: nowMs,
      };
      if (chat.messageId) pending.messageId = chat.messageId;
      setNewest(this.pendingDms, inbound.dmRef, pending, PENDING_DMS_MAX);
    }
    this.emit('client-chat', inbound);
  }

  /**
   * Tell the device that wrote a direct message how it went: a delivery receipt when the
   * companion acknowledged it, so ATAK marks it delivered, or a note in the conversation when
   * it was not acknowledged after the last resend or never went out. A note for a device that
   * is away waits for it with the held messages; a receipt is dropped.
   */
  reportDmOutcome(update: TakDmStatusUpdate): void {
    const now = Date.now();
    this.prunePendingDms(now);
    const pending = this.pendingDms.get(update.dmRef);
    if (!pending) return;
    this.pendingDms.delete(update.dmRef);
    if (!this._status.running) return;
    const contact = {
      uid: pending.uid,
      callsign: this.directCallsign(pending.protocol, pending.nodeId, pending.chatroom),
    };
    const device = this.clientWithUid(pending.deviceUid);
    if (update.outcome === 'delivered') {
      if (!device || pending.messageId === undefined) return;
      const [id, client, recipient] = device;
      this.writeToClient(
        id,
        client,
        buildDirectReceiptCot(contact, pending.chatroom, recipient, pending.messageId, now),
      );
      return;
    }
    const text = dmOutcomeNote(update.outcome, pending.protocol, contact.callsign, pending.text);
    const line: DirectChatLine = { text: `${CHANNEL_NOTE_SENDER}: ${text}`, timeMs: now };
    if (device) {
      const [id, client, recipient] = device;
      this.writeToClient(id, client, buildDirectChatCot(contact, line, recipient, now));
    } else if (this.directContacts.has(pending.uid)) {
      this.holdChat({
        kind: 'direct',
        uid: pending.uid,
        line,
        recipientUid: pending.deviceUid,
        heldAtMs: now,
      });
    }
  }

  /** Forget direct messages that have waited too long for their outcome. */
  private prunePendingDms(nowMs: number): void {
    for (const [ref, pending] of this.pendingDms) {
      if (nowMs - pending.sentAtMs < PENDING_DM_TTL_MS) return;
      this.pendingDms.delete(ref);
    }
  }

  /** The identified local client whose own uid is `uid`, with its recipient details. */
  private clientWithUid(uid: string): [string, ConnectedClient, GeochatRecipient] | undefined {
    for (const [id, client] of this.clients) {
      const recipient = this.recipientFor(client);
      if (recipient?.uid === uid) return [id, client, recipient];
    }
    return undefined;
  }

  private _handleClient(socket: tls.TLSSocket): void {
    const address = socket.remoteAddress ?? 'unknown';
    if (this.clients.size >= MAX_TAK_CLIENTS) {
      console.warn(
        `[TakServer] Client cap (${MAX_TAK_CLIENTS}) reached; rejecting ${sanitizeLogMessage(address)}`,
      );
      socket.destroy();
      return;
    }

    const id = randomUUID();
    const info: TAKClientInfo = { id, address, connectedAt: Date.now() };
    const client: ConnectedClient = {
      socket,
      info,
      framer: new CotFramer(),
      idleTimer: null,
      chatTimesMs: [],
    };
    this.clients.set(id, client);

    this._status = { ...this._status, clientCount: this.clients.size };
    this.emit('client-connected', { ...info });
    this.emit('status', this.getStatus());
    console.debug(`[TakServer] Client connected: ${address} (${id})`);

    this.forEachFreshCot((cot) => {
      try {
        socket.write(cot + '\n');
      } catch {
        // catch-no-log-ok: socket may close between connection and flush; not actionable
      }
    }, true);
    this.forEachChatRoomContact((cot) => {
      this.writeToClient(id, client, cot);
    });
    const now = Date.now();
    for (const marker of this.incidentMarkers.values()) {
      this.writeToClient(id, client, buildIncidentMarkerCot(marker, now));
    }
    for (const uid of this.retiredRoomUids) {
      if (!this.chatChannels.has(uid)) this.writeToClient(id, client, cotDeleteEvent(uid, now));
    }

    this.resetClientIdleTimer(id, client);

    socket.on('data', (chunk: Buffer) => {
      this.resetClientIdleTimer(id, client);
      const now = Date.now();
      let frames: string[];
      try {
        frames = client.framer.push(chunk);
      } catch (err) {
        if (!(err instanceof CotFrameTooLargeError)) throw err;
        console.warn(
          `[TakServer] Client ${sanitizeLogMessage(id)} sent an oversized CoT event; disconnecting`,
        );
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        if (isCotPing(frame)) {
          this.sendPong(socket, now);
          continue;
        }
        const chat = parseGeochatEvent(frame);
        if (chat) {
          this.handleClientChat(id, client, chat, now);
          continue;
        }
        const contact = parseCotEvent(frame, 'local', now);
        if (!contact) continue;
        this.contacts.upsert(contact);
        this.updateClientCallsign(client, contact);
      }
    });

    socket.on('close', () => {
      this.clearClientIdleTimer(client);
      this.clients.delete(id);
      this._status = { ...this._status, clientCount: this.clients.size };
      this.emit('client-disconnected', id);
      this.emit('status', this.getStatus());
      console.debug(`[TakServer] Client disconnected: ${address} (${id})`);
    });

    socket.on('error', () => {
      console.warn(`[TakServer] Client socket error ${sanitizeLogMessage(id)}: socket error`);
    });
  }
}
