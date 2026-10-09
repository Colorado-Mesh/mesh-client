import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TAK_MATCH_OPS,
  TAK_TEAM_COLORS,
  TAK_TEAM_ROLES,
  TAK_UNIT_COT_TYPES,
  TAK_UNIT_FILTER_PATTERN_MAX_LEN,
  TAK_UNIT_FILTER_PATTERNS_MAX,
  TAK_UNIT_FILTERS_MAX,
  type TakMatchOp,
  type TakStyleSettings,
  type TakUnitFilter,
} from '@/shared/tak-types';
import { matchTakUnitFilter } from '@/shared/takUnitFilterMatch';

import { useTakStyleSettings } from '../hooks/useTakStyleSettings';
import {
  CHECKBOX_CLASS,
  INPUT_BOX_SM_CLASS,
  NOTICE_CLASS,
  SELECT_BOX_SM_CLASS,
} from './ui/formClasses';

const COT_TYPE_LABEL_KEYS: Record<(typeof TAK_UNIT_COT_TYPES)[number], string> = {
  'a-f-G-U-C': 'takServerPanel.unitTypeTeamMember',
  'a-f-G-U-C-I': 'takServerPanel.unitTypeInfantry',
  'a-f-G-U-C-R': 'takServerPanel.unitTypeRecon',
  'a-f-G-U-S-M': 'takServerPanel.unitTypeMedical',
  'a-f-G-E-V': 'takServerPanel.unitTypeVehicle',
  'a-f-G-I': 'takServerPanel.unitTypeInstallation',
  'a-f-G-E-S': 'takServerPanel.unitTypeSensor',
  'a-f-A': 'takServerPanel.unitTypeAir',
};

const OP_LABEL_KEYS: Record<TakMatchOp, string> = {
  equals: 'takServerPanel.unitFilterOpEquals',
  startsWith: 'takServerPanel.unitFilterOpStartsWith',
  endsWith: 'takServerPanel.unitFilterOpEndsWith',
  contains: 'takServerPanel.unitFilterOpContains',
};

const DEFAULT_COLOR = '#22C55E';

/** Editable filter row; patterns stay as typed until saved. */
interface DraftFilter {
  key: number;
  enabled: boolean;
  op: TakMatchOp;
  patternsText: string;
  stripMatch: boolean;
  cotType: string;
  group: string;
  role: string;
  color: string | null;
}

let nextDraftKey = 1;

function toDraft(filter: TakUnitFilter): DraftFilter {
  return {
    key: nextDraftKey++,
    enabled: filter.enabled,
    op: filter.op,
    patternsText: filter.patterns.join(', '),
    stripMatch: filter.stripMatch,
    cotType: filter.style.cotType,
    group: filter.style.group ?? '',
    role: filter.style.role ?? '',
    color: filter.style.color ?? null,
  };
}

function newDraft(): DraftFilter {
  return toDraft({
    enabled: true,
    op: 'startsWith',
    patterns: [],
    stripMatch: false,
    style: { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'Team Member' },
  });
}

function parsePatterns(text: string): string[] {
  return text
    .split(',')
    .map((p) => p.trim().slice(0, TAK_UNIT_FILTER_PATTERN_MAX_LEN))
    .filter((p) => p.length > 0)
    .slice(0, TAK_UNIT_FILTER_PATTERNS_MAX);
}

function fromDraft(d: DraftFilter): TakUnitFilter {
  return {
    enabled: d.enabled,
    op: d.op,
    patterns: parsePatterns(d.patternsText),
    stripMatch: d.stripMatch,
    style: {
      cotType: d.cotType,
      ...(d.group ? { group: d.group } : {}),
      ...(d.role ? { role: d.role } : {}),
      ...(d.color ? { color: d.color } : {}),
    },
  };
}

interface RowProps {
  index: number;
  draft: DraftFilter;
  disabled: boolean;
  onChange: (next: DraftFilter) => void;
  onRemove: () => void;
}

