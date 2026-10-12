import { describe, expect, it, vi } from 'vitest';

import {
  parseMeshcoreRepeaterRegions,
  readMeshcoreRepeaterRegions,
} from './meshcoreRepeaterRegions';
import { createRepeaterCommandService } from './repeaterCommandService';

const tree = '*^ F\n us F\n  us-tn F\n   us-tn-tri\n';

describe('MeshCore repeater regions', () => {
  it('reads three configured regions through a correlated multiline CLI response', async () => {
    const service = createRepeaterCommandService();
    const send = vi.fn((command: string) => {
      const pending = service.registerPendingCommand(command, [], { senderNodeId: 42 });
      expect(service.handleResponse(`${pending.token}|${tree}`, 99)).toBe(false);
      expect(service.handleResponse(`${pending.token}|${tree}`, 42)).toBe(true);
      return pending.promise;
    });
    const current = () => true;
    expect(await readMeshcoreRepeaterRegions(send, current)).toEqual({
      entries: [
        { name: '*', depth: 0, home: true, floodAllowed: true },
        { name: 'us', depth: 1, home: false, floodAllowed: true },
        { name: 'us-tn', depth: 2, home: false, floodAllowed: true },
        { name: 'us-tn-tri', depth: 3, home: false, floodAllowed: false },
      ],
      truncated: false,
    });
    expect(send).toHaveBeenCalledWith('region', current);
    expect(service.hasPendingCommand('00')).toBe(false);
  });

  it('accepts public, private, Unicode and sibling regions with CRLF replies', () => {
    const parsed = parseMeshcoreRepeaterRegions('*\r\n #us F\r\n  $private\r\n 日本^ F\r\n');
    expect(parsed.entries.map(({ name }) => name)).toEqual(['*', '#us', '$private', '日本']);
    expect(parsed.entries.at(-1)).toMatchObject({ home: true, depth: 1 });
  });

  it('retains complete rows but drops a partial row when the firmware buffer fills', () => {
    const complete = '* F\n' + ' region F\n'.repeat(15);
    expect(complete.length).toBe(154);
    const parsed = parseMeshcoreRepeaterRegions(complete + ' next');
    expect(parsed.truncated).toBe(true);
    expect(parsed.entries).toHaveLength(16);
    expect(parsed.entries.at(-1)?.name).toBe('region');
  });

  it('warns at the byte limit even when the last row is complete', () => {
    const response = '* F\n' + ' é F\n'.repeat(25) + ' foo\n';
    expect(new TextEncoder().encode(response)).toHaveLength(159);
    expect(parseMeshcoreRepeaterRegions(response)).toMatchObject({ truncated: true });
  });

  it.each(['', 'Unknown command: region', 'Error: Region commands not implemented', 'Err - ??'])(
    'reports unavailable firmware replies instead of an empty region list: %s',
    (reply) => {
      expect(() => parseMeshcoreRepeaterRegions(reply)).toThrow();
    },
  );

  it.each(['OK', 'region F\n', '* F\n   skipped-parent F\n', '* F\n* F\n', '* F\n a\0 F\n'])(
    'rejects malformed trees: %s',
    (reply) => {
      expect(() => parseMeshcoreRepeaterRegions(reply)).toThrow();
    },
  );

  it('does not send after disconnect or accept a reply from an old connection', async () => {
    let current = false;
    const send = vi.fn(() => {
      current = false;
      return Promise.resolve(tree);
    });
    await expect(readMeshcoreRepeaterRegions(send, () => current)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    current = true;
    await expect(readMeshcoreRepeaterRegions(send, () => current)).rejects.toThrow();
  });

  it('distinguishes rejected commands from unsupported firmware', () => {
    expect(() => parseMeshcoreRepeaterRegions('Error: access denied')).toThrow('commandRejected');
    expect(() => parseMeshcoreRepeaterRegions('Error: unsupported')).toThrow('regionsUnavailable');
  });
});
