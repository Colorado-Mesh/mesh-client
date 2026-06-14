/** Trigger a one-shot file download from a Blob; revokes the object URL after the click. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  const revoke = () => {
    URL.revokeObjectURL(url);
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      setTimeout(revoke, 100);
    });
  } else {
    setTimeout(revoke, 100);
  }
}
