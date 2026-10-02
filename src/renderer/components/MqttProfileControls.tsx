import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MQTT_PROFILE_NAME_MAX_LENGTH, type MqttProfile } from '../lib/mqttProfiles';
import { Button } from './ui/Button';
import { INPUT_BOX_SM_CLASS } from './ui/formClasses';

interface Props {
  /** Saved profile matching the current settings, when one does. */
  activeProfile: MqttProfile | undefined;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** Save / rename / delete for Meshtastic MQTT profiles; names are typed inline. */
export function MqttProfileControls({ activeProfile, onSave, onRename, onDelete }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'idle' | 'save' | 'rename'>('idle');
  const [name, setName] = useState('');

  const close = () => {
    setMode('idle');
    setName('');
  };
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode === 'rename' && activeProfile) onRename(activeProfile.id, trimmed);
    else onSave(trimmed);
    close();
  };

  if (mode !== 'idle') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1`}
          value={name}
          maxLength={MQTT_PROFILE_NAME_MAX_LENGTH}
          placeholder={t('mqttProfiles.namePlaceholder')}
          aria-label={t('mqttProfiles.nameAria')}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- field appears only after the user asks to name a profile
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') close();
          }}
        />
        <Button
          size="sm"
          variant="primary"
          disabled={!name.trim()}
          aria-label={t('common.save')}
          onClick={submit}
        >
          {t('common.save')}
        </Button>
        <Button size="sm" aria-label={t('common.cancel')} onClick={close}>
          {t('common.cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        aria-label={t('mqttProfiles.save')}
        onClick={() => {
          setMode('save');
        }}
      >
        {t('mqttProfiles.save')}
      </Button>
      {activeProfile ? (
        <>
          <Button
            size="sm"
            aria-label={t('mqttProfiles.renameAria', { name: activeProfile.name })}
            onClick={() => {
              setName(activeProfile.name);
              setMode('rename');
            }}
          >
            {t('mqttProfiles.rename')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            aria-label={t('mqttProfiles.deleteAria', { name: activeProfile.name })}
            onClick={() => {
              onDelete(activeProfile.id);
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
