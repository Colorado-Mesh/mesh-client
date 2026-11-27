import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ReachCheckServerInputError,
  readReachCheckServerInput,
} from '../lib/reachCheck/reachCheckServerInput';
import { INPUT_CLASS } from './ui/formClasses';

export interface ReachCheckServerFieldProps {
  id: string;
  /** Saved origin, or `''`. */
  value: string;
  /** Called with a checked origin, or `''` when the field is cleared. */
  onCommit: (origin: string) => void;
}

type FieldError = ReachCheckServerInputError;

/** The reach check server address input with its help text and inline error. */
export default function ReachCheckServerField({ id, value, onCommit }: ReachCheckServerFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [savedValue, setSavedValue] = useState(value);
  const [error, setError] = useState<FieldError | null>(null);
  // A new saved value from outside (another field, a reload) replaces the draft.
  if (value !== savedValue) {
    setSavedValue(value);
    setDraft(value);
    setError(null);
  }

  const commit = (): void => {
    const result = readReachCheckServerInput(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(result.origin);
    if (result.origin !== value) onCommit(result.origin);
  };

  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-ink-300 text-sm">
        {t('reachCheck.serverLabel')}
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        placeholder={t('reachCheck.serverPlaceholder')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={INPUT_CLASS}
      />
      <p id={helpId} className="text-muted text-xs">
        {t('reachCheck.serverHelp')}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-400">
          {error === 'not_public' ? t('reachCheck.serverNotPublic') : t('reachCheck.serverInvalid')}
        </p>
      ) : null}
    </div>
  );
}
