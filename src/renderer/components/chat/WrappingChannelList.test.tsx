import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { WrappingChannelList } from './WrappingChannelList';

const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
const originalApi = Object.getOwnPropertyDescriptor(window, 'electronAPI');
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  disconnect.mockClear();
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { getPlatform: vi.fn() },
  });
});
afterEach(() => {
  if (originalObserver) Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
  else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  if (originalApi) Object.defineProperty(window, 'electronAPI', originalApi);
  else Reflect.deleteProperty(window, 'electronAPI');
});

function arrangeGeometry(viewport: HTMLElement, viewportHeight = 40) {
  const root = viewport.parentElement!;
  const content = viewport.firstElementChild!;
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: 56 });
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 204 });
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: viewportHeight });
  viewport.getBoundingClientRect = () =>
    ({ top: 0, bottom: viewportHeight, height: viewportHeight }) as DOMRect;
  [...viewport.querySelectorAll('button')].forEach((button, index) => {
    button.getBoundingClientRect = () => {
      const top = index * 60 - viewport.scrollTop;
      return { top, bottom: top + 24, height: 24 } as DOMRect;
    };
  });
  act(() => {
    resize();
  });
}

function Choices({ onChoose, lastActive = false }: { onChoose: () => void; lastActive?: boolean }) {
  return (
    <>
      {['General', 'Ops', 'Weather', 'Very long emergency coordination name'].map((name, index) => (
        <button
          key={name}
          type="button"
          data-channel-unread={index === 0 ? 0 : 1}
          data-strip-active={lastActive && index === 3 ? 'true' : undefined}
          onClick={onChoose}
        >
          {name}
        </button>
      ))}
    </>
  );
}

describe('WrappingChannelList', () => {
  it.each(['linux', 'darwin', 'win32'] as const)(
    'reveals unread choices without selecting them, preserving keyboard access on %s',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const user = userEvent.setup();
      const onChoose = vi.fn();
      const { container, unmount } = render(
        <WrappingChannelList activeKey={null}>
          <Choices onChoose={onChoose} />
        </WrappingChannelList>,
      );
      const viewport = screen.getByRole('region', { name: 'Channels' });
      arrangeGeometry(viewport);
      expect(viewport).toHaveAttribute('tabindex', '0');
      expect(viewport.querySelectorAll('button')).toHaveLength(4);
      container.scrollTop = 9;
      await user.click(screen.getByRole('button', { name: '3 unread below' }));
      expect(screen.getByRole('button', { name: 'Ops' })).toHaveFocus();
      expect(onChoose).not.toHaveBeenCalled();
      expect(viewport.scrollTop).toBe(48);
      expect(container.scrollTop).toBe(9);
      await user.tab();
      const weather = screen.getByRole('button', { name: 'Weather' });
      expect(weather).toHaveFocus();
      expect(viewport.scrollTop).toBe(108);
      expect(screen.getByRole('button', { name: '1 unread above' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 unread below' })).toBeInTheDocument();
      arrangeGeometry(viewport, 32);
      expect(weather).toHaveFocus();
      expect(weather.getBoundingClientRect().bottom).toBeLessThanOrEqual(32);
      await user.keyboard('{Enter}');
      expect(onChoose).toHaveBeenCalledOnce();
      unmount();
      expect(disconnect).toHaveBeenCalled();
    },
  );

  it('reveals a programmatically selected channel without scrolling the page', () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <WrappingChannelList activeKey={null}>
        <Choices onChoose={onChoose} />
      </WrappingChannelList>,
    );
    const viewport = screen.getByRole('region', { name: 'Channels' });
    arrangeGeometry(viewport);
    rerender(
      <WrappingChannelList activeKey={3}>
        <Choices onChoose={onChoose} lastActive />
      </WrappingChannelList>,
    );
    expect(viewport.scrollTop).toBe(168);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'keeps selection visible while typing, prioritizing a focused channel on %s',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const user = userEvent.setup();
      render(
        <>
          <WrappingChannelList activeKey={3}>
            <Choices onChoose={vi.fn()} lastActive />
          </WrappingChannelList>
          <input aria-label="Composer" />
        </>,
      );
      const viewport = screen.getByRole('region', { name: 'Channels' });
      arrangeGeometry(viewport);
      const composer = screen.getByRole('textbox', { name: 'Composer' });
      await user.click(composer);
      // The selected key stays unchanged while a resize moves its row offscreen.
      viewport.scrollTop = 96;
      act(() => {
        resize();
      });
      expect(viewport.scrollTop).toBe(168);
      expect(composer).toHaveFocus();

      const weather = screen.getByRole('button', { name: 'Weather' });
      act(() => {
        weather.focus();
      });
      arrangeGeometry(viewport, 32);
      expect(weather).toHaveFocus();
      expect(weather.getBoundingClientRect().bottom).toBeLessThanOrEqual(32);
      expect(
        screen
          .getByRole('button', { name: 'Very long emergency coordination name' })
          .getBoundingClientRect().top,
      ).toBeGreaterThan(32);
    },
  );

  it('does not add overflow controls or a scroll tab stop when every channel fits', () => {
    render(
      <WrappingChannelList activeKey={null}>
        <Choices onChoose={vi.fn()} />
      </WrappingChannelList>,
    );
    const viewport = screen.getByRole('region', { name: 'Channels' });
    arrangeGeometry(viewport, 240);
    Object.defineProperty(viewport.parentElement!, 'clientHeight', {
      configurable: true,
      value: 240,
    });
    act(() => {
      resize();
    });
    expect(viewport).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button', { name: /unread (above|below)/ })).not.toBeInTheDocument();
  });

  it('names the keyboard scroll region and associates unread controls accessibly', async () => {
    const { container } = render(
      <WrappingChannelList activeKey={null}>
        <Choices onChoose={vi.fn()} />
      </WrappingChannelList>,
    );
    arrangeGeometry(screen.getByRole('region', { name: 'Channels' }));
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
