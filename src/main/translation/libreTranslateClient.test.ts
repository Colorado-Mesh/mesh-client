import { describe, expect, it, vi } from 'vitest';

import { LibreTranslateClient } from './libreTranslateClient';

function setup(response: () => Promise<Response>) {
  let saved: string | undefined;
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn((text: string) => Buffer.from(`encrypted:${text}`)),
    decryptString: vi.fn((bytes: Buffer) => bytes.toString().replace('encrypted:', '')),
  };
  const fetchImpl = vi.fn(response);
  const client = new LibreTranslateClient({
    fetch: fetchImpl,
    read: () => saved,
    write: (value) => {
      saved = value;
    },
    safeStorage,
  });
  client.setConfig({ enabled: true, url: 'http://localhost:5000', apiKey: 'private-key' });
  return { client, fetchImpl, safeStorage, saved: () => saved };
}
describe('LibreTranslate client', () => {
  it('drops the old server key when changing URLs without supplying another key', () => {
    const { client } = setup(() => Promise.resolve(Response.json({ translatedText: 'hello' })));
    client.setConfig({ enabled: true, url: 'https://other-server.test' });
    expect(client.status().hasApiKey).toBe(false);
  });
  it('encrypts keys and never exposes them in status; sends only explicit requests', async () => {
    const { client, fetchImpl, safeStorage, saved } = setup(() =>
      Promise.resolve(Response.json({ translatedText: 'hello' })),
    );
    expect(await client.translate('bonjour', 'fr', 'en')).toBe('hello');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('private-key');
    expect(safeStorage.decryptString).toHaveBeenCalled();
    expect(saved()).not.toContain('"apiKey"');
    expect(client.status()).toEqual({
      enabled: true,
      url: 'http://localhost:5000',
      hasApiKey: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:5000/translate',
      expect.objectContaining({
        redirect: 'error',
        method: 'POST',
        body: expect.stringContaining('private-key'),
      }),
    );
  });
  it.each(['http', 'size', 'json', 'shape'])(
    'rejects %s failures without private server content',
    async (failure) => {
      const { client } = setup(() =>
        Promise.resolve(
          failure === 'http'
            ? new Response('secret', { status: 500 })
            : failure === 'size'
              ? new Response('x'.repeat(129 * 1024))
              : failure === 'json'
                ? new Response('{')
                : Response.json({ private: 'secret' }),
        ),
      );
      await expect(client.translate('secret', 'en', 'fr')).rejects.toThrow();
    },
  );
  it('parses detection and prevents key persistence without OS encryption', async () => {
    const { client, safeStorage } = setup(() =>
      Promise.resolve(Response.json([{ language: 'fr', confidence: 95 }])),
    );
    expect(await client.detect('bonjour')).toEqual({ language: 'fr', confidence: 0.95 });
    safeStorage.isEncryptionAvailable = () => false;
    expect(() => {
      client.setConfig({ enabled: true, url: 'https://server.test', apiKey: 'key' });
    }).toThrow('OS key');
    expect(() => {
      client.setConfig({ enabled: true, url: 'https://key@server.test' });
    }).toThrow();
  });
});
