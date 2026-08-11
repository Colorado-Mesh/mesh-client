// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const ENTRYPOINT = readFileSync(join(ROOT, 'docker/entrypoint.sh'), 'utf-8');
const DOCKERFILE = readFileSync(join(ROOT, 'Dockerfile'), 'utf-8');

describe('docker headless entrypoint contracts', () => {
  it('uses set -euo pipefail and waits for the Xvfb socket', () => {
    expect(ENTRYPOINT).toContain('set -euo pipefail');
    expect(ENTRYPOINT).toContain('/tmp/.X11-unix/X99');
    expect(ENTRYPOINT).toContain('MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE');
    expect(ENTRYPOINT).toContain('screen_w=1280');
    expect(ENTRYPOINT).toContain('screen_h=800');
    expect(ENTRYPOINT).toContain('--no-sandbox');
    expect(ENTRYPOINT).toContain('--disable-dev-shm-usage');
    expect(ENTRYPOINT).toContain('--disable-gpu');
    // Keep Electron as a child so EXIT can tear down Xvfb (no bare exec of the app).
    expect(ENTRYPOINT).not.toMatch(/^\s*exec\s+"\$MESH_CLIENT_BIN"/m);
    expect(ENTRYPOINT).toContain('trap cleanup EXIT INT TERM');
  });

  it('Dockerfile exposes port 8000 and points ENTRYPOINT at the script', () => {
    expect(DOCKERFILE).toContain('EXPOSE 8000');
    expect(DOCKERFILE).toContain('ENTRYPOINT ["/usr/local/bin/mesh-client-entrypoint.sh"]');
    expect(DOCKERFILE).toContain('MESH_CLIENT_REMOTE_HOST=0.0.0.0');
    expect(DOCKERFILE).toContain('MESH_CLIENT_REMOTE_TOKEN');
  });
});
