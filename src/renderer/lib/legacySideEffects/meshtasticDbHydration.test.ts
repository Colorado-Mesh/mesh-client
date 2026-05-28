import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMeshtasticDbHydration } from './meshtasticDbHydration';

describe('runMeshtasticDbHydration', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      electronAPI: {
        db: {
          getMessages: vi.fn().mockResolvedValue([]),
          getNodes: vi.fn().mockResolvedValue([]),
          getMeshcoreContacts: vi.fn().mockResolvedValue([]),
        },
      },
    });
  });

  it('loads messages and nodes via IPC callbacks', async () => {
    const setMessages = vi.fn();
    const setNodes = vi.fn();
    const onNodesLoaded = vi.fn();

    runMeshtasticDbHydration({
      setMessages,
      setNodes,
      onNodesLoaded,
      seedSeenPacketId: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(setMessages).toHaveBeenCalled();
      expect(setNodes).toHaveBeenCalled();
    });
  });
});
