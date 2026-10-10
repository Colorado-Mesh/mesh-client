import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  DEFAULT_TAK_STYLE_SETTINGS,
  isTakIconsetPath,
  TAK_MATCH_OPS,
  TAK_TEAM_COLORS,
  TAK_TEAM_ROLES,
  TAK_UNIT_FILTER_PATTERN_MAX_LEN,
  TAK_UNIT_FILTER_PATTERNS_MAX,
  TAK_UNIT_FILTERS_MAX,
  type TakMatchOp,
  type TakStyleSettings,
  type TakUnitFilter,
  type TakUnitStyle,
} from '../../shared/tak-types';
import { sanitizeLogMessage } from '../log-service';

const COT_ROOT_RE = /^[a-z]$/;
const COT_SEGMENT_RE = /^[A-Za-z0-9]{1,8}$/;

/** CoT type atom: lowercase root then 1-10 dash-separated segments, e.g. `a-f-G-U-C`. */
function isCotType(value: string): boolean {
  const [root, ...segments] = value.split('-');
  return (
    COT_ROOT_RE.test(root ?? '') &&
    segments.length >= 1 &&
    segments.length <= 10 &&
    segments.every((s) => COT_SEGMENT_RE.test(s))
  );
}
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'tak-style-settings.json');
}

function fail(message: string): never {
  throw new Error(`tak:setStyleSettings: ${message}`);
}

function parseStyle(raw: unknown): TakUnitStyle {
  if (!raw || typeof raw !== 'object') fail('style must be an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.cotType !== 'string' || !isCotType(s.cotType)) {
    fail('cotType must be a CoT type atom');
  }
  const style: TakUnitStyle = { cotType: s.cotType };
  if (s.group !== undefined) {
    if (typeof s.group !== 'string' || !(TAK_TEAM_COLORS as readonly string[]).includes(s.group)) {
      fail('group must be an ATAK team color');
    }
    style.group = s.group;
  }
  if (s.role !== undefined) {
    if (typeof s.role !== 'string' || !(TAK_TEAM_ROLES as readonly string[]).includes(s.role)) {
      fail('role must be an ATAK team role');
    }
    style.role = s.role;
  }
  if (s.color !== undefined) {
    if (typeof s.color !== 'string' || !HEX_COLOR_RE.test(s.color)) {
      fail('color must be #RRGGBB');
    }
    style.color = s.color;
  }
  return style;
}

function parseFilter(raw: unknown): TakUnitFilter {
  if (!raw || typeof raw !== 'object') fail('filter must be an object');
  const f = raw as Record<string, unknown>;
  if (typeof f.enabled !== 'boolean') fail('enabled must be boolean');
  if (typeof f.stripMatch !== 'boolean') fail('stripMatch must be boolean');
  if (typeof f.op !== 'string' || !TAK_MATCH_OPS.includes(f.op as TakMatchOp)) {
    fail('op is not a known match operator');
  }
  if (!Array.isArray(f.patterns) || f.patterns.length > TAK_UNIT_FILTER_PATTERNS_MAX) {
    fail(`patterns must be an array of at most ${TAK_UNIT_FILTER_PATTERNS_MAX}`);
  }
  const patterns: string[] = [];
  for (const p of f.patterns as unknown[]) {
    if (typeof p !== 'string' || p.length > TAK_UNIT_FILTER_PATTERN_MAX_LEN) {
      fail(`patterns must be strings of at most ${TAK_UNIT_FILTER_PATTERN_MAX_LEN} characters`);
    }
    const trimmed = p.trim();
    if (trimmed) patterns.push(trimmed);
  }
  return {
    enabled: f.enabled,
    op: f.op as TakMatchOp,
    patterns,
    stripMatch: f.stripMatch,
    style: parseStyle(f.style),
  };
}

/** Validate untrusted settings, keeping only known fields. Throws on anything malformed. */
export function parseTakStyleSettings(raw: unknown): TakStyleSettings {
  if (!raw || typeof raw !== 'object') fail('settings must be an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.sendUnmatched !== 'boolean') fail('sendUnmatched must be boolean');
  if (!Array.isArray(s.filters) || s.filters.length > TAK_UNIT_FILTERS_MAX) {
    fail(`filters must be an array of at most ${TAK_UNIT_FILTERS_MAX}`);
  }
  const settings: TakStyleSettings = {
    filters: (s.filters as unknown[]).map(parseFilter),
    sendUnmatched: s.sendUnmatched,
  };
  if (s.relayIconsetPath !== undefined) {
    if (typeof s.relayIconsetPath !== 'string') fail('relayIconsetPath must be a string');
    const iconPath = s.relayIconsetPath.trim();
    if (iconPath) {
      if (!isTakIconsetPath(iconPath)) {
        fail('relayIconsetPath must be <icon set uid>/<group>/<file>');
      }
      settings.relayIconsetPath = iconPath;
    }
  }
  return settings;
}

/**
 * Saved style settings, or the defaults when none were saved. A corrupt file also yields the
 * defaults (logged) so relaying never stops over a styling preference.
 */
export function loadTakStyleSettings(): TakStyleSettings {
  const file = settingsPath();
  try {
    if (!fs.existsSync(file)) return DEFAULT_TAK_STYLE_SETTINGS;
    return parseTakStyleSettings(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (err) {
    console.warn(
      '[TakStyle] saved style settings unreadable, using defaults:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    return DEFAULT_TAK_STYLE_SETTINGS;
  }
}

/** Persist through a temp file so a crash mid-write cannot leave a truncated settings file. */
export function saveTakStyleSettings(settings: TakStyleSettings): void {
  const file = settingsPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file);
}
