import { describe, expect, it } from 'vitest';

import {
  expandRrcHubSlashBody,
  isRrcSlashExpandableRoom,
  normalizeRrcRoomName,
  parseRrcSlashInput,
  resolveRrcMsgTarget,
} from './rrcSlashCommands';

describe('parseRrcSlashInput', () => {
  it('returns chat for plain text', () => {
    expect(parseRrcSlashInput('hello')).toEqual({ kind: 'chat', body: 'hello' });
  });

  it('parses client-local commands', () => {
    expect(parseRrcSlashInput('/help')).toEqual({ kind: 'local', command: 'help' });
    expect(parseRrcSlashInput('/nick Alice')).toEqual({
      kind: 'local',
      command: 'nick',
      nickname: 'Alice',
    });
    expect(parseRrcSlashInput('/join #lobby')).toEqual({
      kind: 'local',
      command: 'join',
      room: '#lobby',
      key: undefined,
    });
    expect(parseRrcSlashInput('/join #secret mykey')).toEqual({
      kind: 'local',
      command: 'join',
      room: '#secret',
      key: 'mykey',
    });
    expect(parseRrcSlashInput('/part')).toEqual({
      kind: 'local',
      command: 'part',
      room: undefined,
    });
    expect(parseRrcSlashInput('/me waves')).toEqual({
      kind: 'local',
      command: 'me',
      action: 'waves',
    });
    expect(parseRrcSlashInput('/msg alice hi there')).toEqual({
      kind: 'local',
      command: 'msg',
      target: 'alice',
      text: 'hi there',
    });
    expect(parseRrcSlashInput('/clear')).toEqual({ kind: 'local', command: 'clear' });
    expect(parseRrcSlashInput('/quit')).toEqual({ kind: 'local', command: 'quit' });
  });

  it('passes hub commands through', () => {
    expect(parseRrcSlashInput('/list')).toEqual({ kind: 'hub', body: '/list' });
    expect(parseRrcSlashInput('/who #lobby')).toEqual({ kind: 'hub', body: '/who #lobby' });
  });

  it('normalizes room names', () => {
    expect(normalizeRrcRoomName('  #Lobby ')).toBe('#lobby');
  });
});

describe('expandRrcHubSlashBody', () => {
  it('rejects synthetic and DM rooms', () => {
    expect(isRrcSlashExpandableRoom('[hub]')).toBe(false);
    expect(isRrcSlashExpandableRoom('@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(expandRrcHubSlashBody('/op alice', '[hub]')).toBe('/op alice');
  });

  it('injects focused room for IRC-style moderation commands', () => {
    expect(expandRrcHubSlashBody('/op alice', 'general')).toBe('/op general alice');
    expect(expandRrcHubSlashBody('/topic hi there', 'general')).toBe('/topic general hi there');
    expect(expandRrcHubSlashBody('/mode +m', 'general')).toBe('/mode general +m');
    expect(expandRrcHubSlashBody('/kick bob', 'general')).toBe('/kick general bob');
    expect(expandRrcHubSlashBody('/ban add aabb', 'general')).toBe('/ban general add aabb');
    expect(expandRrcHubSlashBody('/invite list', 'lobby')).toBe('/invite lobby list');
    expect(expandRrcHubSlashBody('/register', 'general')).toBe('/register general');
    expect(expandRrcHubSlashBody('/who', 'general')).toBe('/who general');
    expect(expandRrcHubSlashBody('/names', '#Lobby')).toBe('/names #lobby');
  });

  it('does not double-inject when room is already the first arg', () => {
    expect(expandRrcHubSlashBody('/op general alice', 'general')).toBe('/op general alice');
    expect(expandRrcHubSlashBody('/op #General alice', 'general')).toBe('/op #General alice');
    expect(expandRrcHubSlashBody('/topic general hello', 'general')).toBe('/topic general hello');
    expect(expandRrcHubSlashBody('/mode lobby +m', 'lobby')).toBe('/mode lobby +m');
    expect(expandRrcHubSlashBody('/ban general add aabb', 'general')).toBe('/ban general add aabb');
    expect(expandRrcHubSlashBody('/who general', 'general')).toBe('/who general');
  });

  it('leaves hub-global commands unchanged', () => {
    expect(expandRrcHubSlashBody('/list', 'general')).toBe('/list');
    expect(expandRrcHubSlashBody('/stats', 'general')).toBe('/stats');
    expect(expandRrcHubSlashBody('/reload', 'general')).toBe('/reload');
    expect(expandRrcHubSlashBody('/kline list', 'general')).toBe('/kline list');
  });

  it('preserves joined wire spelling including leading #', () => {
    expect(expandRrcHubSlashBody('/op alice', '#Lobby')).toBe('/op #lobby alice');
  });
});

describe('resolveRrcMsgTarget', () => {
  const members = [
    { identity_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nickname: 'Alice' },
    { identity_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', nickname: 'Bob' },
  ];

  it('resolves by nick and full hash', () => {
    expect(resolveRrcMsgTarget('alice', members)?.identity_hash).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(resolveRrcMsgTarget('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', members)?.nickname).toBe('Bob');
  });

  it('resolves unique hash prefix', () => {
    expect(resolveRrcMsgTarget('aaaa', members)?.nickname).toBe('Alice');
  });

  it('strips leading @ from nick targets', () => {
    expect(resolveRrcMsgTarget('@alice', members)?.identity_hash).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(resolveRrcMsgTarget('@Alice', members)?.nickname).toBe('Alice');
  });
});
