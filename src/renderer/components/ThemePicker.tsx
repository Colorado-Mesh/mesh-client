import { Check } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { ICON_SM } from '@/renderer/lib/icons/iconClass';
import type { ThemeColorKey } from '@/renderer/lib/themeColors';
import {
  matchThemeAccent,
  matchThemeSurface,
  THEME_ACCENTS,
  THEME_SURFACES,
  type ThemeAccent,
  type ThemeSurface,
  type ThemeSurfaceId,
} from '@/renderer/lib/themePresets';

export interface ThemePickerProps {
  colors: Record<ThemeColorKey, string>;
  surfaceId: ThemeSurfaceId;
  onSurfaceSelect: (surface: ThemeSurface) => void;
  onAccentSelect: (accent: ThemeAccent) => void;
}

/**
 * The surface's steps as bands (950 to 700, the order they stack in the app), with primary and
 * muted text lines and the current accent on top.
 */
function SurfaceSwatch({ surface, accent }: { surface: ThemeSurface; accent: string }) {
  const s = surface.scale;
  return (
    <span
      aria-hidden="true"
      className="rounded-control relative block h-12 overflow-hidden"
      style={{ backgroundColor: s[950], boxShadow: `inset 0 0 0 1px ${s[800]}` }}
    >
      <span className="absolute inset-y-0 right-0 left-1/4" style={{ backgroundColor: s[900] }} />
      <span className="absolute inset-y-0 right-0 left-1/2" style={{ backgroundColor: s[800] }} />
      <span className="absolute inset-y-0 right-0 left-3/4" style={{ backgroundColor: s[700] }} />
      <span
        className="absolute top-2.5 left-2 h-1.5 w-7 rounded-full"
        style={{ backgroundColor: s[200] }}
      />
      <span
        className="absolute top-5 left-2 h-1 w-5 rounded-full"
        style={{ backgroundColor: s[400] }}
      />
      <span
        className="absolute bottom-2 left-2 h-1.5 w-6 rounded-full"
        style={{ backgroundColor: accent }}
      />
    </span>
  );
}

/** App > Appearance > Colors: surfaces (the neutral family) and an accent, picked separately. */
export function ThemePicker({
  colors,
  surfaceId,
  onSurfaceSelect,
  onAccentSelect,
}: ThemePickerProps) {
  const { t } = useTranslation();
  const activeSurface = matchThemeSurface(colors, surfaceId);
  const activeAccent = matchThemeAccent(colors);

  return (
    <>
      <section aria-labelledby="app-theme-surfaces-heading" className="space-y-2">
        <div>
          <h4 id="app-theme-surfaces-heading" className="text-ink-200 text-sm font-medium">
            {t('appPanel.themePresets.heading')}
          </h4>
          <p className="text-muted text-xs">
            {activeSurface === null || activeAccent === null
              ? t('appPanel.themePresets.custom')
              : t('appPanel.themePresets.hint')}
          </p>
        </div>
        <div
          role="group"
          aria-labelledby="app-theme-surfaces-heading"
          className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2"
        >
          {THEME_SURFACES.map((surface) => {
            const active = activeSurface === surface.id;
            return (
              <button
                key={surface.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSurfaceSelect(surface);
                }}
                className={`rounded-card flex flex-col gap-2 border p-2 text-left transition-colors ${
                  active
                    ? 'border-brand-green/50 bg-brand-green/10'
                    : 'bg-deep-black border-ink-800 hover:border-secondary-dark'
                }`}
              >
                <SurfaceSwatch surface={surface} accent={colors.brandGreen} />
                <span className="flex items-center justify-between gap-2">
                  <span className="text-body text-ink-200 font-medium">{t(surface.labelKey)}</span>
                  {active && <Check aria-hidden className={`${ICON_SM} text-bright-green`} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="app-theme-accents-heading" className="space-y-2">
        <h4 id="app-theme-accents-heading" className="text-ink-200 text-sm font-medium">
          {t('appPanel.themeAccents.heading')}
        </h4>
        <div
          role="group"
          aria-labelledby="app-theme-accents-heading"
          className="flex flex-wrap gap-2"
        >
          {THEME_ACCENTS.map((accent) => {
            const active = activeAccent === accent.id;
            return (
              <button
                key={accent.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onAccentSelect(accent);
                }}
                className={`rounded-control text-control flex h-8 items-center gap-2 border px-2.5 font-medium transition-colors ${
                  active
                    ? 'border-brand-green/50 bg-brand-green/10 text-ink-100'
                    : 'border-ink-700 text-ink-300 hover:border-secondary-dark hover:text-ink-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: accent.base,
                    boxShadow: `inset 0 0 0 1px ${accent.fill}`,
                  }}
                />
                {t(accent.labelKey)}
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
