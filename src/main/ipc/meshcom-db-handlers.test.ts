import { describe, expect, it, vi } from 'vitest';

import {
  pruneMeshcomContactsByCountOn,
  pruneMeshcomMessagesByCountOn,
  rebindMeshcomIdentityOn,
  validateDeleteMeshcomContact,
  validateSaveMeshcomContact,
  validateSaveMeshcomMessage,
} from './meshcom-db-handlers';

describe('validateSaveMeshcomMessage', () => {
  it('accepts a minimal valid message', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'hello',
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });

  it('rejects missing text', () => {
    expect(() => {
      validateSaveMeshcomMessage({ timestamp: 1 });
    }).toThrow(/text/);
  });

  it('rejects invalid received_via', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        received_via: 'carrier-pigeon',
      });
    }).toThrow(/received_via/);
  });

  it('accepts GRC group channel_idx above 255 (e.g. SP 260)', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'siema',
        timestamp: 1,
        channel_idx: 260,
      });
    }).not.toThrow();
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'siema',
        timestamp: 1,
        channel_idx: 99999,
      });
    }).not.toThrow();
  });

  it('rejects channel_idx outside -1..99999', () => {
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        channel_idx: 100000,
      });
    }).toThrow(/channel_idx/);
    expect(() => {
      validateSaveMeshcomMessage({
        text: 'x',
        timestamp: 1,
        channel_idx: 1.5,
      });
    }).toThrow(/channel_idx/);
  });
});

describe('validateSaveMeshcomContact', () => {
  it('accepts a callsign + node_id', () => {
    expect(() => {
      validateSaveMeshcomContact({
        callsign: 'OE1KFR-1',
        node_id: 1,
      });
    }).not.toThrow();
  });

  it('rejects empty callsign', () => {
    expect(() => {
      validateSaveMeshcomContact({ callsign: '  ', node_id: 1 });
    }).toThrow(/callsign/);
  });

  it('accepts explicit favorited 0/1', () => {
    expect(() => {
      validateSaveMeshcomContact({ callsign: 'OE1ABC-1', node_id: 2, favorited: 1 });
    }).not.toThrow();
    expect(() => {
      validateSaveMeshcomContact({ callsign: 'OE1ABC-1', node_id: 2, favorited: false });
    }).not.toThrow();
  });
});

describe('saveMeshcomContact favorited upsert SQL', () => {
  it('preserves existing favorited when the field is omitted on ingest upsert', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'meshcom-db-handlers.ts'),
      'utf8',
    );
    expect(src).toMatch(/WHEN @favorited_provided = 1 THEN excluded\.favorited/);
    expect(src).toMatch(/ELSE meshcom_contacts\.favorited/);
  });
});

describe('validateDeleteMeshcomContact', () => {
  it('uppercases callsign and trims identity (same as saveMeshcomContact)', () => {
    expect(validateDeleteMeshcomContact('  offline-meshcom  ', 'oe1kfr-1')).toEqual({
      identityId: 'offline-meshcom',
      callsign: 'OE1KFR-1',
    });
  });

  it('rejects empty identity or callsign', () => {
    expect(() => {
      validateDeleteMeshcomContact('', 'W1AW-1');
    }).toThrow(/identityId/);
    expect(() => {
      validateDeleteMeshcomContact('id', '  ');
    }).toThrow(/callsign/);
  });
});

describe('deleteMeshcomContact SQL', () => {
  it('deletes by identity_id and callsign PK', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'meshcom-db-handlers.ts'),
      'utf8',
    );
    expect(src).toMatch(/DELETE FROM meshcom_contacts WHERE identity_id = \? AND callsign = \?/);
  });
});

describe('pruneMeshcomMessagesByCountOn', () => {
  it('keeps only the newest N rows', () => {
    const run = vi.fn().mockReturnValue({ changes: 7 });
    const prepareOnce = vi.fn().mockReturnValue({ run });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomMessagesByCountOn(db, 4000)).toBe(7);
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM meshcom_messages WHERE id NOT IN'),
    );
    expect(run).toHaveBeenCalledWith(4000);
  });
});

describe('pruneMeshcomContactsByCountOn', () => {
  it('no-ops when under the cap', () => {
    const get = vi.fn().mockReturnValue({ cnt: 10 });
    const prepareOnce = vi.fn().mockReturnValue({ get, run: vi.fn() });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomContactsByCountOn(db, 100)).toBe(0);
  });

  it('deletes excess non-favorited contacts when over the cap', () => {
    const get = vi.fn().mockReturnValueOnce({ cnt: 150 }).mockReturnValueOnce({ cnt: 5 });
    const run = vi.fn().mockReturnValue({ changes: 45 });
    const prepareOnce = vi.fn().mockReturnValue({ get, run });
    const db = { prepareOnce } as never;
    expect(pruneMeshcomContactsByCountOn(db, 100)).toBe(45);
    expect(run).toHaveBeenCalledWith(95);
  });
});

describe('rebindMeshcomIdentityOn', () => {
  it('moves messages and contacts from an ephemeral id into offline', () => {
    const run = vi.fn().mockReturnValue({ changes: 2 });
    const prepareOnce = vi.fn().mockReturnValue({ run, all: vi.fn().mockReturnValue([]) });
    const db = { prepareOnce } as never;
    expect(rebindMeshcomIdentityOn(db, 'id-old-session', 'offline-meshcom')).toEqual({
      changes: 8,
    });
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE meshcom_messages SET identity_id'),
    );
    expect(prepareOnce).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE meshcom_contacts SET identity_id'),
    );
    expect(run).toHaveBeenCalledWith({ fromId: 'id-old-session', toId: 'offline-meshcom' });
  });

  it('no-ops when fromId equals toId', () => {
    const prepareOnce = vi.fn();
    const db = { prepareOnce } as never;
    expect(rebindMeshcomIdentityOn(db, 'offline-meshcom', 'offline-meshcom')).toEqual({
      changes: 0,
    });
    expect(prepareOnce).not.toHaveBeenCalled();
  });

  it('consolidates every non-toId bucket when fromId is *', () => {
    const all = vi.fn().mockReturnValue([{ id: 'id-a' }, { id: 'id-b' }]);
    const run = vi.fn().mockReturnValue({ changes: 1 });
    const prepareOnce = vi.fn().mockReturnValue({ run, all });
    const db = { prepareOnce } as never;
    expect(rebindMeshcomIdentityOn(db, '*', 'offline-meshcom').changes).toBeGreaterThan(0);
    expect(all).toHaveBeenCalledWith('offline-meshcom', 'offline-meshcom');
    expect(run).toHaveBeenCalledWith({ fromId: 'id-a', toId: 'offline-meshcom' });
    expect(run).toHaveBeenCalledWith({ fromId: 'id-b', toId: 'offline-meshcom' });
  });
});
