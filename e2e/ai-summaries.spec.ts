import { createServer } from 'node:http';

import { expect, test } from '@playwright/test';

import type { ElectronAPI } from '../src/shared/electron-api.types';
import { launchApp, type LaunchedApp, openAppTab, teardownApp } from './electronApp';

async function seed(launched: LaunchedApp) {
  await launched.page.evaluate(async () => {
    const now = Date.now();
    for (const [sender, payload] of [
      [1, 'Alice will bring batteries at 18:00.'],
      [2, 'Bob will meet Alice at the north trailhead.'],
      [1, 'Please confirm who has the spare radio.'],
    ] as const)
      await (window as unknown as { electronAPI: ElectronAPI }).electronAPI.db.saveMessage({
        sender_id: sender,
        sender_name: sender === 1 ? 'Alice' : 'Bob',
        payload,
        channel: 0,
        timestamp: now,
      });
    await (window as unknown as { electronAPI: ElectronAPI }).electronAPI.db.saveMessage({
      sender_id: 99,
      sender_name: 'Other peer',
      payload: 'PRIVATE UNRELATED DM',
      channel: 0,
      timestamp: now,
      to: 100,
    });
  });
}
async function openAiSettings(launched: LaunchedApp) {
  await openAppTab(launched.page);
  const section = launched.page.locator('[data-setting-anchor="app.aiProvider"]');
  await section.locator('summary').click();
  await section.getByRole('checkbox', { name: 'Enable AI summaries', exact: true }).check();
  await expect(section.getByRole('combobox', { name: 'Engine', exact: true })).toBeVisible();
  return section;
}
async function openChat(launched: LaunchedApp) {
  await launched.page.getByRole('button', { name: 'Chat', exact: true }).first().click();
  await expect(launched.page.getByRole('button', { name: 'Catch up', exact: true })).toBeVisible();
}

