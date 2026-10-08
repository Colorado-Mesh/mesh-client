#!/usr/bin/env node
// Manual network smoke. Builds our static worker and downloads verified data into a unique temp dir.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'mesh-translation-smoke-'));
let host;
try {
  await build({
    absWorkingDir: root,
    stdin: {
      contents:
        "export { TranslationPackManager } from './src/main/translation/packManager'; export { BergamotWorker } from './src/main/translation/bergamotWorker'; export { TranslationRouter } from './src/main/translation/translationRouter';",
      resolveDir: root,
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(temporary, 'library.cjs'),
  });
  await build({
    absWorkingDir: root,
    entryPoints: ['src/main/translation/bergamotWorkerEntry.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(temporary, 'translation-worker.js'),
  });
  const { TranslationPackManager, BergamotWorker, TranslationRouter } = createRequire(
    import.meta.url,
  )(path.join(temporary, 'library.cjs'));
  const manager = new TranslationPackManager({
    directory: () => path.join(temporary, 'translation'),
    enabled: () => true,
    fetch,
    onProgress: () => {},
  });
  host = new BergamotWorker();
  const router = new TranslationRouter({
    enabled: () => true,
    packs: manager,
    worker: host,
    libre: {
      status: () => ({ enabled: false }),
      dispose: () => {},
      translate: () => {
        throw new Error('Online translation forbidden in smoke');
      },
    },
  });
  const extra = process.argv.includes('--extended');
  const packs = ['engine', 'fr-en', 'en-de', ...(extra ? ['id-en', 'en-ja'] : [])];
  for (const id of packs) {
    const result = await manager.install(id);
    if (!result.ok) throw new Error(`Install failed: ${id}`);
    console.info(`Verified ${id}`);
  }
  const text =
    'Bonjour ! Comment allez-vous aujourd’hui ? Je voudrais traduire ce message en allemand.';
  const detection = await router.detect(text);
  if (detection?.language !== 'fr' || detection.confidence < 0.7)
    throw new Error('Language detection failed');
  const result = await router.translate({ text, target: 'de', mode: 'manual' });
  if (!result.ok || !result.text.trim() || result.text === text)
    throw new Error('English pivot failed: ' + JSON.stringify(result));
  console.info(JSON.stringify({ node: process.versions.node, detection, result }, null, 2));
  if (extra) {
    const extended = await router.translate({
      text: 'Selamat pagi, bagaimana kabar Anda hari ini? Saya ingin menerjemahkan pesan ini.',
      source: 'id',
      target: 'ja',
      mode: 'manual',
    });
    if (!extended.ok || !/[\p{Script=Hiragana}\p{Script=Han}]/u.test(extended.text))
      throw new Error('Tiny/separate-vocabulary inference failed');
    console.info(JSON.stringify(extended));
  }
} finally {
  host?.dispose();
  await rm(temporary, { recursive: true, force: true });
}
