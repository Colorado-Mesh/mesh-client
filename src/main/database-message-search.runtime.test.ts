// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DatabaseModule from './database';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-message-search-'));
vi.mock('electron', () => ({
  app: { getPath: () => profile, getVersion: () => '1.0.0', isPackaged: false },
}));
let runtime: typeof DatabaseModule;

beforeEach(async () => {
  vi.resetModules();
  runtime = await import('./database');
  runtime.initDatabase();
});
afterEach(() => {
  runtime.closeDatabase();
  for (const file of fs.readdirSync(profile))
    fs.rmSync(path.join(profile, file), { recursive: true, force: true });
});
afterAll(() => {
  fs.rmSync(profile, { recursive: true, force: true });
});

const base = 1_700_000_000_000;

/** Sent time, then arrival time (null for a row saved before arrival times were kept). */
const rows: [payload: string, timestamp: number, receivedAt: number | null][] = [
  ['first arrival', base, base],
  ['slow clock arrived last', base - 2 * 3_600_000, base + 120_000],
  ['on time arrived second', base + 60_000, base + 60_000],
  ['saved before receipts', base + 30_000, null],
];

function seedMeshtastic(prefix: string): void {
  const insert = runtime.getDatabase().prepareOnce(
    `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node, received_at)
       VALUES (2, 'Peer', ?, 0, ?, NULL, ?)`,
  );
  for (const [payload, timestamp, receivedAt] of rows) {
    insert.run(`${prefix} ${payload}`, timestamp, receivedAt);
  }
}

function seedMeshcore(prefix: string): void {
  const insert = runtime.getDatabase().prepareOnce(
    `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node, received_at)
       VALUES (2, 'Peer', ?, 0, ?, NULL, ?)`,
  );
  for (const [payload, timestamp, receivedAt] of rows) {
    insert.run(`${prefix} ${payload}`, timestamp, receivedAt);
  }
}

const arrivalOrder = [
  'slow clock arrived last',
  'on time arrived second',
  'saved before receipts',
  'first arrival',
];

describe('message search order', () => {
  it('lists Meshtastic hits newest arrival first and returns the arrival time', () => {
    seedMeshtastic('ping');
    const hits = runtime.searchMessages('ping', 50) as { payload: string; received_at: unknown }[];
    expect(hits.map((h) => h.payload.replace('ping ', ''))).toEqual(arrivalOrder);
    expect(hits[0]?.received_at).toBe(base + 120_000);
    expect(hits[2]?.received_at).toBeNull();
  });

  it('keeps the newest arrivals when the Meshtastic search is limited', () => {
    seedMeshtastic('ping');
    const hits = runtime.searchMessages('ping', 2) as { payload: string }[];
    expect(hits.map((h) => h.payload.replace('ping ', ''))).toEqual(arrivalOrder.slice(0, 2));
  });

  it('orders the Meshtastic text match by arrival when full-text search is not used', () => {
    seedMeshtastic('star *');
    const hits = runtime.searchMessages('*', 2) as { payload: string; received_at: unknown }[];
    expect(hits.map((h) => h.payload.replace('star * ', ''))).toEqual(arrivalOrder.slice(0, 2));
    expect(hits[0]?.received_at).toBe(base + 120_000);
  });

  it('lists MeshCore hits newest arrival first and returns the arrival time', () => {
    seedMeshcore('ping');
    const hits = runtime.searchMeshcoreMessages('ping', 50) as {
      payload: string;
      received_at: unknown;
    }[];
    expect(hits.map((h) => h.payload.replace('ping ', ''))).toEqual(arrivalOrder);
    expect(hits[0]?.received_at).toBe(base + 120_000);
    expect(hits[2]?.received_at).toBeNull();
  });

  it('keeps the newest arrivals when the MeshCore search is limited', () => {
    seedMeshcore('ping');
    const hits = runtime.searchMeshcoreMessages('ping', 2) as { payload: string }[];
    expect(hits.map((h) => h.payload.replace('ping ', ''))).toEqual(arrivalOrder.slice(0, 2));
  });

  it('orders the MeshCore text match by arrival when full-text search is not used', () => {
    seedMeshcore('star *');
    const hits = runtime.searchMeshcoreMessages('*', 2) as {
      payload: string;
      received_at: unknown;
    }[];
    expect(hits.map((h) => h.payload.replace('star * ', ''))).toEqual(arrivalOrder.slice(0, 2));
    expect(hits[0]?.received_at).toBe(base + 120_000);
  });
});
