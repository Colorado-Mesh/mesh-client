import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  localizeTakRemoteUserError,
  matchTakRemoteUserError,
  TAK_REMOTE_USER_ERROR_SPECS,
  takRemoteWireSnippets,
} from './takRemoteUserError';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const MAIN_SOURCES = [
  'src/main/tak/remote-client.ts',
  'src/main/tak/remote-credentials.ts',
  'src/main/tak/enrollment.ts',
  'src/main/ipc/tak-handlers.ts',
];

function fillWire(template: string): { text: string; vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  const text = template.replace(/\{\{(\w+)\}\}/g, (_part, name: string) => {
    const sample = name === 'max' ? '2' : name === 'reason' ? 'tlsv1 alert unknown ca' : 'user.p12';
    vars[name] = sample;
    return sample;
  });
  return { text, vars };
}

describe('matchTakRemoteUserError', () => {
  it('maps every authored wire sentence, including placeholders', () => {
    for (const spec of TAK_REMOTE_USER_ERROR_SPECS) {
      for (const template of spec.wire) {
        const { text, vars } = fillWire(template);
        expect(matchTakRemoteUserError(text)).toEqual({ key: spec.key, vars });
      }
    }
  });

  it('leaves OS and OpenSSL leftovers unchanged', () => {
    expect(matchTakRemoteUserError('socket hang up')).toBeNull();
    expect(matchTakRemoteUserError('ECONNREFUSED')).toBeNull();
    expect(
      localizeTakRemoteUserError('socket hang up', () => {
        throw new Error('should not translate');
      }),
    ).toBe('socket hang up');
  });

  it('falls back to the wire text when the key is missing', () => {
    expect(localizeTakRemoteUserError('Server unreachable', (key) => key)).toBe(
      'Server unreachable',
    );
  });
});

describe('TAK remote error catalog', () => {
  it('matches English locale strings', () => {
    const en = JSON.parse(
      readFileSync(join(ROOT, 'src/renderer/locales/en/translation.json'), 'utf8'),
    ) as {
      takServerPanel: { remoteErrors: Record<string, string> };
    };
    for (const spec of TAK_REMOTE_USER_ERROR_SPECS) {
      const leaf = spec.key.slice('takServerPanel.remoteErrors.'.length);
      expect(en.takServerPanel.remoteErrors[leaf]).toBe(spec.en);
    }
  });

  it('still covers the sentences main shows to users', () => {
    const blob = MAIN_SOURCES.map((path) => readFileSync(join(ROOT, path), 'utf8')).join('\n');
    for (const spec of TAK_REMOTE_USER_ERROR_SPECS) {
      for (const template of spec.wire) {
        for (const snippet of takRemoteWireSnippets(template)) {
          expect(blob, snippet).toContain(snippet);
        }
      }
    }
  });
});
