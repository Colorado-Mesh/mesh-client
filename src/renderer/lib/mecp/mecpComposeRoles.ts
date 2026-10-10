import type { CategoryLetter } from './mecpMessages';

export type MecpComposeMode = 'all' | 'request' | 'response';

const RESPONSE_CATEGORIES: CategoryLetter[] = ['R', 'H', 'P', 'C', 'D'];
const RESPONSE_CODES = new Set(['M14', 'M15', 'T10', 'B02']);

/** UI shortcuts only: both profiles encode the same upstream MECP codes and language packs. */
export function mecpCodeInComposeMode(code: string, mode: MecpComposeMode): boolean {
  if (mode === 'all') return true;
  if (mode === 'response') {
    return (
      RESPONSE_CATEGORIES.some((letter) => code.startsWith(letter)) || RESPONSE_CODES.has(code)
    );
  }
  return !['R', 'H'].includes(code[0]) && code !== 'B02';
}
