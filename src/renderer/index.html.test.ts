import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf-8');

describe('index.html CSP', () => {
  it('connect-src does not use over-broad http://*', () => {
    const m = INDEX_HTML.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
    expect(m).toBeTruthy();
    const csp = m![1];
    expect(csp).toMatch(/connect-src/i);
    expect(csp).not.toContain('http://*');
  });
});
