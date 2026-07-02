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
      <label className="block text-xs text-gray-400">
        {t('flasher.firmwareFile')}
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          disabled={disabled}
          aria-label={t('flasher.firmwareFile')}
          className="mt-1 block w-full text-sm text-gray-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-gray-200"
          onChange={(e) => {
            const next = e.target.files?.[0] ?? null;
            onFileChange(next);
          }}
        />
      </label>
      {file ? <p className="truncate text-xs text-gray-500">{file.name}</p> : null}
    </div>
  );
}
