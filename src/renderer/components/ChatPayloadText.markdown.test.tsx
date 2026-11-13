import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatPayloadText } from './ChatPayloadText';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(window, 'electronAPI', {
    value: {
      chat: {
        linkPreview: {
          fetch: vi.fn().mockResolvedValue(null),
        },
      },
    },
    writable: true,
    configurable: true,
  });
});

describe('ChatPayloadText markdown', () => {
  it('renders bold italic strike and code after plain-text segmentation', () => {
    const { container } = render(
      <ChatPayloadText text="**bold** *italic* ~~strike~~ `code`" query="" />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('s')?.textContent).toBe('strike');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('keeps HTML-looking markdown payload as text nodes', () => {
    const { container } = render(
      <ChatPayloadText text={'<img src=x onerror=alert(1)> **safe**'} query="" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('safe');
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('highlights search matches inside markdown text nodes', () => {
    const { container } = render(<ChatPayloadText text="**hello world**" query="world" />);
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('mark')?.textContent).toBe('world');
  });
});
