/**
 * UI operations the mobile host (Electron main) requests: native-feeling replacements for
 * Electron dialogs, `shell.openExternal`, notifications, clipboard, and file export.
 *
 * - Open dialogs use the WebView file chooser; picked bytes are copied into the host filesystem
 *   and the host path is returned (same contract as `dialog.showOpenDialog`).
 * - Save dialogs return a path under `/exports/`; when main finishes writing it the host calls
 *   `exportFile`, which opens the OS share sheet (Android/iOS) or downloads (browser).
 * - Message boxes render an accessible modal in the app's theme.
 */
import { Capacitor } from '@capacitor/core';

import i18n from '@/renderer/lib/i18n';

import { setWorkerLinksActive } from './backgroundKeeper';
import { getPlugin, mobilePlatform } from './nativePlugins';

export interface UiOpDeps {
  importFile: (name: string, bytes: Uint8Array) => Promise<string>;
}

interface FileFilter {
  name?: string;
  extensions?: string[];
}

function acceptFor(filters: FileFilter[] | undefined): string {
  const exts = (filters ?? []).flatMap((f) => f.extensions ?? []).filter((e) => e && e !== '*');
  return exts.map((e) => `.${e.replace(/^\./, '')}`).join(',');
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      done(Array.from(input.files ?? []));
    });
    input.addEventListener('cancel', () => {
      done([]);
    });
    document.body.appendChild(input);
    input.click();
  });
}

async function openDialog(
  opts: Record<string, unknown>,
  deps: UiOpDeps,
): Promise<{ canceled: boolean; filePaths: string[] }> {
  const props = Array.isArray(opts.properties) ? (opts.properties as string[]) : [];
  if (props.includes('openDirectory') && !props.includes('openFile')) {
    // Mobile apps cannot hand a directory to the host; callers treat this as a cancel.
    await showMessage({
      type: 'info',
      title: typeof opts.title === 'string' ? opts.title : 'Choose folder',
      message: i18n.t('mobile.folderUnavailable'),
      buttons: [i18n.t('common.close')],
    });
    return { canceled: true, filePaths: [] };
  }
  const files = await pickFiles(
    acceptFor(opts.filters as FileFilter[] | undefined),
    props.includes('multiSelections'),
  );
  if (files.length === 0) return { canceled: true, filePaths: [] };
  const filePaths: string[] = [];
  for (const f of files) {
    filePaths.push(await deps.importFile(f.name, new Uint8Array(await f.arrayBuffer())));
  }
  return { canceled: false, filePaths };
}

