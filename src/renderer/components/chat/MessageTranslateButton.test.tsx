import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';

import { MessageTranslateButton } from './MessageTranslateButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
describe('Translate action', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it('has an accessible label, stops row actions and remains inert before opt-in', async () => {
    const api = resetTranslation({ ...translationStatus(false), enabled: false });
    const rowClick = vi.fn();
    const { container } = render(
      <div>
        <MessageTranslateButton messageKey="one" text="Bonjour à tous" />
      </div>,
    );
    document.body.addEventListener('click', rowClick);
    fireEvent.click(screen.getByRole('button', { name: 'chatTranslation.translate' }));
    expect(rowClick).not.toHaveBeenCalled();
    expect(api.translate).not.toHaveBeenCalled();
    document.body.removeEventListener('click', rowClick);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
