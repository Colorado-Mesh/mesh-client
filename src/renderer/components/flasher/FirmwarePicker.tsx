import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface FirmwarePickerProps {
  disabled?: boolean;
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export function FirmwarePicker({ disabled, file, onFileChange }: FirmwarePickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <label className="text-ink-400 block text-xs">
        {t('flasher.firmwareFile')}
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          disabled={disabled}
          aria-label={t('flasher.firmwareFile')}
          className="text-ink-300 file:bg-ink-700 file:text-ink-200 mt-1 block w-full text-sm file:mr-2 file:rounded file:border-0 file:px-2 file:py-1 file:text-xs"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            onFileChange(next);
          }}
        />
      </label>
      {file ? <p className="text-muted truncate text-xs">{file.name}</p> : null}
    </div>
  );
}
