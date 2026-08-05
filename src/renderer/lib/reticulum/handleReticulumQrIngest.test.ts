import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyLxmPaperIngest = vi.fn();
const applyLxmContactImport = vi.fn();
const applyLxmaContactImport = vi.fn();

vi.mock('@/renderer/lib/meshClientDeepLinkApply', () => ({
  applyLxmPaperIngest: (...args: unknown[]) => applyLxmPaperIngest(...args),
  applyLxmContactImport: (...args: unknown[]) => applyLxmContactImport(...args),
  applyLxmaContactImport: (...args: unknown[]) => applyLxmaContactImport(...args),
}));

import { handleReticulumQrIngest } from './handleReticulumQrIngest';

describe('handleReticulumQrIngest', () => {
  beforeEach(() => {
    applyLxmPaperIngest.mockReset();
    applyLxmContactImport.mockReset();
    applyLxmaContactImport.mockReset();
  });

  it('ingests paper URIs', async () => {
    const uri = `lxm://${'A'.repeat(48)}`;
    applyLxmPaperIngest.mockResolvedValue({ ok: true, kind: 'lxmPaperMessage' });
    const outcome = await handleReticulumQrIngest(uri);
    expect(outcome).toEqual({
      handled: true,
      toast: { key: 'qrIngest.paperIngested', variant: 'success' },
    });
    expect(applyLxmPaperIngest).toHaveBeenCalledWith({ uri });
  });

  it('maps paper decrypt errors', async () => {
    applyLxmPaperIngest.mockResolvedValue({
      ok: false,
      errorKey: 'qrIngest.paperDecryptFailed',
    });
    const outcome = await handleReticulumQrIngest(`lxm://${'B'.repeat(48)}`);
    expect(outcome).toEqual({
      handled: true,
      toast: { key: 'qrIngest.paperDecryptFailed', variant: 'error' },
    });
  });

  it('imports lxma contacts', async () => {
    const dest = 'a'.repeat(32);
    const pub = 'b'.repeat(128);
    applyLxmaContactImport.mockResolvedValue({ ok: true, kind: 'lxmaContact' });
    const outcome = await handleReticulumQrIngest(`lxma://${dest}:${pub}`);
    expect(outcome.handled).toBe(true);
    if (outcome.handled) {
      expect(outcome.toast.key).toBe('qrIngest.contactImported');
    }
    expect(applyLxmaContactImport).toHaveBeenCalled();
  });
});
