import fs from 'node:fs/promises';
import path from 'node:path';

import { AI_LOCAL_MODELS } from './modelManifest';
import type { AiModelPackManager } from './modelPackManager';

export function createAiModelProtocol(deps: {
  enabled: () => boolean;
  directory: () => string;
  packs: AiModelPackManager;
  fetchFile: (url: string) => Promise<Response>;
}) {
  return async (request: Request): Promise<Response> => {
    if (!deps.enabled()) return new Response(null, { status: 403 });
    try {
      const url = new URL(request.url);
      const model = AI_LOCAL_MODELS.find((m) => m.id === url.hostname);
      const file = decodeURIComponent(url.pathname.slice(1));
      if (
        !model ||
        !model.assets.some((a) => a.file === file) ||
        !(await deps.packs.verify(model.id))
      )
        return new Response(null, { status: 404 });
      const root = await fs.realpath(deps.directory());
      const target = await fs.realpath(deps.packs.assetPath(model.id, file));
      if (!target.startsWith(root + path.sep)) return new Response(null, { status: 403 });
      const { pathToFileURL } = await import('node:url');
      const response = await deps.fetchFile(pathToFileURL(target).href);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'no-store');
      // Explicit CORP so COEP-isolated renderers can fetch model bytes over mesh-ai:.
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(response.body, { status: response.status, headers });
    } catch {
      // catch-no-log-ok unreadable models are unavailable; never expose filesystem paths
      return new Response(null, { status: 404 });
    }
  };
}
