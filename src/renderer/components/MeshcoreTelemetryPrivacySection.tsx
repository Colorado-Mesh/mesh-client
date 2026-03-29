import { useEffect, useState } from 'react';

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
  specificDescription,
  yesDescription,
  noDescription,
}: {
  title: string;
  groupName: string;
  value: MeshcoreTelemetryTriState;
  onChange: (v: MeshcoreTelemetryTriState) => void;
  disabled: boolean;
  specificLabel: string;
  specificCount: number;
  specificDescription: string;
  yesDescription: string;
  noDescription: string;
}) {
  const options: { id: MeshcoreTelemetryTriState; label: string; sub: string }[] = [
    { id: 'deny', label: 'No', sub: noDescription },
    { id: 'allow_all', label: 'Yes', sub: yesDescription },
    {
      id: 'allow_flags',
      label: specificLabel,
      sub:
        specificCount === 1
          ? `1 contact ${specificDescription}`
          : `${specificCount} contacts ${specificDescription}`,
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
              className={`flex gap-2 rounded-md p-1.5 hover:bg-secondary-dark/50 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
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
                <span className="text-xs text-muted">{opt.sub}</span>
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

  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="px-4 py-3 cursor-pointer text-gray-200 font-medium flex items-center justify-between hover:bg-gray-800 rounded-lg transition-colors">
        <span>Telemetry privacy</span>
        <svg
          className="w-4 h-4 text-muted group-open:rotate-180 transition-transform"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 space-y-4">
        <p className="text-xs text-muted">
          Controls how your node responds to telemetry requests and what data is included (MeshCore
          companion firmware). Per-contact permissions apply when you choose &quot;specific
          contacts&quot;; edit contact flags from the reference MeshCore apps or a future contact
          detail UI.
        </p>
        <TriStateRow
          title="Allow telemetry requests?"
          groupName="meshcore-telem-req"
          value={base}
          onChange={setBase}
          disabled={disabled || applying}
          specificLabel="From specific contacts"
          specificCount={cBase}
          specificDescription="have the base telemetry permission"
          yesDescription="Telemetry requests will be allowed from everyone."
          noDescription="Telemetry requests will be ignored."
        />
        <TriStateRow
          title="Include location in your telemetry?"
          groupName="meshcore-telem-loc"
          value={loc}
          onChange={setLoc}
          disabled={disabled || applying}
          specificLabel="For specific contacts"
          specificCount={cLoc}
          specificDescription="have the telemetry location permission"
          yesDescription="Location will be included in your telemetry."
          noDescription="Location will be excluded from your telemetry."
        />
        <TriStateRow
          title="Include environment in your telemetry?"
          groupName="meshcore-telem-env"
          value={env}
          onChange={setEnv}
          disabled={disabled || applying}
          specificLabel="For specific contacts"
          specificCount={cEnv}
          specificDescription="have the environment sensors permission"
          yesDescription="Environment sensors will be included in your telemetry."
          noDescription="Environment sensors will be excluded from your telemetry."
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
          className="rounded-lg bg-brand-green px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply telemetry privacy'}
        </button>
      </div>
    </details>
  );
}
