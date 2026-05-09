/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MeshCoreContactRaw, MeshCoreSelfInfo } from '../hooks/useMeshCore';
import {
  countMeshcoreContactsWithFlagMask,
  MESHCORE_CONTACT_FLAG_TELEM_BASE,
  MESHCORE_CONTACT_FLAG_TELEM_ENVIRONMENT,
  MESHCORE_CONTACT_FLAG_TELEM_LOCATION,
  meshcoreTelemetryModeToTriState,
  type MeshcoreTelemetryTriState,
  meshcoreTriStateToTelemetryMode,
} from '../lib/meshcoreTelemetryPrivacy';

function TriStateRow({
  title,
  groupName,
  value,
  onChange,
  disabled,
  specificLabel,
  specificCount,
  specificPermissionPhraseKey,
  yesDescription,
  noDescription,
  yesLabel,
  noLabel,
}: {
  title: string;
  groupName: string;
  value: MeshcoreTelemetryTriState;
  onChange: (v: MeshcoreTelemetryTriState) => void;
  disabled: boolean;
  specificLabel: string;
  specificCount: number;
  /** i18n key under meshcoreTelemetryPrivacy for the trailing permission phrase */
  specificPermissionPhraseKey:
    | 'baseTelemetryPermission'
    | 'locationPermission'
    | 'environmentPermission';
  yesDescription: string;
  noDescription: string;
  yesLabel: string;
  noLabel: string;
}) {
  const { t } = useTranslation();
  const permissionPhrase = t(`meshcoreTelemetryPrivacy.${specificPermissionPhraseKey}`);
  const specificSub = `${t('meshcoreTelemetryPrivacy.contactCount', { count: specificCount })} ${permissionPhrase}`;

  const options: { id: MeshcoreTelemetryTriState; label: string; sub: string }[] = [
    { id: 'deny', label: noLabel, sub: noDescription },
    { id: 'allow_all', label: yesLabel, sub: yesDescription },
    {
      id: 'allow_flags',
      label: specificLabel,
      sub: specificSub,
    },
  ];

  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-600/80 p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium text-gray-200">{title}</legend>
      <div className="space-y-3">
        {options.map((opt) => {
          const inputId = `${groupName}-${opt.id}`;
          return (
            <div
              key={opt.id}
              className={`hover:bg-secondary-dark/50 flex gap-2 rounded-md p-1.5 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                id={inputId}
                type="radio"
                name={groupName}
                value={opt.id}
                checked={value === opt.id}
                onChange={() => {
                  onChange(opt.id);
                }}
                disabled={disabled}
                className="mt-1"
              />
              <label
                htmlFor={inputId}
                className={`flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 ${disabled ? 'cursor-not-allowed' : ''}`}
              >
                <span className="text-sm text-gray-200">{opt.label}</span>
                <span className="text-muted text-xs">{opt.sub}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function MeshcoreTelemetryPrivacySection({
  selfInfo,
  contacts,
  disabled,
  applying,
  onApply,
}: {
  selfInfo: MeshCoreSelfInfo;
  contacts: MeshCoreContactRaw[];
  disabled: boolean;
  applying: boolean;
  onApply: (modes: {
    telemetryModeBase: number;
    telemetryModeLoc: number;
    telemetryModeEnv: number;
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [base, setBase] = useState<MeshcoreTelemetryTriState>(() =>
    meshcoreTelemetryModeToTriState(selfInfo.telemetryModeBase),
  );
  const [loc, setLoc] = useState<MeshcoreTelemetryTriState>(() =>
    meshcoreTelemetryModeToTriState(selfInfo.telemetryModeLoc),
  );
  const [env, setEnv] = useState<MeshcoreTelemetryTriState>(() =>
    meshcoreTelemetryModeToTriState(selfInfo.telemetryModeEnv),
  );

  useEffect(() => {
    setBase(meshcoreTelemetryModeToTriState(selfInfo.telemetryModeBase));
    setLoc(meshcoreTelemetryModeToTriState(selfInfo.telemetryModeLoc));
    setEnv(meshcoreTelemetryModeToTriState(selfInfo.telemetryModeEnv));
  }, [selfInfo.telemetryModeBase, selfInfo.telemetryModeLoc, selfInfo.telemetryModeEnv]);

  const cBase = countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_BASE);
  const cLoc = countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_LOCATION);
  const cEnv = countMeshcoreContactsWithFlagMask(contacts, MESHCORE_CONTACT_FLAG_TELEM_ENVIRONMENT);

  const dirty =
    meshcoreTriStateToTelemetryMode(base) !== selfInfo.telemetryModeBase ||
    meshcoreTriStateToTelemetryMode(loc) !== selfInfo.telemetryModeLoc ||
    meshcoreTriStateToTelemetryMode(env) !== selfInfo.telemetryModeEnv;

  const yes = t('common.yes');
  const no = t('common.no');

  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{t('meshcoreTelemetryPrivacy.summary')}</span>
        <svg
          className="text-muted h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-muted text-xs">{t('meshcoreTelemetryPrivacy.description')}</p>
        <TriStateRow
          title={t('meshcoreTelemetryPrivacy.allowTelemetryTitle')}
          groupName="meshcore-telem-req"
          value={base}
          onChange={setBase}
          disabled={disabled || applying}
          specificLabel={t('meshcoreTelemetryPrivacy.fromSpecificContacts')}
          specificCount={cBase}
          specificPermissionPhraseKey="baseTelemetryPermission"
          yesDescription={t('meshcoreTelemetryPrivacy.allowAllBase')}
          noDescription={t('meshcoreTelemetryPrivacy.denyBase')}
          yesLabel={yes}
          noLabel={no}
        />
        <TriStateRow
          title={t('meshcoreTelemetryPrivacy.includeLocationTitle')}
          groupName="meshcore-telem-loc"
          value={loc}
          onChange={setLoc}
          disabled={disabled || applying}
          specificLabel={t('meshcoreTelemetryPrivacy.forSpecificContacts')}
          specificCount={cLoc}
          specificPermissionPhraseKey="locationPermission"
          yesDescription={t('meshcoreTelemetryPrivacy.allowAllLoc')}
          noDescription={t('meshcoreTelemetryPrivacy.denyLoc')}
          yesLabel={yes}
          noLabel={no}
        />
        <TriStateRow
          title={t('meshcoreTelemetryPrivacy.includeEnvironmentTitle')}
          groupName="meshcore-telem-env"
          value={env}
          onChange={setEnv}
          disabled={disabled || applying}
          specificLabel={t('meshcoreTelemetryPrivacy.forSpecificContacts')}
          specificCount={cEnv}
          specificPermissionPhraseKey="environmentPermission"
          yesDescription={t('meshcoreTelemetryPrivacy.allowAllEnv')}
          noDescription={t('meshcoreTelemetryPrivacy.denyEnv')}
          yesLabel={yes}
          noLabel={no}
        />
        <button
          type="button"
          disabled={disabled || applying || !dirty}
          onClick={() =>
            void onApply({
              telemetryModeBase: meshcoreTriStateToTelemetryMode(base),
              telemetryModeLoc: meshcoreTriStateToTelemetryMode(loc),
              telemetryModeEnv: meshcoreTriStateToTelemetryMode(env),
            })
          }
          className="bg-brand-green rounded-lg px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {applying
            ? t('meshcoreTelemetryPrivacy.applying')
            : t('meshcoreTelemetryPrivacy.applyButton')}
        </button>
      </div>
    </details>
  );
}
