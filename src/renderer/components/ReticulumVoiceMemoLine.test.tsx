import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumVoiceMemoLine } from './ReticulumVoiceMemoLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/lib/reticulum/computeWaveform', () => ({
  computeWaveform: vi.fn().mockReturnValue(new Array<number>(40).fill(0.5)),
}));

const readReticulumAttachmentBytes = vi.fn();

class MockAudioBuffer {
  duration = 3;
  getChannelData = () => new Float32Array(48000);
}

beforeEach(() => {
  readReticulumAttachmentBytes.mockReset();
  readReticulumAttachmentBytes.mockResolvedValue({ dataBase64: btoa('fake-ogg') });
  window.electronAPI = {
    ...window.electronAPI,
    chat: {
      ...window.electronAPI?.chat,
      readReticulumAttachmentBytes: (...args: unknown[]) => readReticulumAttachmentBytes(...args),
    },
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      currentTime = 0;
      destination = {};
      close = vi.fn().mockResolvedValue(undefined);
      resume = vi.fn().mockResolvedValue(undefined);
      createBufferSource = () => ({
        buffer: null as MockAudioBuffer | null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      });
      decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer());
    },
  );
});

async function renderAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'chatPanel.voiceMemo.playAria' })).toBeEnabled();
  });
  expect(await axe(view.container)).toHaveNoViolations();
  return view;
}

describe('ReticulumVoiceMemoLine', () => {
  it('renders play button and seek control', async () => {
    await renderAxe(
      <ReticulumVoiceMemoLine attachmentPath="/fake/memo.ogg" durationSec={4} audioMode={16} />,
    );
    expect(screen.getByRole('button', { name: 'chatPanel.voiceMemo.playAria' })).toBeDefined();
    expect(screen.getByRole('slider', { name: 'chatPanel.voiceMemo.seekAria' })).toBeDefined();
  });

  it('loads attachment bytes and enables playback', async () => {
    render(
      <ReticulumVoiceMemoLine attachmentPath="/fake/memo.ogg" durationSec={4} audioMode={16} />,
    );
    await waitFor(() => {
      expect(readReticulumAttachmentBytes).toHaveBeenCalledWith('/fake/memo.ogg');
      expect(screen.getByRole('button', { name: 'chatPanel.voiceMemo.playAria' })).toBeEnabled();
    });
  });

  it('passes axe with no violations', async () => {
    await renderAxe(<ReticulumVoiceMemoLine attachmentPath="/fake/memo.ogg" durationSec={2} />);
  });
});
