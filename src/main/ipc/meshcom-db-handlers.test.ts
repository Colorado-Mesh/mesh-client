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
});
