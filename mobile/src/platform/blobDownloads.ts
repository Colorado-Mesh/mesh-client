/**
 * The renderer saves files it builds itself (node list CSV/JSON, diagnostics, telemetry, incident
 * logs, Nomad files) by clicking an `<a download href="blob:...">` (`downloadBlob`). WebViews ignore
 * such downloads: Android has no download handler for blob: or data: URLs, so on the phone those
 * buttons did nothing at all. On Android and iOS these clicks now go to the same share sheet that
 * main's file exports use. The browser harness keeps real downloads.
 *
 * Both paths are covered: a script calling `a.click()` (usually on a detached link, whose event
 * never reaches the document) and a user tapping such a link on the page.
 *
 * The bytes are read without `fetch()`: the desktop Content Security Policy (connect-src) refuses
 * blob: URLs. Object URLs are remembered with their Blob when created (the browser keeps the Blob
 * alive until the URL is revoked anyway), and data: URLs are decoded in place.
 */

export type ExportFile = (arg: { name: string; bytes: Uint8Array }) => Promise<void>;

/** A link that downloads a file the page built, rather than navigating. */
export function isFileDownload(a: HTMLAnchorElement): boolean {
  return a.hasAttribute('download') && /^(blob|data):/i.test(a.href);
}

/** Bytes of a data: URL (base64 or percent-encoded). */
export function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('Malformed data URL');
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the file'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/** Route file downloads to the share sheet; returns a function that undoes it (tests). */
export function installBlobDownloads(exportFile: ExportFile): () => void {
  const blobs = new Map<string, Blob>();
  const originalCreate = URL.createObjectURL.bind(URL);
  const originalRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = originalCreate(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
    originalRevoke(url);
  };

  const deliver = (a: HTMLAnchorElement) => {
    const name = a.download || 'download';
    // Look the Blob up now: downloadBlob revokes the object URL right after the click.
    const href = a.href;
    const blob = blobs.get(href);
    void (async () => {
      try {
        let bytes: Uint8Array;
        if (blob) bytes = await blobBytes(blob);
        else if (href.startsWith('data:')) bytes = dataUrlBytes(href);
        else throw new Error('Unknown object URL');
        await exportFile({ name, bytes });
      } catch (e: unknown) {
        console.warn(
          `mcM0025 [mobile] file download failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
  };

  const proto = HTMLAnchorElement.prototype;
  const originalClick = proto.click;
  proto.click = function click(this: HTMLAnchorElement) {
    if (isFileDownload(this)) {
      deliver(this);
      return;
    }
    originalClick.call(this);
  };
  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('a') : null;
    if (target instanceof HTMLAnchorElement && isFileDownload(target)) {
      e.preventDefault();
      deliver(target);
    }
  };
  document.addEventListener('click', onClick, true);
  return () => {
    proto.click = originalClick;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    document.removeEventListener('click', onClick, true);
  };
}
