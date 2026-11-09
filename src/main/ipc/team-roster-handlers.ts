/**
 * Team Contacts / Team Roster IPC.
 * Production ships this as sibling `team-roster-handlers.js` so it stays out of measured index.js.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { isMeshProtocol, type MeshProtocol } from '../../shared/meshProtocol';
import {
  assertTeamProtocol,
  isValidTeamUnitId,
  normalizeTeamDurableKey,
  TEAM_CALLSIGN_MAX,
  TEAM_COLOR_MAX,
  TEAM_LONG_NAME_MAX,
  TEAM_ROLE_MAX,
  TEAM_UNIT_ID_MAX,
  TEAM_UNIT_ID_MIN,
  type TeamMember,
  type TeamMemberInput,
  type TeamMemberLink,
  type TeamMemberLinkInput,
} from '../../shared/teamRosterTypes';
import type { NodeSqliteDB } from '../db-compat';

export interface TeamRosterIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
  getDatabase: () => NodeSqliteDB;
}

/** Idempotent DDL kept out of measured main `index.js` (sibling bundle). */
export function ensureTeamRosterTables(db: NodeSqliteDB): void {
  db.execScript(`
    CREATE TABLE IF NOT EXISTS team_members (
      unit_id INTEGER PRIMARY KEY CHECK (unit_id BETWEEN 1 AND 65535),
      callsign TEXT NOT NULL,
      role TEXT,
      color TEXT,
      is_self INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_member_links (
      unit_id INTEGER NOT NULL REFERENCES team_members(unit_id) ON DELETE CASCADE,
      protocol TEXT NOT NULL CHECK (protocol IN ('meshtastic','meshcore','reticulum')),
      durable_key TEXT NOT NULL,
      node_id INTEGER,
      long_name TEXT,
      identity_id TEXT,
      PRIMARY KEY (unit_id, protocol),
      UNIQUE (protocol, durable_key)
    );
  `);
}

interface MemberDbRow {
  unit_id: number;
  callsign: string;
  role: string | null;
  color: string | null;
  is_self: number;
  created_at: number;
  updated_at: number;
}

interface LinkDbRow {
  unit_id: number;
  protocol: string;
  durable_key: string;
  node_id: number | null;
  long_name: string | null;
  identity_id: string | null;
}

function fail(msg: string): never {
  throw new TypeError(msg);
}

function assertUnitId(value: unknown): number {
  if (!isValidTeamUnitId(value)) {
    fail(`unitId must be ${TEAM_UNIT_ID_MIN}–${TEAM_UNIT_ID_MAX}`);
  }
  return value;
}

function clampOptionalString(
  value: unknown,
  max: number,
  field: string,
  allowNull: boolean,
): string | null {
  if (value == null) {
    if (allowNull) return null;
    fail(field);
  }
  if (typeof value !== 'string') fail(field);
  const trimmed = value.trim();
  if (!allowNull && !trimmed) fail(field);
  if (trimmed.length > max) fail(`${field} too long`);
  return trimmed.length === 0 ? null : trimmed;
}

function linkFromDb(row: LinkDbRow): TeamMemberLink | null {
  if (!isMeshProtocol(row.protocol)) return null;
  return {
    protocol: row.protocol,
    durableKey: row.durable_key,
    nodeId: row.node_id,
    longName: row.long_name,
    identityId: row.identity_id,
  };
}

function memberFromDb(row: MemberDbRow, links: TeamMemberLink[]): TeamMember {
  return {
    unitId: row.unit_id,
    callsign: row.callsign,
    role: row.role,
    color: row.color,
    isSelf: row.is_self === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links,
  };
}