function FilterRow({ index, draft, disabled, onChange, onRemove }: RowProps) {
  const { t } = useTranslation();
  const id = useId();
  const n = index + 1;
  const set = (patch: Partial<DraftFilter>) => {
    onChange({ ...draft, ...patch });
  };
  const stripApplies = draft.op === 'startsWith' || draft.op === 'endsWith';

  return (
    <li className="border-ink-800 space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => {
            set({ enabled: e.target.checked });
          }}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterEnabled', { n })}
          className={CHECKBOX_CLASS}
        />
        <span className="text-ink-300 text-xs font-medium">
          {t('takServerPanel.unitFilterHeading', { n })}
        </span>
        <select
          value={draft.op}
          onChange={(e) => {
            set({ op: e.target.value as TakMatchOp });
          }}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterOp', { n })}
          className={SELECT_BOX_SM_CLASS}
        >
          {TAK_MATCH_OPS.map((op) => (
            <option key={op} value={op}>
              {t(OP_LABEL_KEYS[op])}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={draft.patternsText}
          onChange={(e) => {
            set({ patternsText: e.target.value });
          }}
          disabled={disabled}
          maxLength={TAK_UNIT_FILTER_PATTERNS_MAX * (TAK_UNIT_FILTER_PATTERN_MAX_LEN + 2)}
          spellCheck={false}
          placeholder={t('takServerPanel.unitFilterPatternsPlaceholder')}
          aria-label={t('takServerPanel.unitFilterPatterns', { n })}
          className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1 basis-40`}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterRemove', { n })}
          className="text-ink-400 rounded-control px-2 py-1 text-xs hover:text-red-300 disabled:opacity-50"
        >
          {t('takServerPanel.unitFilterRemoveShort')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={draft.cotType}
          onChange={(e) => {
            set({ cotType: e.target.value });
          }}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterType', { n })}
          className={SELECT_BOX_SM_CLASS}
        >
          {TAK_UNIT_COT_TYPES.map((atom) => (
            <option key={atom} value={atom}>
              {t(COT_TYPE_LABEL_KEYS[atom])}
            </option>
          ))}
        </select>
        <select
          value={draft.group}
          onChange={(e) => {
            set({ group: e.target.value });
          }}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterTeam', { n })}
          className={SELECT_BOX_SM_CLASS}
        >
          <option value="">{t('takServerPanel.unitFilterNoTeam')}</option>
          {TAK_TEAM_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={draft.role}
          onChange={(e) => {
            set({ role: e.target.value });
          }}
          disabled={disabled}
          aria-label={t('takServerPanel.unitFilterRole', { n })}
          className={SELECT_BOX_SM_CLASS}
        >
          <option value="">{t('takServerPanel.unitFilterNoRole')}</option>
          {TAK_TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-color-on`} className="text-ink-300 flex items-center gap-1 text-xs">
          <input
            id={`${id}-color-on`}
            type="checkbox"
            checked={draft.color !== null}
            onChange={(e) => {
              set({ color: e.target.checked ? DEFAULT_COLOR : null });
            }}
            disabled={disabled}
            className={CHECKBOX_CLASS}
          />
          {t('takServerPanel.unitFilterColor')}
        </label>
        {draft.color !== null && (
          <input
            type="color"
            value={draft.color}
            onChange={(e) => {
              set({ color: e.target.value.toUpperCase() });
            }}
            disabled={disabled}
            aria-label={t('takServerPanel.unitFilterColorPick', { n })}
            className="rounded-control border-ink-600 h-7 w-10 border"
          />
        )}
        {stripApplies && (
          <label htmlFor={`${id}-strip`} className="text-ink-300 flex items-center gap-1 text-xs">
            <input
              id={`${id}-strip`}
              type="checkbox"
              checked={draft.stripMatch}
              onChange={(e) => {
                set({ stripMatch: e.target.checked });
              }}
              disabled={disabled}
              className={CHECKBOX_CLASS}
            />
            {t('takServerPanel.unitFilterStrip')}
          </label>
        )}
      </div>
    </li>
  );
}

interface FormProps {
  initial: TakStyleSettings;
  isSaving: boolean;
  onSave: (settings: TakStyleSettings) => Promise<boolean>;
}

