import { describe, expect, it, vi } from 'vitest';

import type { TranslationPackManager } from './packManager';
import { TranslationRouter } from './translationRouter';

function setup(installed = true) {
  let enabled = true;
  const packs = {
    verify: vi.fn(() => Promise.resolve(installed)),
    assetPath: (id: string, file: string) => `/${id}/${file}`,
    pack: (id: string) => ({
      source: id.split('-')[0],
      target: id.split('-')[1],
      precision: 'int8shiftAlphaAll',
      assets: [{ file: 'vocab.spm' }],
    }),
  } as unknown as TranslationPackManager;
  const worker = {
    run: vi.fn<
      (job: unknown) => Promise<{
        id: number;
        text: string;
        detection: { language: string; confidence: number };
      }>
    >(() =>
      Promise.resolve({
        id: 1,
        text: 'translated',
        detection: { language: 'fr', confidence: 0.95 },
      }),
    ),
    dispose: vi.fn(),
  };
  const libre = {
    translate: vi.fn(() => Promise.resolve('online')),
    status: () => ({ enabled: true, url: '', hasApiKey: false }),
    dispose: vi.fn(),
  };
  const router = new TranslationRouter({ enabled: () => enabled, packs, worker, libre });
  return {
    router,
    worker,
    libre,
    packs,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}
describe('translation router', () => {
  it.each(['linux', 'darwin', 'win32'])(
    'uses direct and English pivot offline paths on %s',
    async () => {
      const { router, worker, libre } = setup();
      expect(
        await router.translate({
          text: 'Bonjour tout le monde',
          source: 'fr',
          target: 'de',
          mode: 'manual',
        }),
      ).toMatchObject({ ok: true, provider: 'offline' });
      expect(worker.run.mock.calls[0]?.[0]).toMatchObject({
        models: [{ id: 'fr-en' }, { id: 'en-de' }],
      });
      expect(libre.translate).not.toHaveBeenCalled();
      worker.run.mockClear();
      expect(
        await router.translate({
          text: 'English message',
          source: 'en',
          target: 'en',
          mode: 'manual',
        }),
      ).toMatchObject({ ok: true, text: 'English message' });
      expect(worker.run).not.toHaveBeenCalled();
    },
  );
  it('lists missing pivot packs and never automatically falls back online', async () => {
    const { router, packs, libre } = setup();
    vi.mocked(packs.verify).mockImplementation((id) => Promise.resolve(id === 'engine'));
    expect(
      await router.translate({
        text: 'Bonjour tout le monde',
        source: 'fr',
        target: 'de',
        mode: 'manual',
      }),
    ).toEqual({ ok: false, reason: 'missingPack', missingPacks: ['fr-en', 'en-de'] });
    expect(libre.translate).not.toHaveBeenCalled();
    expect(
      await router.translate({
        text: 'Bonjour tout le monde',
        target: 'de',
        mode: 'auto',
        provider: 'libre',
      }),
    ).toEqual({ ok: false, reason: 'disabled' });
    expect(libre.translate).not.toHaveBeenCalled();
    expect(
      await router.translate({
        text: 'Bonjour tout le monde',
        target: 'de',
        mode: 'manual',
        provider: 'libre',
      }),
    ).toMatchObject({ ok: true, provider: 'libre' });
  });
  it('does not launch a worker after disable/re-enable while verifying or publish late results', async () => {
    const { router, packs, worker, setEnabled } = setup();
    let resume!: (value: boolean) => void;
    vi.mocked(packs.verify).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    const detection = router.detect('Bonjour tout le monde');
    setEnabled(false);
    router.dispose();
    setEnabled(true);
    resume(true);
    expect(await detection).toBeNull();
    expect(worker.run).not.toHaveBeenCalled();
    let reply!: (value: {
      id: number;
      text: string;
      detection: { language: string; confidence: number };
    }) => void;
    worker.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const next = router.detect('Bonjour tout le monde');
    await vi.waitFor(() => {
      expect(worker.run).toHaveBeenCalled();
    });
    router.dispose();
    reply({ id: 1, text: '', detection: { language: 'fr', confidence: 1 } });
    expect(await next).toBeNull();
  });
  it('reports engine errors and uncertain detection', async () => {
    const { router, worker } = setup();
    worker.run.mockRejectedValueOnce(new Error('crash'));
    expect(
      await router.translate({
        text: 'Bonjour tout le monde',
        source: 'fr',
        target: 'en',
        mode: 'manual',
      }),
    ).toEqual({ ok: false, reason: 'error' });
    expect(await router.translate({ text: 'Hi', target: 'de', mode: 'manual' })).toEqual({
      ok: false,
      reason: 'uncertain',
    });
  });
});