function listLinksForUnits(db: NodeSqliteDB, unitIds: number[]): Map<number, TeamMemberLink[]> {
  const byUnit = new Map<number, TeamMemberLink[]>();
  for (const id of unitIds) byUnit.set(id, []);
  if (unitIds.length === 0) return byUnit;
  const placeholders = unitIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT unit_id, protocol, durable_key, node_id, long_name, identity_id
       FROM team_member_links WHERE unit_id IN (${placeholders})
       ORDER BY protocol ASC`,
    )
    .all(...unitIds) as LinkDbRow[];
  for (const row of rows) {
    const link = linkFromDb(row);
    if (!link) continue;
    const list = byUnit.get(row.unit_id);
    if (list) list.push(link);
  }
  return byUnit;
}

function listMembers(db: NodeSqliteDB): TeamMember[] {
  const rows = db
    .prepare(
      `SELECT unit_id, callsign, role, color, is_self, created_at, updated_at
       FROM team_members ORDER BY unit_id ASC`,
    )
    .all() as MemberDbRow[];
  const linksByUnit = listLinksForUnits(
    db,
    rows.map((r) => r.unit_id),
  );
  return rows.map((row) => memberFromDb(row, linksByUnit.get(row.unit_id) ?? []));
}

function readMember(db: NodeSqliteDB, unitId: number): TeamMember | null {
  const row = db
    .prepare(
      `SELECT unit_id, callsign, role, color, is_self, created_at, updated_at
       FROM team_members WHERE unit_id = ?`,
    )
    .get(unitId) as MemberDbRow | undefined;
  if (!row) return null;
  const links = listLinksForUnits(db, [unitId]).get(unitId) ?? [];
  return memberFromDb(row, links);
}

function allocateUnitId(db: NodeSqliteDB): number {
  const used = new Set(
    (db.prepare('SELECT unit_id FROM team_members').all() as { unit_id: number }[]).map(
      (r) => r.unit_id,
    ),
  );
  for (let id = TEAM_UNIT_ID_MIN; id <= TEAM_UNIT_ID_MAX; id++) {
    if (!used.has(id)) return id;
  }
  fail('no free unitId');
}

function upsertMember(db: NodeSqliteDB, input: TeamMemberInput): TeamMember {
  const unitId = assertUnitId(input.unitId);
  const callsign = clampOptionalString(input.callsign, TEAM_CALLSIGN_MAX, 'callsign', false)!;
  const role =
    input.role === undefined
      ? undefined
      : clampOptionalString(input.role, TEAM_ROLE_MAX, 'role', true);
  const color =
    input.color === undefined
      ? undefined
      : clampOptionalString(input.color, TEAM_COLOR_MAX, 'color', true);
  const isSelf = input.isSelf === true;
  const now = Date.now();

  const existing = db
    .prepare(
      'SELECT unit_id, callsign, role, color, is_self, created_at, updated_at FROM team_members WHERE unit_id = ?',
    )
    .get(unitId) as MemberDbRow | undefined;

  db.transaction(() => {
    if (isSelf) {
      db.prepareOnce('UPDATE team_members SET is_self = 0 WHERE is_self = 1 AND unit_id != ?').run(
        unitId,
      );
    }
    if (existing) {
      const nextRole = role === undefined ? existing.role : role;
      const nextColor = color === undefined ? existing.color : color;
      const nextSelf = input.isSelf === undefined ? existing.is_self : isSelf ? 1 : 0;
      db.prepareOnce(
        `UPDATE team_members
         SET callsign = ?, role = ?, color = ?, is_self = ?, updated_at = ?
         WHERE unit_id = ?`,
      ).run(callsign, nextRole, nextColor, nextSelf, now, unitId);
    } else {
      db.prepareOnce(
        `INSERT INTO team_members (unit_id, callsign, role, color, is_self, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(unitId, callsign, role ?? null, color ?? null, isSelf ? 1 : 0, now, now);
    }
  })();

  const member = readMember(db, unitId);
  if (!member) fail('upsert failed');
  return member;
}

