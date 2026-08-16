import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ReticulumVoiceMemoLine } from './ReticulumVoiceMemoLine';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// computeWaveformFromOgg needs decodeAudioData — stub out for unit tests
vi.mock('@/renderer/lib/reticulum/computeWaveform', () => ({
  computeWaveformFromOgg: vi.fn().mockResolvedValue({
    bars: new Array<number>(40).fill(0.5),
    durationSec: 3,
  }),
}));

const readReticulumAttachmentBytes = vi.fn();

beforeEach(() => {
  readReticulumAttachmentBytes.mockReset();
  readReticulumAttachmentBytes.mockResolvedValue({ dataBase64: null });
  window.electronAPI = {
    ...window.electronAPI,
    chat: {
      ...window.electronAPI?.chat,
      readReticulumAttachmentBytes: (...args: unknown[]) => readReticulumAttachmentBytes(...args),
    },
  };
});

async function renderAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
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

  it('passes axe with no violations', async () => {
    await renderAxe(<ReticulumVoiceMemoLine attachmentPath="/fake/memo.ogg" durationSec={2} />);
  });
});
