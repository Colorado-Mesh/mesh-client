import { describe, expect, it, vi } from 'vitest';

import {
  pruneMeshcomContactsByCountOn,
  pruneMeshcomMessagesByCountOn,
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
