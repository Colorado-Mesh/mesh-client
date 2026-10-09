import type { TakMatchOp, TakUnitFilter } from './tak-types';

export interface TakUnitFilterMatch {
  /** Index into the filter list. */
  index: number;
  filter: TakUnitFilter;
  /** Callsign to show, with the matched prefix or suffix removed when the filter strips. */
  callsign: string;
}

function matches(op: TakMatchOp, text: string, pattern: string): boolean {
  switch (op) {
    case 'equals':
      return text === pattern;
    case 'startsWith':
      return text.startsWith(pattern);
    case 'endsWith':
      return text.endsWith(pattern);
    case 'contains':
      return text.includes(pattern);
  }
}

function strip(filter: TakUnitFilter, callsign: string, patternLength: number): string {
  let out = callsign;
  if (filter.op === 'startsWith') out = callsign.slice(patternLength);
  else if (filter.op === 'endsWith') out = callsign.slice(0, callsign.length - patternLength);
  out = out.replace(/^[\s\-_:|]+|[\s\-_:|]+$/g, '');
  return out || callsign;
}

/**
 * First enabled filter whose pattern matches the callsign, then the long name, compared
 * case-insensitively. A strip only applies when the callsign itself matched.
 */
export function matchTakUnitFilter(
  filters: readonly TakUnitFilter[],
  callsign: string,
  longName: string,
): TakUnitFilterMatch | null {
  const cs = callsign.toLowerCase();
  const ln = longName.toLowerCase();
  for (const [index, filter] of filters.entries()) {
    if (!filter.enabled) continue;
    for (const raw of filter.patterns) {
      const pattern = raw.toLowerCase();
      if (!pattern) continue;
      if (matches(filter.op, cs, pattern)) {
        const shown = filter.stripMatch ? strip(filter, callsign, pattern.length) : callsign;
        return { index, filter, callsign: shown };
      }
      if (ln && matches(filter.op, ln, pattern)) return { index, filter, callsign };
    }
  }
  return null;
}
