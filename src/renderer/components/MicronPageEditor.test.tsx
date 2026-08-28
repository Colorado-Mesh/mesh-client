/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'path' in opts) return `${key}:${String(opts.path)}`;
      return key;
    },
  }),
}));

const putServingPage = vi.fn();
const deleteServingPage = vi.fn();

vi.mock('@/renderer/lib/nomad/nomadServingApi', () => ({
  putServingPage: (path: string, content: string) => putServingPage(path, content),
  deleteServingPage: (path: string) => deleteServingPage(path),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import MicronPageEditor from './MicronPageEditor';

function source(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'nomadNetwork.serving.editorAria' });
}

describe('MicronPageEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    putServingPage.mockReset();
    deleteServingPage.mockReset();
    putServingPage.mockResolvedValue({ ok: true });
    deleteServingPage.mockResolvedValue({ ok: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom has no rAF-driven layout; run caret restoration synchronously.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('renders the source and a live preview of the initial content', async () => {
    render(<MicronPageEditor path="index.mu" initialContent=">Hello" onClose={vi.fn()} />);
    expect(source()).toHaveValue('>Hello');
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });

  it('wraps the selected text when Bold is clicked', async () => {
    const user = userEvent.setup();
    render(<MicronPageEditor path="index.mu" initialContent="hello world" onClose={vi.fn()} />);

    const textarea = source();
    textarea.setSelectionRange(6, 11);
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.toolbar.bold' }));

    expect(source()).toHaveValue('hello `!world`!');
  });

  it('applies a heading to the caret line', async () => {
    const user = userEvent.setup();
    render(<MicronPageEditor path="index.mu" initialContent="Title" onClose={vi.fn()} />);

    source().setSelectionRange(0, 0);
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.toolbar.h1' }));

    expect(source()).toHaveValue('>Title');
  });

  it('updates the preview after the debounce settles', async () => {
    render(<MicronPageEditor path="index.mu" initialContent="" onClose={vi.fn()} />);

    fireEvent.change(source(), { target: { value: '>Fresh heading' } });

    await waitFor(() => {
      expect(screen.getByText('Fresh heading')).toBeInTheDocument();
    });
  });

  it('tracks dirty state and enables save only when changed', () => {
    render(<MicronPageEditor path="index.mu" initialContent="a" onClose={vi.fn()} />);

    const save = screen.getByRole('button', { name: 'nomadNetwork.serving.save' });
    expect(save).toBeDisabled();
    expect(screen.queryByText('nomadNetwork.serving.unsaved')).toBeNull();

    fireEvent.change(source(), { target: { value: 'ab' } });
    expect(save).toBeEnabled();
    expect(screen.getByText('nomadNetwork.serving.unsaved')).toBeInTheDocument();
  });

  it('saves the current content and clears the dirty flag', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <MicronPageEditor
        path="page/foo.mu"
        initialContent="old"
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(source(), { target: { value: 'new body' } });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.save' }));

    await waitFor(() => {
      expect(putServingPage).toHaveBeenCalledWith('page/foo.mu', 'new body');
    });
    expect(putServingPage).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith('new body');
    await waitFor(() => {
      expect(screen.queryByText('nomadNetwork.serving.unsaved')).toBeNull();
    });
  });

  // Losing an unsaved draft on a failed write is the worst outcome here.
  it('keeps the draft and shows the error when saving fails', async () => {
    const user = userEvent.setup();
    putServingPage.mockResolvedValue({ ok: false, error: 'page_too_large' });
    render(<MicronPageEditor path="index.mu" initialContent="old" onClose={vi.fn()} />);

    fireEvent.change(source(), { target: { value: 'huge body' } });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.save' }));

    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.serving.pageTooLarge')).toBeInTheDocument();
    });
    expect(source()).toHaveValue('huge body');
    expect(screen.getByText('nomadNetwork.serving.unsaved')).toBeInTheDocument();
  });

  it('deletes only after confirmation', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(
      <MicronPageEditor
        path="about.mu"
        initialContent="x"
        canDelete
        onDeleted={onDeleted}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.deletePage:about.mu' }),
    );
    expect(deleteServingPage).not.toHaveBeenCalled();
    expect(screen.getByText('nomadNetwork.serving.deleteConfirm')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.deleteConfirmAria' }),
    );
    await waitFor(() => {
      expect(deleteServingPage).toHaveBeenCalledWith('about.mu');
    });
    expect(onDeleted).toHaveBeenCalled();
  });

  it('abandons a delete when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    render(<MicronPageEditor path="about.mu" initialContent="x" canDelete onClose={vi.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.deletePage:about.mu' }),
    );
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(deleteServingPage).not.toHaveBeenCalled();
    expect(screen.queryByText('nomadNetwork.serving.deleteConfirm')).toBeNull();
  });

  it('offers no delete control for a page that does not exist yet', () => {
    render(<MicronPageEditor path="new.mu" initialContent="" onClose={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'nomadNetwork.serving.deletePage:new.mu' }),
    ).toBeNull();
  });

  it('closes immediately when there are no unsaved changes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MicronPageEditor path="index.mu" initialContent="a" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('requires an explicit discard when closing dirty', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MicronPageEditor path="index.mu" initialContent="a" onClose={onClose} />);

    fireEvent.change(source(), { target: { value: 'edited' } });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.close' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('nomadNetwork.serving.discardConfirm')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.discardConfirmAria' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  describe('preview parity with the Nomad browser', () => {
    function previewRoot(container: HTMLElement): HTMLElement {
      const el = container.querySelector<HTMLElement>('.nomad-micron-page');
      if (!el) throw new Error('preview is not rendered through NomadMicronPageView');
      return el;
    }

    // The class is what supplies `white-space: pre` and MeshClientNomadMono, which is
    // what makes box-drawing art render the same as in the browser.
    it('renders the preview through the shared nomad-micron-page container', async () => {
      const { container } = render(
        <MicronPageEditor path="index.mu" initialContent=">Hi" onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeInTheDocument();
      });
      expect(previewRoot(container)).toBeInTheDocument();
    });

    it('preserves the padding spaces that box-drawing art depends on', async () => {
      const art = ['┌──────────┐', '│  mesh    │', '│    node  │', '└──────────┘'].join('\n');
      const { container } = render(
        <MicronPageEditor path="art.mu" initialContent={art} onClose={vi.fn()} />,
      );

      await waitFor(() => {
        expect(previewRoot(container).textContent).toContain('┌──────────┐');
      });
      const text = previewRoot(container).textContent ?? '';
      // Runs of interior spaces must survive verbatim; collapsing them is the bug.
      expect(text).toContain('│  mesh    │');
      expect(text).toContain('│    node  │');
    });

    it('defaults to fit-width and drops the modifier when opened up', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <MicronPageEditor path="index.mu" initialContent=">Hi" onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeInTheDocument();
      });
      expect(previewRoot(container).className).toContain('nomad-micron-page--fit-width');

      await user.click(screen.getByRole('button', { name: 'nomadNetwork.openWidth' }));

      expect(previewRoot(container).className).not.toContain('nomad-micron-page--fit-width');
      expect(localStorage.getItem('mesh-client:nomadPageFitWidth')).toBe('false');
    });

    it('adopts the width preference already set by the browser', async () => {
      localStorage.setItem('mesh-client:nomadPageFitWidth', 'false');
      const { container } = render(
        <MicronPageEditor path="index.mu" initialContent=">Hi" onClose={vi.fn()} />,
      );
      await waitFor(() => {
        expect(screen.getByText('Hi')).toBeInTheDocument();
      });
      expect(previewRoot(container).className).not.toContain('nomad-micron-page--fit-width');
    });

    it('keeps preview links inert', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <MicronPageEditor
          path="index.mu"
          initialContent="`[Docs`/page/docs.mu]"
          onClose={vi.fn()}
        />,
      );
      await waitFor(() => {
        expect(screen.getByText('Docs')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Docs'));
      // No navigation surface exists in the editor; the click must simply do nothing.
      expect(previewRoot(container)).toBeInTheDocument();
      expect(screen.getByText('Docs')).toBeInTheDocument();
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <MicronPageEditor path="index.mu" initialContent=">Hi" canDelete onClose={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Hi')).toBeInTheDocument();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
