import { describe, expect, it } from 'vitest';

import { normalizeRrcRoomName, parseRrcSlashInput } from './rrcSlashCommands';

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
