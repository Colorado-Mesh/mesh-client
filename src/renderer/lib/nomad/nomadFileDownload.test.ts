// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { downloadNomadFileFromBase64 } from './nomadFileDownload';

describe('downloadNomadFileFromBase64', () => {
  it('creates a blob download from base64 payload', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const link = { click, download: '', href: '' } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(link);

    downloadNomadFileFromBase64('hello.txt', 'aGVsbG8=');

    expect(createObjectURL).toHaveBeenCalled();
    expect(link.download).toBe('hello.txt');
    expect(click).toHaveBeenCalled();
  });
});