function setLink(db: NodeSqliteDB, input: TeamMemberLinkInput): TeamMember {
  const unitId = assertUnitId(input.unitId);
  const protocol = assertTeamProtocol(input.protocol);
  if (typeof input.durableKey !== 'string') fail('durableKey');
  const durableKey = normalizeTeamDurableKey(protocol, input.durableKey);
  if (!durableKey) fail('durableKey');
  const longName =
    input.longName === undefined
      ? null
      : clampOptionalString(input.longName, TEAM_LONG_NAME_MAX, 'longName', true);
  const identityId =
    input.identityId == null
      ? null
      : clampOptionalString(input.identityId, TEAM_CALLSIGN_MAX * 4, 'identityId', true);
  let nodeId: number | null = null;
  if (input.nodeId != null) {
    if (!Number.isInteger(input.nodeId) || input.nodeId < 0) fail('nodeId');
    nodeId = input.nodeId;
  }

  const member = readMember(db, unitId);
  if (!member) fail('unitId not found');

  const now = Date.now();
  try {
    db.transaction(() => {
      db.prepareOnce(
        `INSERT INTO team_member_links (unit_id, protocol, durable_key, node_id, long_name, identity_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(unit_id, protocol) DO UPDATE SET
           durable_key = excluded.durable_key,
           node_id = excluded.node_id,
           long_name = excluded.long_name,
           identity_id = excluded.identity_id`,
      ).run(unitId, protocol, durableKey, nodeId, longName, identityId);
      db.prepareOnce('UPDATE team_members SET updated_at = ? WHERE unit_id = ?').run(now, unitId);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|constraint/i.test(message)) {
      fail('durableKey already linked to another member');
    }
    throw error;
  }

  const updated = readMember(db, unitId);
  if (!updated) fail('setLink failed');
  return updated;
}

function removeLink(db: NodeSqliteDB, unitIdRaw: unknown, protocolRaw: unknown): TeamMember {
  const unitId = assertUnitId(unitIdRaw);
  const protocol = assertTeamProtocol(protocolRaw);
  if (!readMember(db, unitId)) fail('unitId not found');
  const now = Date.now();
  db.transaction(() => {
    db.prepareOnce('DELETE FROM team_member_links WHERE unit_id = ? AND protocol = ?').run(
      unitId,
      protocol,
    );
    db.prepareOnce('UPDATE team_members SET updated_at = ? WHERE unit_id = ?').run(now, unitId);
  })();
  const updated = readMember(db, unitId);
  if (!updated) fail('removeLink failed');
  return updated;
}

/** Register team-roster IPC (called from main after sibling load). */
export function registerTeamRosterIpcHandlers(deps: TeamRosterIpcDeps): void {
  const { ipcMain, assertIpcSender, getDatabase } = deps;
  ensureTeamRosterTables(getDatabase());

  ipcMain.handle('db:listTeamMembers', (event) => {
    assertIpcSender(event, 'db:listTeamMembers');
    return listMembers(getDatabase());
  });

  ipcMain.handle('db:allocateTeamUnitId', (event) => {
    assertIpcSender(event, 'db:allocateTeamUnitId');
    return allocateUnitId(getDatabase());
  });

  ipcMain.handle('db:upsertTeamMember', (event, raw: unknown) => {
    assertIpcSender(event, 'db:upsertTeamMember');
    if (!raw || typeof raw !== 'object') fail('input');
    return upsertMember(getDatabase(), raw as TeamMemberInput);
  });

  ipcMain.handle('db:deleteTeamMember', (event, unitIdRaw: unknown) => {
    assertIpcSender(event, 'db:deleteTeamMember');
    const unitId = assertUnitId(unitIdRaw);
    getDatabase().prepareOnce('DELETE FROM team_members WHERE unit_id = ?').run(unitId);
  });

  ipcMain.handle('db:setTeamMemberLink', (event, raw: unknown) => {
    assertIpcSender(event, 'db:setTeamMemberLink');
    if (!raw || typeof raw !== 'object') fail('input');
    return setLink(getDatabase(), raw as TeamMemberLinkInput);
  });

  ipcMain.handle('db:removeTeamMemberLink', (event, unitIdRaw: unknown, protocolRaw: unknown) => {
    assertIpcSender(event, 'db:removeTeamMemberLink');
    return removeLink(getDatabase(), unitIdRaw, protocolRaw);
  });

  ipcMain.handle('db:clearTeamMembers', (event) => {
    assertIpcSender(event, 'db:clearTeamMembers');
    const db = getDatabase();
    db.transaction(() => {
      db.prepareOnce('DELETE FROM team_member_links').run();
      db.prepareOnce('DELETE FROM team_members').run();
    })();
  });
}

/** Test helpers */
export const teamRosterHandlerTestUtils = {
  listMembers,
  allocateUnitId,
  upsertMember,
  setLink,
  removeLink,
  assertUnitId,
  normalizeTeamDurableKey,
};

export type { MeshProtocol };
