import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { compileWeatherPattern, WEATHER_PATTERN_MAX_LENGTH } from '../../lib/weatherPosts';
import { useWeatherFilterStore } from '../../stores/weatherFilterStore';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from '../ui/formClasses';

/** Inline settings for the Chat Weather view: hide-in-channels and an optional extra pattern. */
export function WeatherFilterSettings() {
  const { t } = useTranslation();
  const hideInChannels = useWeatherFilterStore((s) => s.hideInChannels);
  const setHideInChannels = useWeatherFilterStore((s) => s.setHideInChannels);
  const pattern = useWeatherFilterStore((s) => s.pattern);
  const setPattern = useWeatherFilterStore((s) => s.setPattern);
  const [draft, setDraft] = useState(pattern);
  const draftInvalid = compileWeatherPattern(draft) === 'invalid';

  const commit = () => {
    if (draft !== pattern) setPattern(draft);
  };

  return (
    <div
      className="mb-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="weather-filter-settings"
    >
      <label className="text-muted flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={hideInChannels}
          onChange={(e) => {
            setHideInChannels(e.target.checked);
          }}
        />
        {t('weatherFilter.hideInChannels')}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
        <input
          type="text"
          className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1 font-mono`}
          value={draft}
          maxLength={WEATHER_PATTERN_MAX_LENGTH}
          placeholder={t('weatherFilter.patternPlaceholder')}
          aria-label={t('weatherFilter.patternAria')}
          aria-invalid={draftInvalid}
          aria-describedby={draftInvalid ? 'weather-pattern-error' : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        {draftInvalid ? (
          <span id="weather-pattern-error" role="alert" className="text-xs text-red-400">
            {t('weatherFilter.patternInvalid')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
