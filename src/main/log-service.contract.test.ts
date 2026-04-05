// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const LOG_SERVICE_SOURCE = readFileSync(join(__dirname, 'log-service.ts'), 'utf-8');

describe('log-service disk writes (sanitization contract)', () => {
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
});
