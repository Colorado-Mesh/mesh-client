import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dataUrlBytes,
  type ExportFile,
  installBlobDownloads,
  isFileDownload,
} from './blobDownloads';

const HELLO = 'data:text/csv;base64,aGVsbG8='; // "hello"

let uninstall: (() => void) | null = null;
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let next = 0;

beforeEach(() => {
  // jsdom has no object URLs; stand in for the browser's.
  URL.createObjectURL = vi.fn(() => {
    next += 1;
    return `blob:https://localhost/test-${next}`;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  document.body.innerHTML = '';
});

function link(href: string, download?: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  if (download !== undefined) a.download = download;
  return a;
}

describe('file downloads on mobile', () => {
  it('sends the detached link of downloadBlob to the share sheet, reading the Blob without fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const exportFile = vi.fn<ExportFile>(() => Promise.resolve());
    uninstall = installBlobDownloads(exportFile);
    // What downloadBlob does: create the URL, click a detached link, revoke right after.
    const url = URL.createObjectURL(new Blob(['a,b\n1,2\n'], { type: 'text/csv' }));
    link(url, 'mesh-topology.csv').click();
    URL.revokeObjectURL(url);
    await vi.waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });
    const arg = exportFile.mock.calls[0]?.[0];
    expect(arg?.name).toBe('mesh-topology.csv');
    expect(new TextDecoder().decode(arg?.bytes)).toBe('a,b\n1,2\n');
    // The desktop CSP refuses fetch() of blob: URLs, so it must not be used.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sends a tapped data: download link on the page to the share sheet instead of navigating', async () => {
    const exportFile = vi.fn<ExportFile>(() => Promise.resolve());
    uninstall = installBlobDownloads(exportFile);
    const a = link(HELLO, 'telemetry.csv');
    document.body.append(a);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(exportFile).toHaveBeenCalledTimes(1);
    });
    expect(new TextDecoder().decode(exportFile.mock.calls[0]?.[0].bytes)).toBe('hello');
  });

  it('leaves ordinary links alone', () => {
    const exportFile = vi.fn<ExportFile>(() => Promise.resolve());
    uninstall = installBlobDownloads(exportFile);
    const a = link('#section');
    document.body.append(a);
    const clicks = vi.fn();
    a.addEventListener('click', clicks);
    a.click();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(exportFile).not.toHaveBeenCalled();
    expect(isFileDownload(link('https://example.org/file.csv', 'file.csv'))).toBe(false);
  });

  it('decodes percent-encoded data URLs', () => {
    expect(new TextDecoder().decode(dataUrlBytes('data:text/plain,a%20b'))).toBe('a b');
  });
});
