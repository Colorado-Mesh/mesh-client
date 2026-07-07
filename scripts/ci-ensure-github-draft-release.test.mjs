import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureGithubDraftRelease } from './ci-ensure-github-draft-release.mjs';

const TAG = 'v5.21.0';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ensureGithubDraftRelease', () => {
  it('returns existing release when tag is already published as draft', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      expect(init?.method ?? 'GET').toBe('GET');
      expect(String(url)).toContain(`/releases/tags/${TAG}`);
      return new Response(JSON.stringify({ id: 42, tag_name: TAG, draft: true }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      log: () => {},
    });

    expect(release.id).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a draft release when tag has no release yet', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes(`/releases/tags/${TAG}`)) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (method === 'POST' && href.endsWith('/releases')) {
        return new Response(JSON.stringify({ id: 99, tag_name: TAG, draft: true }), {
          status: 201,
        });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      log: () => {},
    });

    expect(release.id).toBe(99);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      tag_name: TAG,
      name: '5.21.0',
      draft: true,
    });
  });

  it('re-fetches when create hits a 422 race', async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes(`/releases/tags/${TAG}`)) {
        getCount += 1;
        if (getCount === 1) {
          return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
        }
        return new Response(JSON.stringify({ id: 7, tag_name: TAG, draft: true }), {
          status: 200,
        });
      }
      if (method === 'POST' && href.endsWith('/releases')) {
        return new Response(JSON.stringify({ message: 'Already exists' }), { status: 422 });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      log: () => {},
    });

    expect(release.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