function UnitFiltersForm({ initial, isSaving, onSave }: FormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [drafts, setDrafts] = useState<DraftFilter[]>(() => initial.filters.map(toDraft));
  const [sendUnmatched, setSendUnmatched] = useState(initial.sendUnmatched);
  const [previewName, setPreviewName] = useState('');
  const [saved, setSaved] = useState(false);

  const filters = useMemo(() => drafts.map(fromDraft), [drafts]);
  const preview = useMemo(() => {
    const name = previewName.trim();
    if (!name) return null;
    const match = matchTakUnitFilter(filters, name, name);
    if (match) {
      return t('takServerPanel.unitStylesPreviewMatch', {
        n: match.index + 1,
        callsign: match.callsign,
      });
    }
    return sendUnmatched
      ? t('takServerPanel.unitStylesPreviewAdvertised')
      : t('takServerPanel.unitStylesPreviewDropped');
  }, [filters, previewName, sendUnmatched, t]);

  const update = (key: number, next: DraftFilter) => {
    setSaved(false);
    setDrafts((prev) => prev.map((d) => (d.key === key ? next : d)));
  };

  const handleSave = async () => {
    setSaved(false);
    if (await onSave({ filters, sendUnmatched })) setSaved(true);
  };

  return (
    <div className="space-y-3">
      <div data-setting-anchor="tak.styles.sendUnmatched" className="flex items-center gap-2">
        <input
          id={`${id}-unmatched`}
          type="checkbox"
          checked={sendUnmatched}
          onChange={(e) => {
            setSaved(false);
            setSendUnmatched(e.target.checked);
          }}
          disabled={isSaving}
          className={CHECKBOX_CLASS}
        />
        <label htmlFor={`${id}-unmatched`} className="text-ink-300 cursor-pointer text-sm">
          {t('takServerPanel.unitStylesSendUnmatched')}
        </label>
      </div>

      {drafts.length > 0 && (
        <ol className="space-y-2">
          {drafts.map((d, index) => (
            <FilterRow
              key={d.key}
              index={index}
              draft={d}
              disabled={isSaving}
              onChange={(next) => {
                update(d.key, next);
              }}
              onRemove={() => {
                setSaved(false);
                setDrafts((prev) => prev.filter((x) => x.key !== d.key));
              }}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-setting-anchor="tak.styles.addFilter"
          onClick={() => {
            setSaved(false);
            setDrafts((prev) => [...prev, newDraft()]);
          }}
          disabled={isSaving || drafts.length >= TAK_UNIT_FILTERS_MAX}
          aria-label={t('takServerPanel.unitStylesAddFilter')}
          className="bg-secondary-dark border-ink-600 text-ink-200 hover:border-ink-500 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {t('takServerPanel.unitStylesAddFilter')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          aria-label={t('takServerPanel.unitStylesSave')}
          className="bg-brand-green hover:bg-brand-green/90 text-app-bg rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {t('takServerPanel.unitStylesSave')}
        </button>
        {saved && (
          <span className="text-xs text-green-400">{t('takServerPanel.unitStylesSaved')}</span>
        )}
      </div>

      <div>
        <label htmlFor={`${id}-preview`} className="text-ink-400 mb-1 block text-xs">
          {t('takServerPanel.unitStylesPreviewLabel')}
        </label>
        <input
          id={`${id}-preview`}
          type="text"
          value={previewName}
          onChange={(e) => {
            setPreviewName(e.target.value);
          }}
          maxLength={256}
          spellCheck={false}
          className={`${INPUT_BOX_SM_CLASS} w-full max-w-xs`}
        />
        {preview && (
          <p className="text-ink-400 mt-1 text-xs" aria-live="polite">
            {preview}
          </p>
        )}
      </div>
    </div>
  );
}

/** User unit filters over each relayed node's advertised role; applied in main to every sink. */
export default function TakUnitFiltersSection() {
  const { t } = useTranslation();
  const { settings, isSaving, error, save } = useTakStyleSettings();
  return (
    <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
      <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.unitStylesTitle')}</h3>
      <p className="text-ink-400 text-xs">{t('takServerPanel.unitStylesDesc')}</p>
      {error && <div className={NOTICE_CLASS.error}>{error}</div>}
      {settings !== undefined && (
        <UnitFiltersForm initial={settings} isSaving={isSaving} onSave={save} />
      )}
    </div>
  );
}
