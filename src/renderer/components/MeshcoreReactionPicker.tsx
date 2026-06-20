import { useTranslation } from 'react-i18next';

import { MESHCORE_OPEN_REACTION_EMOJIS } from '../lib/meshcoreOpenReaction';

interface MeshcoreReactionPickerProps {
  onSelect: (glyph: string) => void;
  className?: string;
}

export function MeshcoreReactionPicker({ onSelect, className }: MeshcoreReactionPickerProps) {
  const { t } = useTranslation();

  return (
    <div
      data-testid="meshcore-reaction-picker"
      aria-label={t('chatPanel.meshcoreReactionPickerLabel')}
      className={`rounded-md border border-slate-600 bg-slate-800 p-2 shadow-lg ${className ?? ''}`}
    >
      <div className="max-h-48 w-72 overflow-y-auto">
        <div className="grid grid-cols-8 gap-0.5">
          {MESHCORE_OPEN_REACTION_EMOJIS.map((glyph, idx) => (
            <button
              key={`${idx}-${glyph}`}
              type="button"
              className="rounded p-1 text-lg hover:bg-slate-700 focus:ring-1 focus:ring-green-400 focus:outline-none"
              aria-label={t('chatPanel.meshcoreReactionEmojiOption', { emoji: glyph })}
              onClick={() => {
                onSelect(glyph);
              }}
            >
              {glyph}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
