// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { APP_ABOUT_TAGLINE, APP_PACKAGE_DESCRIPTION } from './appTagline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function isAsciiOnly(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) {
      return false;
    }
  }
  return true;
}

describe('appTagline', () => {
  it('exports ASCII-only taglines for packaging and About metadata', () => {
    expect(isAsciiOnly(APP_PACKAGE_DESCRIPTION)).toBe(true);
    expect(isAsciiOnly(APP_ABOUT_TAGLINE)).toBe(true);
    expect(APP_ABOUT_TAGLINE).toContain('Reticulum');
    expect(APP_ABOUT_TAGLINE).toContain('multi-language support');
    expect(APP_PACKAGE_DESCRIPTION).not.toContain('multi-language support');
  });

  it('matches package.json description', () => {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')) as {
      description: string;
    };
    expect(pkg.description).toBe(APP_PACKAGE_DESCRIPTION);
  });
});
