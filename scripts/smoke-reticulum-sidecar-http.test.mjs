// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { smokeReticulumSidecarHttp } from './smoke-reticulum-sidecar-http.mjs';

describe('smokeReticulumSidecarHttp', () => {
  it('fails fast when the binary path does not exist', async () => {
    await expect(smokeReticulumSidecarHttp('/nonexistent/mesh-client-reticulum')).rejects.toThrow(
      /sidecar binary not found/,
    );
  });
});
