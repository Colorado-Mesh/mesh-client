// @vitest-environment jsdom
/**
 * Source contract tests for RRC multi-hub WebSocket event routing.
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime RRC event routing (regression)', () => {
  it('honors will_reconnect=false by clearing the hub session', () => {
    expect(SOURCE).toMatch(/will_reconnect\?: boolean/);
    expect(SOURCE).toMatch(/p\.will_reconnect === false/);
    expect(SOURCE).toMatch(
      /p\.reason === 'local_disconnect'[\s\S]*?disconnectIntentForHub[\s\S]*?p\.will_reconnect === false[\s\S]*?clearHubSession/,
    );
  });

  it('keeps rooms while sidecar auto-reconnects when will_reconnect is true or omitted', () => {
    expect(SOURCE).toMatch(/willReconnect \|\| p\.will_reconnect === undefined/);
    expect(SOURCE).toMatch(/applyStatus\('reconnecting'/);
  });

  it('routes rrc.connected status and capabilities to the addressed hub', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.connected'/);
    expect(SOURCE).toMatch(/applyStatus\(st, hubDestHash/);
    expect(SOURCE).toMatch(/setCapabilities\([\s\S]*?hubDestHash/);
    expect(SOURCE).toMatch(/applyWelcomeName\(hubDestHash/);
  });

  it('routes room join/part and messages with hub_dest_hash', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.joined'/);
    expect(SOURCE).toMatch(/roomJoined\(p\.room, p\.members, p\.hub_dest_hash/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.parted'/);
    expect(SOURCE).toMatch(/roomParted\(p\.room, \{ forced: !voluntary \}, hubDestHash\)/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.message'/);
    expect(SOURCE).toMatch(/hub_dest_hash\?: string \| null/);
    expect(SOURCE).toMatch(/addMessage\([\s\S]*?\{ hubDestHash \}/);
  });

  it('updates lastWhisperPeer from inbound directs only when unpinned', () => {
    expect(SOURCE).toMatch(/isDirect &&[\s\S]*?sender_hash[\s\S]*?setLastWhisperPeer/);
    expect(SOURCE).toMatch(/onlyIfUnpinned:\s*true/);
    expect(SOURCE).toMatch(/RRC_WHISPERS_ROOM/);
  });

  it('uses neutral hubParted banner for involuntary parts (not kick/ban wording)', () => {
    expect(SOURCE).toMatch(/resolveRrcInvoluntaryPartBannerKey/);
    expect(SOURCE).toMatch(/sessionStatus: view\.status/);
    expect(SOURCE).toMatch(
      /if \(bannerKey\) session\.setModerationBanner\(bannerKey, hubDestHash\)/,
    );
    // Parted path must not hard-code the kick/ban key (moderation NOTICE/ERROR still may).
    expect(SOURCE).toMatch(
      /evt\.type === 'rrc\.room\.parted'[\s\S]*?resolveRrcInvoluntaryPartBannerKey\([\s\S]*?if \(bannerKey\) session\.setModerationBanner\(bannerKey/,
    );
    expect(SOURCE).toMatch(
      /i18n\.t\('rrc\.moderation\.removedFromRoomSystem',\s*\{\s*room:\s*p\.room\s*\}\)/,
    );
    expect(SOURCE).not.toMatch(/Removed from \$\{p\.room\}/);
  });

  it('reserves removedFromRoom banner for moderation NOTICE/ERROR language', () => {
    expect(SOURCE).toMatch(
      /isRrcModerationLanguage\(p\.body\)[\s\S]*?setModerationBanner\('rrc\.moderation\.removedFromRoom'/,
    );
    expect(SOURCE).toMatch(
      /isRrcModerationLanguage\(p\.message\)[\s\S]*?setModerationBanner\('rrc\.moderation\.removedFromRoom'/,
    );
  });

  it('debug-logs rrc.disconnected and rrc.room.parted with hub/room/voluntary', () => {
    expect(SOURCE).toMatch(/console\.debug\(\s*'\[useReticulumRuntime\] rrc\.disconnected hub='/);
    expect(SOURCE).toMatch(/console\.debug\(\s*'\[useReticulumRuntime\] rrc\.room\.parted hub='/);
    expect(SOURCE).toMatch(/voluntary='/);
    expect(SOURCE).toMatch(/will_reconnect='/);
  });
});
