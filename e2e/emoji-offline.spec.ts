import { expect, test } from '@playwright/test';

import { launchApp, type LaunchedApp, openPanel, teardownApp } from './electronApp';

/**
 * The Linux emoji picker (emoji-picker-element) must work with no internet: its data comes from
 * the vendored file through the renderer's fetch shim, never from cdn.jsdelivr.net.
 */
test.describe('emoji picker offline', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });

  test('loads emoji from bundled data with the CDN blocked', async () => {
    launched = await launchApp();
    const { page } = launched;
    const cdnRequests: string[] = [];
    await page.route('**/*jsdelivr*/**', async (route) => {
      cdnRequests.push(route.request().url());
      await route.abort();
    });

    const count = await page.evaluate(async () => {
      const res = await fetch('https://emoji-data.mesh-client.invalid/en/data.json');
      const data = (await res.json()) as unknown[];
      return data.length;
    });
    expect(count).toBeGreaterThan(1500);

    // The chat module registers <emoji-picker>.
    await openPanel(page, 'Chat');
    await page.waitForFunction(() => customElements.get('emoji-picker') !== undefined);
    await page.evaluate(() => {
      const picker = document.createElement('emoji-picker');
      picker.setAttribute('data-source', 'https://emoji-data.mesh-client.invalid/en/data.json');
      picker.id = 'e2e-emoji-picker';
      document.body.appendChild(picker);
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document
                .getElementById('e2e-emoji-picker')
                ?.shadowRoot?.querySelectorAll('button.emoji').length ?? 0,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(10);
    expect(cdnRequests).toEqual([]);
    expect(launched.crashed).toBe(false);
  });
});
