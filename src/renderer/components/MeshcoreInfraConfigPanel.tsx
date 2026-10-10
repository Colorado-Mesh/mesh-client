import {
  ArrowLeft,
  Check,
  MapPin,
  MessageSquare,
  Network,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react-motion';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';

import { translateMeshcoreUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import {
  applyInfraConfig,
  assertInfraConfigCommandOk,
  INFRA_CONFIG_FIELDS,
  type InfraConfigField,
  type InfraConfigIsCurrent,
  type InfraConfigSection,
  type InfraConfigSend,
  type InfraConfigSnapshot,
  infraConfigValueMatches,
  type InfraConfigValues,
  readInfraConfig,
} from '../lib/meshcoreInfraConfig';
import {
  type MeshcoreRoomAclEntry,
  meshcoreRoomAclLevelLabel,
  parseMeshcoreRoomAclResponse,
} from '../lib/meshcoreRoomAclParser';
import type { MeshNode } from '../lib/types';
import { MeshcoreRoomAclControls } from './MeshcoreRoomAclControls';
import { Button } from './ui/Button';
import {
  CHECKBOX_CLASS,
  FIELD_LABEL_CLASS,
  INPUT_CLASS,
  NOTICE_CLASS,
  SELECT_CLASS,
} from './ui/formClasses';
import { StatusDot } from './ui/StatusDot';

interface Props {
  node: MeshNode;
  isConnected: boolean;
  onSend: InfraConfigSend;
  onBack: () => void;
  onOpenCli: () => void;
}

type RunOperation = (id: string, operation: () => Promise<void>) => Promise<boolean>;
interface ConfigStatus {
  kind: 'info' | 'success' | 'error';
  message: string;
  connectionToken?: symbol;
}

const SECTION_LABELS: Record<InfraConfigSection, string> = {
  identity: 'infraConfig.identity',
  radio: 'infraConfig.radio',
  routing: 'infraConfig.routing',
  scope: 'infraConfig.scope',
  room: 'infraConfig.room',
};

const SECTION_ICONS = {
  identity: MapPin,
  radio: RadioTower,
  routing: Network,
  scope: Network,
  room: MessageSquare,
};
const SECTION_DESCRIPTIONS: Record<InfraConfigSection, string> = {
  identity: 'infraConfig.identitySummary',
  radio: 'infraConfig.radioSummary',
  routing: 'infraConfig.routingSummary',
  scope: 'infraConfig.scopeSummary',
  room: 'infraConfig.roomSummary',
};

function SectionHeading({
  title,
  description,
  icon,
  badge,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <summary className="text-ink-200 hover:bg-sidebar-active-bg grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-4 transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <span className="bg-app-bg text-muted rounded-control flex h-10 w-10 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 wrap-anywhere">
        <span className="block font-medium">{title}</span>
        <span className="text-muted mt-0.5 block text-xs">{description}</span>
      </span>
      {badge && (
        <span className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1">
          {badge}
        </span>
      )}
      <span className="col-start-3 row-start-1 sm:col-start-4">
        <DetailsChevron />
      </span>
    </summary>
  );
}

function Status({ status }: { status: ConfigStatus | null }) {
  if (!status) return null;
  return (
    <p role={status.kind === 'error' ? 'alert' : 'status'} className={NOTICE_CLASS[status.kind]}>
      {status.message}
    </p>
  );
}

function ConfigField({
  field,
  value,
  disabled,
  unavailable,
  changed,
  onChange,
}: {
  field: InfraConfigField;
  value: string;
  disabled: boolean;
  unavailable: boolean;
  changed: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(field.label);
  return (
    <label className="space-y-1.5">
      <span className={`${FIELD_LABEL_CLASS} flex items-center justify-between gap-2`}>
        <span>{label}</span>
        {changed && (
          <span className="inline-flex items-center gap-1 text-xs text-orange-300">
            <SlidersHorizontal aria-hidden size={12} />
            {t('infraConfig.edited')}
          </span>
        )}
      </span>
      {field.type === 'boolean' ? (
        <input
          type="checkbox"
          aria-label={label}
          checked={value === 'on'}
          disabled={disabled}
          className={CHECKBOX_CLASS}
          onChange={(event) => {
            onChange(event.target.checked ? 'on' : 'off');
          }}
        />
      ) : field.type === 'select' ? (
        <select
          aria-label={label}
          value={value}
          disabled={disabled}
          className={SELECT_CLASS}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {!value && <option value="">{t('infraConfig.notLoaded')}</option>}
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {field.key === 'path.hash.mode' ? Number(option) + 1 : option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type}
          aria-label={label}
          value={value}
          disabled={disabled}
          min={field.min}
          max={field.max}
          step={field.integer ? 1 : 'any'}
          autoComplete="off"
          className={INPUT_CLASS}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
      {unavailable && (
        <span className="text-muted block text-xs">{t('infraConfig.unsupported')}</span>
      )}
    </label>
  );
}

function ConfigSection({
  section,
  busy,
  connected,
  send,
  isCurrent,
  isAlive,
  connectionToken,
  run,
}: {
  section: InfraConfigSection;
  busy: boolean;
  connected: boolean;
  send: InfraConfigSend;
  isCurrent: InfraConfigIsCurrent;
  isAlive: () => boolean;
  connectionToken: symbol;
  run: RunOperation;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<InfraConfigSnapshot | null>(null);
  const [edited, setEdited] = useState<InfraConfigValues>({});
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [rebootRequired, setRebootRequired] = useState(false);
  const title = t(SECTION_LABELS[section]);
  const fields = INFRA_CONFIG_FIELDS[section];
  const changedCount =
    snapshot == null ? 0 : fields.filter(({ key }) => edited[key] !== snapshot.values[key]).length;
  const dirty = changedCount > 0;
  const SectionIcon = SECTION_ICONS[section];

  const load = useCallback(
    () =>
      run(section, async () => {
        setStatus({ kind: 'info', message: t('infraConfig.loading'), connectionToken });
        try {
          const next = await readInfraConfig(section, send, isCurrent);
          if (!isCurrent()) return;
          setSnapshot(next);
          setEdited(next.values);
          setStatus(null);
        } catch (error) {
          // catch-no-log-ok failure is shown inline, without logging firmware values or credentials
          if (isCurrent())
            setStatus({
              kind: 'error',
              message: translateMeshcoreUserMessage(t, error instanceof Error ? error.message : ''),
            });
        }
      }),
    [section, send, isCurrent, run, t, connectionToken],
  );

  useEffect(() => {
    if (open && snapshot == null && status == null && !busy && connected) void load();
  }, [open, snapshot, status, busy, connected, load]);

  const apply = () =>
    run(section, async () => {
      if (!snapshot) return;
      setStatus({ kind: 'info', message: t('infraConfig.applying'), connectionToken });
      const result = await applyInfraConfig(section, snapshot.values, edited, send, isCurrent);
      if (!isAlive()) return;
      setSnapshot({ ...snapshot, values: result.values });
      // Reconcile only confirmed matches; failed or mismatched fields retain their drafts.
      setEdited((previous) => {
        const next = { ...previous };
        for (const field of fields) {
          if (
            result.appliedKeys.includes(field.key) &&
            previous[field.key] === edited[field.key] &&
            infraConfigValueMatches(field, edited[field.key], result.values[field.key])
          )
            next[field.key] = result.values[field.key];
        }
        return next;
      });
      setRebootRequired((previous) => previous || result.rebootRequired);
      if (!isCurrent()) {
        setStatus({
          kind: 'error',
          message: `${t('infraConfig.interrupted')} ${t('infraConfig.partialSave')}`,
        });
        return;
      }
      if (!result.error) setEdited(result.values);
      setStatus(
        result.error
          ? {
              kind: 'error',
              message: `${translateMeshcoreUserMessage(t, result.error.message)} ${t('infraConfig.partialSave')}`,
            }
          : { kind: 'success', message: t('infraConfig.saved') },
      );
    });

  return (
    <details
      className="group bg-deep-black border-ink-700 rounded-card border"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <SectionHeading
        title={title}
        description={t(SECTION_DESCRIPTIONS[section])}
        icon={<SectionIcon aria-hidden size={20} />}
        badge={
          dirty ? (
            <span className="rounded-badge border border-orange-700/50 bg-orange-950/40 px-2 py-1 text-xs text-orange-200">
              {t('infraConfig.pendingChanges', { count: changedCount })}
            </span>
          ) : snapshot ? (
            <span className="text-muted hidden items-center gap-1 text-xs sm:inline-flex">
              <Check aria-hidden size={14} />
              {t('infraConfig.read')}
            </span>
          ) : undefined
        }
      />
      <div className="border-ink-800 space-y-4 border-t px-4 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={edited[field.key] ?? ''}
              disabled={!connected || busy || snapshot?.values[field.key] === undefined}
              unavailable={snapshot?.unavailable.includes(field.key) ?? false}
              changed={snapshot != null && edited[field.key] !== snapshot.values[field.key]}
              onChange={(value) => {
                setEdited((previous) => ({ ...previous, [field.key]: value }));
                setStatus(null);
              }}
            />
          ))}
        </div>
        {section === 'routing' && (
          <p className="text-muted text-xs">{t('infraConfig.advertHint')}</p>
        )}
        {section === 'room' && <p className="text-muted text-xs">{t('infraConfig.guestHint')}</p>}
        {section === 'scope' && <p className="text-muted text-xs">{t('infraConfig.scopeHint')}</p>}
        <div className="border-ink-800 flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            variant="primary"
            disabled={!connected || busy || !dirty}
            aria-label={t('modulePanel.applySection', { section: title })}
            onClick={() => void apply()}
          >
            {t('modulePanel.applySection', { section: title })}
          </Button>
          <Button
            disabled={!connected || busy || dirty}
            aria-label={t('infraConfig.refreshSection', { section: title })}
            onClick={() => void load()}
          >
            {t('infraConfig.refresh')}
          </Button>
          {dirty && (
            <Button
              disabled={busy}
              aria-label={t('infraConfig.discardSection', { section: title })}
              onClick={() => {
                setEdited(snapshot?.values ?? {});
                setStatus(null);
              }}
            >
              {t('infraConfig.discard')}
            </Button>
          )}
        </div>
        {rebootRequired && <p className={NOTICE_CLASS.warn}>{t('infraConfig.rebootRequired')}</p>}
        <Status
          status={
            status?.kind === 'info' && (!connected || status.connectionToken !== connectionToken)
              ? { kind: 'error', message: t('infraConfig.interrupted') }
              : status
          }
        />
      </div>
    </details>
  );
}

function RoomPermissions({
  busy,
  connected,
  send,
  isCurrent,
  connectionToken,
  run,
}: {
  busy: boolean;
  connected: boolean;
  send: InfraConfigSend;
  isCurrent: InfraConfigIsCurrent;
  connectionToken: symbol;
  run: RunOperation;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MeshcoreRoomAclEntry[] | null>(null);
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const refresh = async () => {
    const response = await send('get acl', isCurrent);
    if (!isCurrent()) return;
    if (/^(?:unknown|\?\?:|error[: ,]+unsupported)/i.test(response.trim()) || !response.trim()) {
      setEntries([]);
      return 'roomsPanel.membersAclEmpty';
    }
    if (/^(?:error|err\b)/i.test(response.trim()))
      throw new Error(t('infraConfig.commandRejected'));
    setEntries(parseMeshcoreRoomAclResponse(response));
    return 'infraConfig.aclUpdated';
  };
  const perform = async (operation: () => Promise<string | undefined>) => {
    let succeeded = false;
    await run('acl', async () => {
      setStatus({ kind: 'info', message: t('infraConfig.loading'), connectionToken });
      try {
        const successKey = await operation();
        if (!isCurrent()) return;
        setStatus({ kind: 'success', message: t(successKey ?? 'infraConfig.aclUpdated') });
        succeeded = true;
      } catch (error) {
        // catch-no-log-ok ACL errors are shown inline; form contents remain available for retry
        if (isCurrent())
          setStatus({
            kind: 'error',
            message: translateMeshcoreUserMessage(t, error instanceof Error ? error.message : ''),
          });
      }
    });
    return succeeded;
  };
  return (
    <details className="group bg-deep-black border-ink-700 rounded-card border">
      <SectionHeading
        title={t('infraConfig.permissions')}
        description={t('infraConfig.permissionsSummary')}
        icon={<ShieldCheck aria-hidden size={20} />}
      />
      <div className="border-ink-800 space-y-4 border-t px-4 py-4">
        <Button
          disabled={!connected || busy}
          onClick={() => void perform(refresh)}
          aria-label={t('roomsPanel.membersRefreshAcl')}
        >
          {t('roomsPanel.membersRefreshAcl')}
        </Button>
        {entries != null &&
          (entries.length ? (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.pubkeyHex} className="text-ink-300 text-body break-all">
                  <span className="font-mono">{entry.pubkeyHex}</span>{' '}
                  <span>{meshcoreRoomAclLevelLabel(entry.permissionLevel, t)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted text-xs">{t('roomsPanel.membersAclRemoteHint')}</p>
          ))}
        <MeshcoreRoomAclControls
          disabled={!connected || busy}
          onApply={(pubkey, level) =>
            perform(async () => {
              assertInfraConfigCommandOk(await send(`setperm ${pubkey} ${level}`, isCurrent));
              if (isCurrent()) setEntries(null);
              return 'infraConfig.aclSaved';
            })
          }
        />
        <Status
          status={
            status?.kind === 'info' && (!connected || status.connectionToken !== connectionToken)
              ? { kind: 'error', message: t('infraConfig.interrupted') }
              : status
          }
        />
      </div>
    </details>
  );
}

export function MeshcoreInfraConfigPanel({ node, isConnected, onSend, onBack, onOpenCli }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const connectionToken = useMemo(
    () => Symbol(isConnected ? 'connected' : 'disconnected'),
    [isConnected],
  );
  const activeConnectionTokenRef = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    activeConnectionTokenRef.current = isConnected ? connectionToken : null;
    return () => {
      activeConnectionTokenRef.current = null;
    };
  }, [isConnected, connectionToken]);
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => aliveRef.current && activeConnectionTokenRef.current === connectionToken,
    [connectionToken],
  );
  const isAlive = useCallback(() => aliveRef.current, []);
  const run = useCallback<RunOperation>(
    async (id, operation) => {
      if (busyRef.current || !isCurrent()) return false;
      busyRef.current = true;
      setBusy(id);
      try {
        await operation();
        return true;
      } finally {
        busyRef.current = false;
        if (aliveRef.current) setBusy(null);
      }
    },
    [isCurrent],
  );
  const shared = {
    busy: busy !== null,
    connected: isConnected,
    send: onSend,
    isCurrent,
    isAlive,
    connectionToken,
    run,
  };
  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <div className="border-ink-800 bg-deep-black rounded-card space-y-4 border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onBack}
            icon={<ArrowLeft aria-hidden size={16} />}
            aria-label={t('infraConfig.back')}
          >
            {t('infraConfig.back')}
          </Button>
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <h2 className="text-ink-200 text-lg font-semibold wrap-anywhere">
              {t('infraConfig.title', { name: node.long_name ?? node.node_id.toString(16) })}
            </h2>
            <p className="text-muted font-mono text-xs break-all">
              {node.node_id.toString(16).toUpperCase()}
            </p>
          </div>
          <span className="border-ink-700 rounded-badge text-ink-300 inline-flex items-center gap-2 border px-2.5 py-1.5 text-xs">
            <StatusDot tone={isConnected ? 'ok' : 'off'} />
            {t(isConnected ? 'infraConfig.radioConnected' : 'infraConfig.radioDisconnected')}
          </span>
        </div>
        <p className="text-muted text-body">{t('infraConfig.description')}</p>
      </div>
      {!isConnected && <p className={NOTICE_CLASS.warn}>{t('infraConfig.disconnected')}</p>}
      {(
        [
          'identity',
          'radio',
          'routing',
          'scope',
          ...(node.hw_model === 'Room' ? ['room'] : []),
        ] as InfraConfigSection[]
      ).map((section) => (
        <ConfigSection key={section} section={section} {...shared} />
      ))}
      {node.hw_model === 'Room' && <RoomPermissions {...shared} />}
      <details className="group bg-deep-black border-ink-700 rounded-card border">
        <SectionHeading
          title={t('infraConfig.advanced')}
          description={t('infraConfig.cliHint')}
          icon={<Terminal aria-hidden size={20} />}
        />
        <div className="space-y-3 px-4 pb-4">
          <Button
            disabled={busy !== null}
            onClick={onOpenCli}
            aria-label={t('repeatersPanel.cliInterface')}
          >
            {t('repeatersPanel.cliInterface')}
          </Button>
        </div>
      </details>
    </div>
  );
}
