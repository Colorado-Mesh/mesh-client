import type { TakFilterSubject, TakMatchOp, TakUnitFilter } from './tak-types';

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

/** The filter's node kind and protocol conditions both hold; an unset condition always does. */
function subjectMatches(filter: TakUnitFilter, subject: TakFilterSubject): boolean {
  if (filter.nodeKind !== undefined && filter.nodeKind !== subject.kind) return false;
  return filter.protocol === undefined || filter.protocol === subject.protocol;
}

/**
 * First enabled filter the node meets every condition of. Name patterns are compared
 * case-insensitively against the callsign, then the long name, and a strip only applies when
 * the callsign itself matched. A filter with no patterns matches on node kind or protocol
 * alone, and a filter with no conditions at all matches nothing.
 */
export function matchTakUnitFilter(
  filters: readonly TakUnitFilter[],
  callsign: string,
  longName: string,
  subject: TakFilterSubject,
): TakUnitFilterMatch | null {
  const cs = callsign.toLowerCase();
  const ln = longName.toLowerCase();
  for (const [index, filter] of filters.entries()) {
    if (!filter.enabled || !subjectMatches(filter, subject)) continue;
    const patterns = filter.patterns.filter((p) => p.length > 0);
    if (patterns.length === 0) {
      if (filter.nodeKind === undefined && filter.protocol === undefined) continue;
      return { index, filter, callsign };
    }
    for (const raw of patterns) {
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
