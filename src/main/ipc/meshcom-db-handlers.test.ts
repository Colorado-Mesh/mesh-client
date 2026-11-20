import { describe, expect, it } from 'vitest';

import { validateSaveMeshcomContact, validateSaveMeshcomMessage } from './meshcom-db-handlers';

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
