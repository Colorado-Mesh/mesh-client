// @vitest-environment jsdom
/**
 * Source contract test: dual-Noble BLE startup must initialize from a `useLayoutEffect` in
 * App.tsx, not a plain `useEffect`. Child ConnectionPanel auto-connect effects run after parent
 * layout effects — initializing from `useEffect` races and can leave the dual-radio primary
 * unset before ConnectionPanel's own auto-connect effect fires (see AGENTS.md "Dual-radio Noble
 * BLE startup" table, "Init timing" row).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_SOURCE = readFileSync(join(__dirname, 'App.tsx'), 'utf-8');

describe('App dual-Noble BLE startup init timing (regression)', () => {
  it('calls initNobleBleDualRadioStartup from a useLayoutEffect with an empty dep array', () => {
    expect(APP_SOURCE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*initNobleBleDualRadioStartup\(\);\s*\}, \[\]\);/,
    );
  });

  it('does not call initNobleBleDualRadioStartup from a plain useEffect', () => {
    expect(APP_SOURCE).not.toMatch(
      /useEffect\(\(\) => \{\s*initNobleBleDualRadioStartup\(\);\s*\}, \[\]\);/,
    );
  });

  it('imports initNobleBleDualRadioStartup from the dual-Noble coordinator module', () => {
    expect(APP_SOURCE).toContain(
      "import { initNobleBleDualRadioStartup } from './lib/meshcoreDualNobleBleInit';",
    );
  });
});
