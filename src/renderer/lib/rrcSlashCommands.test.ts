import { describe, expect, it } from 'vitest';

import { normalizeRrcRoomName, parseRrcSlashInput, resolveRrcMsgTarget } from './rrcSlashCommands';

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
