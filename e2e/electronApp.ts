import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
} from '@playwright/test';

/** Playwright is always invoked from the repository root (`pnpm run test:e2e`). */
export const repoRoot = process.cwd();

const MAIN_ENTRY = path.join(repoRoot, 'dist-electron', 'main', 'index.js');

export interface LaunchAppOptions {
  /** Reuse an existing user-data dir (for relaunch tests). */
  userDataDir?: string;
  /** When true, closeApp/teardown will not delete userDataDir. */
  retainUserData?: boolean;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  retainUserData: boolean;
  rendererConsoleErrors: string[];
  crashed: boolean;
  didFailLoad: boolean;
}

type ResolveLocalElectronBin = (
  platform?: NodeJS.Platform,
  fileExists?: (p: string) => boolean,
) => string;

async function loadResolveLocalElectronBin(): Promise<ResolveLocalElectronBin> {
  const modUrl = pathToFileURL(path.join(repoRoot, 'scripts', 'start-electron.mjs')).href;
  const mod = (await import(modUrl)) as {
    resolveLocalElectronBin: ResolveLocalElectronBin;
  };
  return mod.resolveLocalElectronBin;
}

export function assertProductionBuildPresent(): void {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `Missing ${MAIN_ENTRY}. Run \`pnpm run test:e2e:build\` (or \`pnpm run build\` first).`,
    );
  }
}

function createUserDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'mesh-e2e-'));
}

export function disposeUserData(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // catch-no-log-ok best-effort temp cleanup
  }
}

export async function launchApp(options: LaunchAppOptions = {}): Promise<LaunchedApp> {
  assertProductionBuildPresent();

  const resolveLocalElectronBin = await loadResolveLocalElectronBin();
  const executablePath = resolveLocalElectronBin();
  if (!existsSync(executablePath)) {
    throw new Error(`Electron binary not found at ${executablePath}. Run pnpm install.`);
  }

  const userDataDir = options.userDataDir ?? createUserDataDir();
  const retainUserData = options.retainUserData ?? false;

  const args = ['.', `--user-data-dir=${userDataDir}`];
  if (process.platform === 'linux') {
    args.push('--disable-setuid-sandbox');
  }

  const env: Record<string, string | undefined> = { ...process.env };
  delete env.VITE_DEV_SERVER_URL;
  if (process.platform === 'linux') {
    env.MESH_CLIENT_DISABLE_GPU = '1';
  }

  const app = await electron.launch({
    executablePath,
    args,
    cwd: repoRoot,
    env: env as Record<string, string>,
  });

  const launched: LaunchedApp = {
    app,
    page: undefined as unknown as Page,
    userDataDir,
    retainUserData,
    rendererConsoleErrors: [],
    crashed: false,
    didFailLoad: false,
  };

  const page = await app.firstWindow();
  launched.page = page;

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      launched.rendererConsoleErrors.push(msg.text());
    }
  });
  page.on('crash', () => {
    launched.crashed = true;
  });
  page.on('pageerror', (err) => {
    launched.rendererConsoleErrors.push(String(err));
  });

  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    session.on('Network.loadingFailed', (event: { type?: string; canceled?: boolean }) => {
      if (event.canceled) return;
      if (event.type === 'Document') {
        launched.didFailLoad = true;
      }
    });
  } catch {
    // catch-no-log-ok CDP optional on some Electron builds
  }

  await page.waitForSelector('#root', { state: 'visible', timeout: 45_000 });
  await page
    .getByRole('group', { name: 'Protocol switcher' })
    .waitFor({ state: 'visible', timeout: 45_000 });

  return launched;
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  try {
    await launched.app.close();
  } catch {
    // catch-no-log-ok app may already be exiting
  }
}

export async function teardownApp(launched: LaunchedApp): Promise<void> {
  await closeApp(launched);
  if (!launched.retainUserData) {
    disposeUserData(launched.userDataDir);
  }
}

/** Patch main-process dialog.showSaveDialog to always cancel; returns a restore function. */
export async function stubSaveDialogCanceled(
  app: ElectronApplication,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as typeof globalThis & {
      __meshE2eOrigShowSaveDialog?: typeof dialog.showSaveDialog;
    };
    g.__meshE2eOrigShowSaveDialog ??= dialog.showSaveDialog.bind(dialog);
    dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
  });

  return async () => {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as typeof globalThis & {
        __meshE2eOrigShowSaveDialog?: typeof dialog.showSaveDialog;
      };
      if (g.__meshE2eOrigShowSaveDialog) {
        dialog.showSaveDialog = g.__meshE2eOrigShowSaveDialog;
        delete g.__meshE2eOrigShowSaveDialog;
      }
    });
  };
}

/** Known-benign renderer console noise for window-lifecycle allow-list (expand after CI pilot). */
export const RENDERER_CONSOLE_ERROR_ALLOWLIST: RegExp[] = [
  /Download the React DevTools/i,
  /Autofill\.(enable|disable)/i,
];

export function filterUnexpectedConsoleErrors(errors: string[]): string[] {
  return errors.filter((text) => !RENDERER_CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(text)));
}

export async function openAppTab(page: Page): Promise<void> {
  const tablist = page.getByRole('tablist', { name: 'Application panels' });
  await tablist.getByRole('tab', { name: 'App' }).click();
  await expectTabSelected(page, 'App');
}

export async function expectTabSelected(page: Page, name: string | RegExp): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Application panels' }).getByRole('tab', { name });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
