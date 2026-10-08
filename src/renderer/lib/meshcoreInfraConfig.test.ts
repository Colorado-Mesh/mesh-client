import { describe, expect, it, vi } from 'vitest';

import { applyInfraConfig, readInfraConfig } from './meshcoreInfraConfig';

const current = () => true;
const radio = { frequency: '910.525', bandwidth: '62.5', sf: '7', cr: '8', tx: '20' };

describe('MeshCore infrastructure configuration', () => {
  it('loads radio settings sequentially and parses the combined response', async () => {
    const send = vi.fn().mockResolvedValueOnce('> 910.525,62.5,7,8').mockResolvedValueOnce('> 20');
    expect(await readInfraConfig('radio', send, current)).toEqual({
      values: radio,
      unavailable: [],
    });
    expect(send.mock.calls).toEqual([
      ['get radio', current],
      ['get tx', current],
    ]);
  });

  it('marks unsupported options unavailable without substituting defaults', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('Unknown config: radio')
      .mockResolvedValueOnce('> 20');
    expect(await readInfraConfig('radio', send, current)).toEqual({
      values: { tx: '20' },
      unavailable: ['frequency', 'bandwidth', 'sf', 'cr'],
    });
  });

  it('rejects malformed radio snapshots', async () => {
    await expect(
      readInfraConfig('radio', vi.fn().mockResolvedValue('> 910.525,7,8'), current),
    ).rejects.toThrow();
  });

  it('writes only dirty settings, awaits readback, and reports pending reboot', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('OK - reboot to apply')
      .mockResolvedValueOnce('> 910.525,62.5,8,8');
    const result = await applyInfraConfig('radio', radio, { ...radio, sf: '8' }, send, current);
    expect(result.error).toBeUndefined();
    expect(result.rebootRequired).toBe(true);
    expect(result.values.sf).toBe('8');
    expect(send.mock.calls).toEqual([
      ['set radio 910.525,62.5,8,8', current],
      ['get radio', current],
    ]);
  });

  it('accepts float32 radio readback and canonicalizes numeric arguments', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('> 910.5250244,62.500,8,8');
    const result = await applyInfraConfig(
      'radio',
      radio,
      { ...radio, frequency: '9.10525e2', sf: '8' },
      send,
      current,
    );
    expect(result.error).toBeUndefined();
    expect(result.values.bandwidth).toBe('62.5');
    expect(send.mock.calls[0][0]).toBe('set radio 910.525,62.5,8,8');
  });

  it('recognizes firmware unknown-option replies and preserves blank text', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('> Name')
      .mockResolvedValueOnce('> ')
      .mockResolvedValueOnce('??: lat')
      .mockResolvedValueOnce('> 0');
    expect(await readInfraConfig('identity', send, current)).toEqual({
      values: { name: 'Name', 'owner.info': '', lon: '0' },
      unavailable: ['lat'],
    });
  });

  it.each(['[Name]', 'Bad:name', 'é'.repeat(16)])(
    'rejects unsupported or oversized names %s before transmission',
    async (name) => {
      const send = vi.fn();
      const result = await applyInfraConfig('identity', { name: 'Old' }, { name }, send, current);
      expect(result.error).toBeDefined();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('validates the entire section before sending any writes', async () => {
    const send = vi.fn();
    const result = await applyInfraConfig(
      'identity',
      { name: 'Old', lat: '0' },
      { name: 'New', lat: '91' },
      send,
      current,
    );
    expect(result.error).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('never writes a field that has not been loaded', async () => {
    const send = vi.fn();
    const result = await applyInfraConfig('identity', {}, { name: 'New' }, send, current);
    expect(result.error).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('stops on firmware rejection while preserving earlier confirmed values', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('> New')
      .mockResolvedValueOnce('Error: rejected');
    const result = await applyInfraConfig(
      'identity',
      { name: 'Old', lat: '0' },
      { name: 'New', lat: '10' },
      send,
      current,
    );
    expect(result.error).toBeDefined();
    expect(result.values).toEqual({ name: 'New', lat: '0' });
    expect(result.appliedKeys).toEqual(['name']);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not report success when firmware truncates a requested value', async () => {
    const send = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce('> Short');
    const result = await applyInfraConfig(
      'identity',
      { name: 'Old' },
      { name: 'Shorter' },
      send,
      current,
    );
    expect(result.error).toBeDefined();
    expect(result.values.name).toBe('Short');
  });

  it('stops after an identity or connection change without sending readback', async () => {
    let active = true;
    const send = vi.fn(() => {
      active = false;
      return Promise.resolve('OK');
    });
    const result = await applyInfraConfig(
      'identity',
      { name: 'Old' },
      { name: 'New' },
      send,
      () => active,
    );
    expect(result.error).toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('supports clearing the guest password and rejects injected commands', async () => {
    const send = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce('> ');
    expect(
      (
        await applyInfraConfig(
          'room',
          { 'guest.password': 'hello' },
          { 'guest.password': '' },
          send,
          current,
        )
      ).error,
    ).toBeUndefined();
    expect(send).toHaveBeenCalledWith('set guest.password ', current);
    send.mockClear();
    expect(
      (
        await applyInfraConfig(
          'room',
          { 'guest.password': 'hello' },
          { 'guest.password': 'new\nreboot' },
          send,
          current,
        )
      ).error,
    ).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });
});
