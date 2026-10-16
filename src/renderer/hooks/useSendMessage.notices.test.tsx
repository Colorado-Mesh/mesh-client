import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../lib/i18n';
import { sendChatOnIdentity } from '../lib/sendChatOnIdentity';
import { useSendMessage } from './useSendMessage';

const addToast = vi.fn();

vi.mock('../components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('../lib/sendChatOnIdentity', () => ({
  sendChatOnIdentity: vi.fn(),
}));

describe('useSendMessage', () => {
  beforeEach(() => {
    addToast.mockClear();
    vi.mocked(sendChatOnIdentity).mockReset().mockReturnValue('out:1');
  });

  it('passes the composer arguments to the shared send and returns its store id', () => {
    const { result } = renderHook(() => useSendMessage('id-a'));
    expect(result.current('hello', 2, 10, 'parent', 'failed-row')).toBe('out:1');
    expect(sendChatOnIdentity).toHaveBeenCalledWith(
      'id-a',
      {
        text: 'hello',
        channelIndex: 2,
        destination: 10,
        replyTo: 'parent',
        retryOfStoreId: 'failed-row',
      },
      expect.any(Object),
    );
  });

  it('sends nothing without an identity', () => {
    const { result } = renderHook(() => useSendMessage(null));
    expect(result.current('hello', 0)).toBeUndefined();
    expect(sendChatOnIdentity).not.toHaveBeenCalled();
  });

  it('shows Reticulum delivery problems as error toasts', () => {
    const { result } = renderHook(() => useSendMessage('id-rt'));
    result.current('hello', 0, 5);
    const notices = vi.mocked(sendChatOnIdentity).mock.calls[0][2];
    notices?.onNoPropagationNode?.();
    notices?.onMissingLxmfDelivery?.();
    expect(addToast).toHaveBeenNthCalledWith(
      1,
      i18n.t('chatPanel.reticulumNoPropagationNode'),
      'error',
    );
    expect(addToast).toHaveBeenNthCalledWith(
      2,
      i18n.t('chatPanel.reticulumChatNeedsLxmfDelivery'),
      'error',
    );
  });
});
