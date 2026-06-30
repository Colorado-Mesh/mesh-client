import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_HTML = readFileSync(join(__dirname, 'index.html'), 'utf-8');

function readCspContent(): string {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(INDEX_HTML);
  expect(m).toBeTruthy();
  return m![1];
}

describe('index.html CSP', () => {
  it('connect-src does not use over-broad http://*', () => {
    const csp = readCspContent();
    expect(csp).toMatch(/connect-src/i);
    expect(csp).not.toContain('http://*');
  });

  it('img-src allows HTTPS link preview thumbnails', () => {
    const csp = readCspContent();
    expect(csp).toMatch(/img-src[^;]*\bhttps:/);
  });

  it('worker-src allows zip.js blob workers for RNode flasher', () => {
    const csp = readCspContent();
    expect(csp).toMatch(/worker-src[^;]*\bblob:/);
  });
});