function saveDialog(opts: Record<string, unknown>): { canceled: boolean; filePath?: string } {
  const def =
    typeof opts.defaultPath === 'string' && opts.defaultPath
      ? opts.defaultPath
      : 'mesh-client-export';
  const base =
    def.slice(def.lastIndexOf('/') + 1).replace(/[\\/:*?"<>|]/g, '_') || 'mesh-client-export';
  const id = crypto.randomUUID();
  return { canceled: false, filePath: `/exports/${id}/${base}` };
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

async function exportFile(arg: { name: string; bytes: Uint8Array }): Promise<void> {
  if (mobilePlatform() === 'web') {
    const url = URL.createObjectURL(new Blob([arg.bytes as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = arg.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
    return;
  }
  const fsPlugin = getPlugin('Filesystem') as unknown as {
    writeFile(o: {
      path: string;
      data: string;
      directory: string;
      recursive: boolean;
    }): Promise<{ uri: string }>;
  };
  const written = await fsPlugin.writeFile({
    path: `exports/${arg.name}`,
    data: bytesToBase64(arg.bytes),
    directory: 'CACHE',
    recursive: true,
  });
  const share = getPlugin('Share') as unknown as {
    share(o: { title?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>;
  };
  try {
    await share.share({ title: arg.name, files: [written.uri], dialogTitle: arg.name });
  } catch (e) {
    // User dismissing the share sheet is not an error.
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

export interface MessageBoxOpts {
  type?: string;
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

/** Accessible modal used for `dialog.showMessageBox` / `showErrorBox`. */
export function showMessage(
  opts: MessageBoxOpts,
): Promise<{ response: number; checkboxChecked: boolean }> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-msgbox-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'mobile-msgbox';
    dialog.setAttribute(
      'role',
      opts.type === 'error' || opts.type === 'warning' ? 'alertdialog' : 'dialog',
    );
    dialog.setAttribute('aria-modal', 'true');
    const titleId = `msgbox-title-${Math.random().toString(36).slice(2)}`;
    dialog.setAttribute('aria-labelledby', titleId);
    const h = document.createElement('h2');
    h.id = titleId;
    h.textContent = opts.message || opts.title || '';
    dialog.appendChild(h);
    if (opts.detail) {
      const p = document.createElement('p');
      p.textContent = opts.detail;
      dialog.appendChild(p);
    }
    let checkbox: HTMLInputElement | null = null;
    if (opts.checkboxLabel) {
      const label = document.createElement('label');
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(opts.checkboxChecked);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${opts.checkboxLabel}`));
      dialog.appendChild(label);
    }
    const row = document.createElement('div');
    row.className = 'mobile-msgbox-buttons';
    const buttons = opts.buttons?.length ? opts.buttons : [i18n.t('common.close')];
    const cancelId = typeof opts.cancelId === 'number' ? opts.cancelId : buttons.length - 1;
    const finish = (response: number) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      prevFocus?.focus?.();
      resolve({ response, checkboxChecked: checkbox?.checked ?? false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(cancelId);
      }
    };
    buttons.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', label);
      if (i === (opts.defaultId ?? 0)) b.dataset.default = 'true';
      b.addEventListener('click', () => {
        finish(i);
      });
      row.appendChild(b);
    });
    dialog.appendChild(row);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey, true);
    row.querySelector<HTMLButtonElement>('[data-default="true"]')?.focus();
  });
}

async function notify(opts: Record<string, unknown>): Promise<{ clicked?: boolean }> {
  const title = typeof opts.title === 'string' ? opts.title : 'Mesh Client';
  const body = typeof opts.body === 'string' ? opts.body : '';
  if (mobilePlatform() === 'web') {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
    return {};
  }
  const ln = getPlugin('LocalNotifications') as unknown as {
    checkPermissions(): Promise<{ display: string }>;
    requestPermissions(): Promise<{ display: string }>;
    schedule(o: unknown): Promise<unknown>;
  };
  let perm = await ln.checkPermissions();
  if (perm.display !== 'granted') perm = await ln.requestPermissions();
  if (perm.display !== 'granted') return {};
  await ln.schedule({
    notifications: [
      {
        id: Number(opts.id ?? Date.now() % 2147483647),
        title,
        body,
        smallIcon: 'ic_stat_mesh',
        schedule: { allowWhileIdle: true },
      },
    ],
  });
  return {};
}

async function clearStorageData(): Promise<void> {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {
    console.debug('[mobile] web storage clear failed', e);
  }
  const idb = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
  if (idb.databases) {
    for (const db of await idb.databases()) if (db.name) idb.deleteDatabase(db.name);
  }
  if (typeof caches !== 'undefined') {
    for (const k of await caches.keys()) await caches.delete(k);
  }
}

export async function runUiOp(op: string, args: unknown[], deps: UiOpDeps): Promise<unknown> {
  switch (op) {
    case 'dialog.open':
      return openDialog((args[0] ?? {}) as Record<string, unknown>, deps);
    case 'dialog.save':
      return saveDialog((args[0] ?? {}) as Record<string, unknown>);
    case 'dialog.message':
      return showMessage(args[0] ?? {});
    case 'openExternal': {
      const url = typeof args[0] === 'string' ? args[0] : '';
      if (!/^(https?|mailto|tel|geo|sms):/i.test(url))
        throw new Error('Blocked external URL scheme');
      window.open(url, '_blank', 'noopener');
      return undefined;
    }
    case 'exportFile':
      return exportFile(args[0] as { name: string; bytes: Uint8Array });
    case 'notify':
      return notify((args[0] ?? {}) as Record<string, unknown>);
    case 'notify.close':
      return undefined;
    case 'clipboard.write':
      await navigator.clipboard?.writeText(typeof args[0] === 'string' ? args[0] : '');
      return undefined;
    case 'quit':
      if (Capacitor.getPlatform() === 'android') {
        await (getPlugin('App') as unknown as { exitApp(): Promise<void> }).exitApp();
      }
      return undefined;
    case 'relaunch':
    case 'reload':
      setTimeout(() => {
        location.reload();
      }, 50);
      return undefined;
    case 'clearStorageData':
      return clearStorageData();
    case 'backgroundLinks':
      setWorkerLinksActive(Boolean((args[0] as { active?: boolean } | undefined)?.active));
      return undefined;
    case 'keepAwake': {
      const device = getPlugin('MeshDevice') as unknown as {
        keepAwake?: (o: { enabled: boolean }) => Promise<void>;
      };
      await device.keepAwake?.({ enabled: Boolean(args[0]) });
      return undefined;
    }
    case 'badge':
      return undefined;
    case 'shareFile':
      throw new Error('Opening files is not available on mobile');
    default:
      throw new Error(`Unknown mobile UI operation: ${op}`);
  }
}
