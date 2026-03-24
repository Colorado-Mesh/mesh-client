// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const LOG_SERVICE_SOURCE = readFileSync(join(__dirname, 'log-service.ts'), 'utf-8');

describe('log-service disk writes (CodeQL js/http-to-file-access contract)', () => {
  it('passes every appendFile / writeFileSync log payload through sanitizeLogPayloadForDisk', () => {
    expect(LOG_SERVICE_SOURCE).toContain('sanitizeLogPayloadForDisk');
    const appendFileCalls = LOG_SERVICE_SOURCE.match(/\.appendFile\(/g) ?? [];
    const writeFileSyncCalls = LOG_SERVICE_SOURCE.match(/fs\.writeFileSync\(/g) ?? [];
    expect(appendFileCalls.length).toBe(2);
    expect(writeFileSyncCalls.length).toBe(2);
    expect((LOG_SERVICE_SOURCE.match(/sanitizeLogPayloadForDisk\(/g) ?? []).length).toBe(2);
    expect(LOG_SERVICE_SOURCE).toMatch(/appendFile\(\s*p\s*,\s*data\s*,/);
    expect(LOG_SERVICE_SOURCE).toMatch(/appendFile\(\s*getLogFilePath\(\)\s*,\s*diskLine\s*,/);
    expect(LOG_SERVICE_SOURCE).toMatch(/writeFileSync\(\s*getLogFilePath\(\)\s*,\s*diskLine\s*,/);
  });

  it('marks each tainted disk sink with codeql[js/http-to-file-access] (default setup has no sanitizer model)', () => {
    const lines = LOG_SERVICE_SOURCE.split('\n');
    const sinkLinePattern =
      /(?:^|\s)\.appendFile\(\s*[^,]+,\s*(data|diskLine)\s*,|fs\.writeFileSync\(\s*[^,]+,\s*diskLine\s*,/;
    const tag = 'codeql[js/http-to-file-access]';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!sinkLinePattern.test(line)) continue;
      const prev = i > 0 ? lines[i - 1] : '';
      expect(
        line.includes(tag) || prev.includes(tag),
        `missing CodeQL suppression (line above or same line) for sink: ${line.trim()}`,
      ).toBe(true);
    }
  });
});