test.describe('AI conversation summaries', () => {
  let launched: LaunchedApp;
  test.afterEach(async () => {
    if (launched) await teardownApp(launched);
  });
  test('stays off by default, streams the selected channel and clears on disable', async () => {
    const bodies: string[] = [];
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"data":[{"id":"synthetic-model"}]}');
        return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        bodies.push(body);
        res.setHeader('Content-Type', 'text/event-stream');
        res.end(
          'data: {"choices":[{"delta":{"content":"Alice brings batteries; Bob meets at the north trailhead. Confirm the spare radio."}}]}\n\ndata: [DONE]\n\n',
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      launched = await launchApp();
      await expect(
        launched.page.getByRole('button', { name: 'Catch up', exact: true }),
      ).toHaveCount(0);
      const initial = await launched.page.evaluate(() =>
        (window as unknown as { electronAPI: ElectronAPI }).electronAPI.ai.getStatus(),
      );
      expect(initial.enabled).toBe(false);
      await seed(launched);
      await openAppTab(launched.page);
      await launched.page
        .locator('[data-setting-anchor="app.aiProvider"]')
        .scrollIntoViewIfNeeded();
      await launched.page.screenshot({ path: 'test-results/ai-settings-sections.png' });
      const section = await openAiSettings(launched);
      await section.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('local');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test endpoint');
      await section
        .getByRole('textbox', { name: 'Server base URL', exact: true })
        .fill(`http://127.0.0.1:${address.port}`);
      // Model discovery works before the first model is selected.
      await section.getByRole('button', { name: 'Refresh models', exact: true }).click();
      await expect(section.locator('datalist option')).toHaveCount(1);
      await section.getByLabel('Model', { exact: true }).fill('synthetic-model');
      await section.getByRole('button', { name: 'Save configuration', exact: true }).click();
      await expect(section.getByRole('status')).toContainText('Configuration saved');
      await openChat(launched);
      await launched.page.getByRole('button', { name: 'Catch up', exact: true }).click();
      const card = launched.page.getByRole('region', { name: 'Catch up', exact: true });
      await expect(card).toContainText('Alice brings batteries');
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).not.toContain('PRIVATE UNRELATED DM');
      await expect(card).toContainText('Sent to 127.0.0.1');
      await launched.page.screenshot({ path: 'test-results/ai-summary.png' });
      await openAppTab(launched.page);
      await section.getByRole('checkbox', { name: 'Enable AI summaries', exact: true }).uncheck();
      await launched.page.getByRole('button', { name: 'Chat', exact: true }).first().click();
      await expect(
        launched.page.getByRole('button', { name: 'Catch up', exact: true }),
      ).toHaveCount(0);
      await expect(
        launched.page.getByRole('region', { name: 'Catch up', exact: true }),
      ).toHaveCount(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });
  test('completes a dense 98-message range on both bundled model sizes', async () => {
    test.skip(
      process.env.MESH_AI_REAL_MODEL !== '1',
      'Explicit manual GGUF download and CPU inference smoke',
    );
    test.setTimeout(780000);
    launched = await launchApp();
    await launched.page.evaluate(async () => {
      const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
      const now = Date.now();
      for (let index = 0; index < 98; index++) {
        await api.db.saveMessage({
          sender_id: (index % 3) + 1,
          sender_name: ['Alice', 'Bob', 'Charlie'][index % 3],
          payload: [
            `Check-in ${index}: Alice has batteries ready for the north trailhead team at 18:00.`,
            `Update ${index}: Bob will bring two spare radios. The south trailhead still needs a volunteer.`,
            `Question ${index}: Who can confirm the evening repeater coverage from the north trailhead?`,
          ][index % 3],
          channel: 0,
          timestamp: now - (98 - index) * 1000,
        });
      }
    });
    const section = await openAiSettings(launched);
    await section.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('bundled');
    for (const modelId of ['llama3.2-1b-instruct-q4', 'qwen2.5-1.5b-instruct-q4']) {
      const installed = await launched.page.evaluate(async (id) => {
        const api = (window as unknown as { electronAPI: ElectronAPI }).electronAPI;
        const result = await api.ai.installLocalModel(id);
        if (result.ok) await api.ai.selectLocalModel(id);
        return result;
      }, modelId);
      expect(installed.ok).toBe(true);
      await openChat(launched);
      await launched.page
        .getByRole('combobox', { name: 'Summary range', exact: true })
        .selectOption('1');
      const started = Date.now();
      await launched.page.getByRole('button', { name: 'Catch up', exact: true }).click();
      const card = launched.page.getByRole('region', { name: 'Catch up', exact: true });
      const status = card.getByRole('status');
      await expect(status).toContainText('Loading model on this device', { timeout: 15000 });
      await expect(status).toContainText('Reading messages on this device', { timeout: 45000 });
      const loadedMs = Date.now() - started;
      await expect(status).not.toContainText(
        /Loading model|Reading messages|Preparing summary|another summary is generating/,
        {
          timeout: 310000,
        },
      );
      const firstTokenMs = Date.now() - started;
      await expect(card.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible({
        timeout: 310000,
      });
      const text = await status.innerText();
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/Could not summarize|timed out|not ready|unsupported response/);
      await expect(card).toContainText('98 of 98 collected messages included');
      await expect.poll(() => launched.page.workers().length).toBe(0);
      console.info(
        JSON.stringify({
          modelId,
          inputMessages: 98,
          loadedMs,
          firstTokenMs,
          completedMs: Date.now() - started,
        }),
      );
      await launched.page.screenshot({ path: `test-results/ai-dense-${modelId}.png` });
    }
  });
  test('runs a real bundled model in the sandbox and releases its worker', async () => {
    test.skip(
      process.env.MESH_AI_REAL_MODEL !== '1',
      'Explicit manual GGUF download and CPU inference smoke',
    );
    test.setTimeout(420000);
    launched = await launchApp();
    await seed(launched);
    const section = await openAiSettings(launched);
    await section.getByRole('combobox', { name: 'Engine', exact: true }).selectOption('bundled');
    const install = await launched.page.evaluate(() =>
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.ai.installLocalModel(
        'qwen2.5-1.5b-instruct-q4',
      ),
    );
    expect(install.ok).toBe(true);
    await launched.page.evaluate(() =>
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.ai.selectLocalModel(
        'qwen2.5-1.5b-instruct-q4',
      ),
    );
    await openChat(launched);
    await launched.page.getByRole('button', { name: 'Catch up', exact: true }).click();
    const card = launched.page.getByRole('region', { name: 'Catch up', exact: true });
    await expect(card.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible({
      timeout: 310000,
    });
    await expect(card).toContainText('Qwen2.5');
    await expect(card).toContainText('Processed on this device');
    await expect(card.getByRole('status')).not.toContainText('Could not summarize');
    await expect(card.getByRole('status')).not.toContainText('unsupported response');
    const text = await card.getByRole('status').innerText();
    expect(text).toMatch(/Alice.*batter|batter.*Alice/is);
    expect(text).toMatch(/Bob.*north trailhead|north trailhead.*Bob/is);
    expect(text).toMatch(/spare radio/i);
    expect(text).toMatch(/unanswered|unclear|unknown|not specified|still open|who has|who will/i);
    expect(text).not.toMatch(/Alice (?:will|has) confirm/i);
    await expect.poll(() => launched.page.workers().length).toBe(0);
    await launched.page.screenshot({ path: 'test-results/ai-bundled-summary.png' });
  });
});
