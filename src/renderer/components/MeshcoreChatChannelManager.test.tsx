import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import MeshcoreChatChannelManager from './MeshcoreChatChannelManager';
import { ToastProvider } from './Toast';

const configuredSecret = new Uint8Array([1, ...new Array<number>(15).fill(0)]);

function renderManager(
  overrides: Partial<React.ComponentProps<typeof MeshcoreChatChannelManager>> = {},
) {
  const props: React.ComponentProps<typeof MeshcoreChatChannelManager> = {
    channels: [{ index: 0, name: '#general', secret: configuredSecret }],
    disabled: false,
    onSetChannel: vi.fn().mockResolvedValue(undefined),
    onSelectChannel: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <MeshcoreChatChannelManager {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('MeshcoreChatChannelManager', () => {
  it('adds a hashtag channel to the first free slot and selects it', async () => {
    const user = userEvent.setup();
    const props = renderManager({
      channels: [
        { index: 0, name: '#general', secret: configuredSecret },
        { index: 2, name: '#alerts', secret: configuredSecret },
      ],
    });

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.type(screen.getByLabelText('Name'), 'weather');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledTimes(1);
    });
    const [index, name, secret] = vi.mocked(props.onSetChannel).mock.calls[0];
    expect(index).toBe(1);
    expect(name).toBe('#weather');
    expect(
      Array.from(secret)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    ).toBe('88f502554fee92a1625cfb311546e7cb');
    expect(props.onSelectChannel).toHaveBeenCalledWith(1);
  });

  it('selects an existing exact channel instead of creating a duplicate', async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.type(screen.getByLabelText('Name'), 'general');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onSetChannel).not.toHaveBeenCalled();
    expect(props.onSelectChannel).toHaveBeenCalledWith(0);
  });

  it('does not open while device channel management is disabled', async () => {
    const user = userEvent.setup();
    renderManager({ disabled: true });
    const add = screen.getByRole('button', { name: '+ Add Channel' });
    expect(add).toBeDisabled();
    await user.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
