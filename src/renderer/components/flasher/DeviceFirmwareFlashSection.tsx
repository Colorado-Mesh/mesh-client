import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronSerialPortPicker } from '@/renderer/hooks/useElectronSerialPortPicker';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MESHCORE_FIRMWARE_RELEASES_URL,
  MESHTASTIC_FIRMWARE_RELEASES_URL,
} from '@/renderer/lib/firmwareCheck';
import {
  type BoardDetection,
  detectDeviceFlashBoard,
  type DetectedFlashDevice,
  type DeviceFlashBoard,
  getDeviceFlashBoardById,
  getDeviceFlashBoards,
} from '@/renderer/lib/flasher/deviceFirmwareBoards';
import { runDeviceFirmwareFlash } from '@/renderer/lib/flasher/deviceFirmwareFlash';
import {
  DeviceFirmwareError,
  type DeviceFirmwareErrorCode,
  type DeviceFirmwarePlan,
  isDeviceFirmwareError,
  planDeviceFirmware,
} from '@/renderer/lib/flasher/deviceFirmwareImage';
import {
  evaluateFlashPreflight,
  FLASH_MIN_BATTERY_PERCENT,
  type PreflightBlockerId,
  type PreflightWarningId,
} from '@/renderer/lib/flasher/deviceFirmwarePreflight';
import { humanizeFlasherError } from '@/renderer/lib/flasher/flasherErrorHumanize';
import {
  requestFlasherSerialPort,
  safeCloseSerialPort,
} from '@/renderer/lib/flasher/flasherSerial';
import {
  setFlasherSessionPortId,
  setFlasherSessionSerialPort,
} from '@/renderer/lib/flasher/flasherSessionPort';
import { Nrf52DfuFlasher } from '@/renderer/lib/flasher/nrf52DfuFlasher';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import { persistSerialPortIdentity } from '@/renderer/lib/serialPortSignature';
import { FIRMWARE_BACKUP_MAX_BYTES } from '@/shared/firmwareBackup';

import CapabilityUnavailableHint from '../CapabilityUnavailableHint';
import { DfuModeTrigger } from './DfuModeTrigger';
import { FlasherSerialPortPicker } from './FlasherSerialPortPicker';
import { flasherStepButtonClass } from './flasherStepButtonStyles';
import { FlashProgress } from './FlashProgress';

export interface DeviceFirmwareFlashSectionProps {
  capabilities?: ProtocolCapabilities;
  /** What the connected radio reported; `undefined` when the protocol cannot be flashed here. */
  device?: DetectedFlashDevice;
}

const BLOCKER_KEYS: Record<PreflightBlockerId, string> = {
  noBoard: 'deviceFirmware.blockers.noBoard',
  boardUnsupported: 'deviceFirmware.blockers.boardUnsupported',
  boardMismatch: 'deviceFirmware.blockers.boardMismatch',
  serialConnectionOpen: 'deviceFirmware.blockers.serialConnectionOpen',
  lowBattery: 'deviceFirmware.blockers.lowBattery',
  noImage: 'deviceFirmware.blockers.noImage',
  notAcknowledged: 'deviceFirmware.blockers.notAcknowledged',
};

const WARNING_KEYS: Record<PreflightWarningId, string> = {
  cable: 'deviceFirmware.warnings.cable',
  batteryUnknown: 'deviceFirmware.warnings.batteryUnknown',
  espBootloader: 'deviceFirmware.warnings.espBootloader',
  nrf52Bootloader: 'deviceFirmware.warnings.nrf52Bootloader',
  settingsReset: 'deviceFirmware.warnings.settingsReset',
  connectionDrops: 'deviceFirmware.warnings.connectionDrops',
  unverifiedBoard: 'deviceFirmware.warnings.unverifiedBoard',
};

const ERROR_KEYS: Record<DeviceFirmwareErrorCode, string> = {
  IMAGE_EMPTY: 'deviceFirmware.errors.imageEmpty',
  IMAGE_NAME_UNRECOGNIZED: 'deviceFirmware.errors.imageNameUnrecognized',
  IMAGE_BOARD_MISMATCH: 'deviceFirmware.errors.imageBoardMismatch',
  IMAGE_NOT_FOUND_FOR_BOARD: 'deviceFirmware.errors.imageNotFoundForBoard',
  IMAGE_NOT_FULL_IMAGE: 'deviceFirmware.errors.imageNotFullImage',
  IMAGE_NOT_COMPANION: 'deviceFirmware.errors.imageNotCompanion',
  IMAGE_AMBIGUOUS: 'deviceFirmware.errors.imageAmbiguous',
  IMAGE_HEADER_INVALID: 'deviceFirmware.errors.imageHeaderInvalid',
  IMAGE_CHIP_MISMATCH: 'deviceFirmware.errors.imageChipMismatch',
  IMAGE_TOO_LARGE: 'deviceFirmware.errors.imageTooLarge',
  IMAGE_TOO_SMALL: 'deviceFirmware.errors.imageTooSmall',
  DFU_PACKAGE_INVALID: 'deviceFirmware.errors.dfuPackageInvalid',
  CHECKSUM_INVALID: 'deviceFirmware.errors.checksumInvalid',
  CHECKSUM_MISMATCH: 'deviceFirmware.errors.checksumMismatch',
};

type PlanState =
  | { status: 'idle' }
  | { status: 'validating' }
  | { status: 'ready'; plan: DeviceFirmwarePlan }
  | { status: 'error'; code: DeviceFirmwareErrorCode | 'READ_FAILED'; detail?: string };

interface PlanResult {
  file: File;
  boardId: string;
  expectedSha: string;
  state: Exclude<PlanState, { status: 'idle' | 'validating' }>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function DeviceFirmwareFlashSection({
  capabilities,
  device,
}: DeviceFirmwareFlashSectionProps) {
  const { t } = useTranslation();
  const { serialPorts, showSerialPicker, requestSerialPort, selectSerialPort, cancelSerialPicker } =
    useElectronSerialPortPicker();

  const protocol = device?.protocol;
  const boards = useMemo(() => (protocol ? getDeviceFlashBoards(protocol) : []), [protocol]);

  const detection: BoardDetection = useMemo(
    () => (device ? detectDeviceFlashBoard(device) : { status: 'unknown' }),
    [device],
  );

  const [manualBoardId, setManualBoardId] = useState<string | null>(null);
  // Last live-detected board, kept so a disconnected radio (e.g. while flashing over USB) still
  // pre-selects it; the confirmation checklist below still applies.
  const [lastDetectedBoardId, setLastDetectedBoardId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expectedSha, setExpectedSha] = useState('');
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (detection.status === 'matched' && detection.board.id !== lastDetectedBoardId) {
    // Derived-state update during render (React-supported): remember the live radio's board.
    setLastDetectedBoardId(detection.board.id);
  }

  // Live detection wins and locks the selection; a manual choice only applies when undetected.
  const selectedBoardId = manualBoardId ?? lastDetectedBoardId;
  const selectedBoard: DeviceFlashBoard | null =
    detection.status === 'matched'
      ? detection.board
      : (boards.find((board) => board.id === selectedBoardId) ?? null);

  useEffect(() => {
    const controller = abortRef;
    return () => {
      controller.current?.abort();
    };
  }, []);

  // Re-validate whenever the file, board, or expected digest changes. Never trust stale plans:
  // a result only counts while it matches the current inputs.
  useEffect(() => {
    if (!file || !selectedBoard) return undefined;
    let cancelled = false;
    void (async () => {
      let state: PlanResult['state'];
      try {
        // Reject before reading into memory — zip/bin assets should never exceed the backup cap.
        if (file.size > FIRMWARE_BACKUP_MAX_BYTES) {
          throw new DeviceFirmwareError('IMAGE_TOO_LARGE');
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const plan = await planDeviceFirmware({ name: file.name, bytes }, selectedBoard, {
          expectedSha256: expectedSha,
        });
        state = { status: 'ready', plan };
      } catch (e) {
        if (isDeviceFirmwareError(e)) {
          state = { status: 'error', code: e.code, detail: e.detail };
        } else {
          console.warn('[DeviceFirmwareFlash] read failed ' + errLikeToLogString(e));
          state = { status: 'error', code: 'READ_FAILED' };
        }
      }
      if (!cancelled) setPlanResult({ file, boardId: selectedBoard.id, expectedSha, state });
    })();
    return () => {
      cancelled = true;
    };
  }, [file, selectedBoard, expectedSha]);

  const planState: PlanState = useMemo(() => {
    if (!file || !selectedBoard) return { status: 'idle' };
    if (
      planResult?.file === file &&
      planResult.boardId === selectedBoard.id &&
      planResult.expectedSha === expectedSha
    ) {
      return planResult.state;
    }
    return { status: 'validating' };
  }, [file, selectedBoard, planResult, expectedSha]);

  // The checklist is bound to one validated image + board; any change invalidates it.
  const ackFingerprint =
    planState.status === 'ready' && selectedBoard
      ? `${selectedBoard.id}:${planState.plan.payloadSha256}`
      : null;
  const acknowledged = ackFingerprint !== null && acknowledgedFor === ackFingerprint;

  const selectFlasherSerialPort = useCallback(
    (portId: string) => {
      setFlasherSessionPortId(portId);
      selectSerialPort(portId);
    },
    [selectSerialPort],
  );

  const preflight = useMemo(
    () =>
      device
        ? evaluateFlashPreflight({
            device,
            detection,
            selectedBoard,
            hasImage: planState.status === 'ready',
            acknowledged,
          })
        : null,
    [device, detection, selectedBoard, planState.status, acknowledged],
  );

  const blockers = preflight?.blockers ?? [];

  const handleEnterDfu = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    let port: SerialPort | null = null;
    try {
      port = await requestFlasherSerialPort(requestSerialPort);
      await new Nrf52DfuFlasher(port).enterDfuMode();
    } catch (e) {
      // catch-no-log-ok error humanized and surfaced via flasher status UI
      setStatus({ message: humanizeFlasherError(e), isError: true });
    } finally {
      await safeCloseSerialPort(port);
      setBusy(false);
    }
  }, [requestSerialPort]);

  const handleFlash = useCallback(async () => {
    if (!preflight?.canFlash || planState.status !== 'ready' || !selectedBoard) return;
    const plan = planState.plan;
    if (plan.board.id !== selectedBoard.id) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus(null);
    setProgress(0);
    setCancelling(false);
    setFlashing(true);
    setSyncing(plan.kind === 'esp32');
    let port: SerialPort | null = null;
    console.warn('[DeviceFirmwareFlash] flash start', {
      board: selectedBoard.id,
      kind: plan.kind,
      bytes: plan.payloadBytes,
      payloadSha256: plan.payloadSha256,
    });
    try {
      // Always show the picker (no session reuse): the port may have last been an RNode.
      port = await requestFlasherSerialPort(requestSerialPort);
      setFlasherSessionSerialPort(port);
      persistSerialPortIdentity(port);
      await runDeviceFirmwareFlash(port, plan, {
        signal: controller.signal,
        progressCallback: (pct) => {
          if (pct > 0) setSyncing(false);
          setProgress(pct);
        },
      });
      setStatus({
        message: t(
          plan.kind === 'esp32' ? 'deviceFirmware.successEsp32' : 'deviceFirmware.successNrf52',
        ),
        isError: false,
      });
      console.warn('[DeviceFirmwareFlash] flash success', { board: selectedBoard.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'ESP32_FLASH_CANCELLED' || message === 'NRF52_DFU_CANCELLED') {
        setStatus({ message: t('deviceFirmware.cancelled'), isError: true });
      } else {
        console.error('[DeviceFirmwareFlash] flash failed', e);
        // catch-no-log-ok error humanized and surfaced via status UI
        setStatus({
          message: isDeviceFirmwareError(e)
            ? t(ERROR_KEYS[e.code], { detail: e.detail ?? '' })
            : humanizeFlasherError(e),
          isError: true,
        });
      }
    } finally {
      await safeCloseSerialPort(port);
      abortRef.current = null;
      setSyncing(false);
      setFlashing(false);
      setCancelling(false);
      setFlasherSessionSerialPort(null);
      setAcknowledgedFor(null);
    }
  }, [preflight?.canFlash, planState, selectedBoard, requestSerialPort, t]);

  if (!device || !capabilities?.hasDeviceFirmwareFlash) {
    return (
      <CapabilityUnavailableHint
        id="admin-unavailable-firmwareFlash"
        feature="firmwareFlash"
        capabilities={capabilities}
      />
    );
  }

  const releasesUrl =
    device.protocol === 'meshtastic'
      ? MESHTASTIC_FIRMWARE_RELEASES_URL
      : MESHCORE_FIRMWARE_RELEASES_URL;
  const boardNames = boards.map((board) => board.label).join(', ');
  const isNrf52 = selectedBoard?.family === 'nrf52840';
  const controlsDisabled = flashing || busy;
  const flashLabel = flashing
    ? t('deviceFirmware.flashing', { progress })
    : t('deviceFirmware.flash');

  return (
    <div className="space-y-3" data-testid="device-firmware-flash">
      <p className="text-ink-300 text-xs">{t('deviceFirmware.summary')}</p>
      <p className="text-ink-400 text-xs">
        {t('deviceFirmware.supportedBoards', { boards: boardNames })}
      </p>

      {showSerialPicker ? (
        <FlasherSerialPortPicker
          ports={serialPorts}
          onSelect={selectFlasherSerialPort}
          onCancel={cancelSerialPicker}
        />
      ) : null}

      {status ? (
        <p
          role="status"
          className={
            status.isError
              ? 'rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200'
              : 'rounded border border-green-700/50 bg-green-950/30 p-2 text-xs text-green-200'
          }
        >
          {status.message}
        </p>
      ) : null}

      <div className="space-y-1">
        <label className="text-ink-400 block text-xs">
          {t('deviceFirmware.boardLabel')}
          <select
            aria-label={t('deviceFirmware.aria.board')}
            value={selectedBoard?.id ?? ''}
            disabled={controlsDisabled || detection.status !== 'unknown'}
            onChange={(e) => {
              const board = getDeviceFlashBoardById(e.target.value);
              setManualBoardId(board?.protocol === device.protocol ? board.id : null);
            }}
            className="bg-ink-800 text-ink-100 border-ink-600 mt-1 block w-full rounded border px-2 py-1 text-sm disabled:opacity-60"
          >
            <option value="">{t('deviceFirmware.boardPlaceholder')}</option>
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.label}
              </option>
            ))}
          </select>
        </label>
        {detection.status === 'matched' ? (
          <p className="text-ink-400 text-xs">
            {t('deviceFirmware.boardLocked', { board: detection.board.label })}
          </p>
        ) : null}
        {detection.status === 'unknown' ? (
          <p className="text-ink-400 text-xs">{t('deviceFirmware.boardManualHint')}</p>
        ) : null}
        {detection.status === 'unsupported' ? (
          <p role="alert" className="text-xs text-red-300">
            {t('deviceFirmware.boardUnsupported', { reported: detection.reported })}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label className="text-ink-400 block text-xs">
          {t('deviceFirmware.firmwareFile')}
          <input
            type="file"
            accept=".zip,.bin,application/zip"
            disabled={controlsDisabled || detection.status === 'unsupported'}
            aria-label={t('deviceFirmware.aria.file')}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
            }}
            className="text-ink-300 file:bg-ink-700 file:text-ink-200 mt-1 block w-full text-sm file:mr-2 file:rounded file:border-0 file:px-2 file:py-1 file:text-xs"
          />
        </label>
        <p className="text-ink-400 text-xs">
          {t(
            device.protocol === 'meshtastic'
              ? 'deviceFirmware.fileHint.meshtastic'
              : 'deviceFirmware.fileHint.meshcore',
          )}
        </p>
        <a
          href={releasesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-green text-xs hover:underline"
        >
          {t(
            device.protocol === 'meshtastic'
              ? 'deviceFirmware.releases.meshtastic'
              : 'deviceFirmware.releases.meshcore',
          )}
        </a>
      </div>

      <label className="text-ink-400 block text-xs">
        {t('deviceFirmware.checksum.expectedLabel')}
        <input
          type="text"
          value={expectedSha}
          disabled={controlsDisabled}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('deviceFirmware.aria.expectedSha')}
          onChange={(e) => {
            setExpectedSha(e.target.value);
          }}
          className="bg-ink-800 text-ink-100 border-ink-600 mt-1 block w-full rounded border px-2 py-1 font-mono text-xs"
        />
        <span className="text-muted mt-1 block">{t('deviceFirmware.checksum.expectedHint')}</span>
      </label>

      {planState.status === 'validating' ? (
        <p className="text-ink-400 text-xs" role="status">
          {t('deviceFirmware.validating')}
        </p>
      ) : null}
      {planState.status === 'error' ? (
        <p role="alert" className="text-xs text-red-300">
          {planState.code === 'READ_FAILED'
            ? t('deviceFirmware.errors.readFailed')
            : planState.code === 'IMAGE_BOARD_MISMATCH' && !planState.detail
              ? t('deviceFirmware.errors.imageBoardMismatchGeneric')
              : t(ERROR_KEYS[planState.code], { detail: planState.detail ?? '' })}
        </p>
      ) : null}
      {planState.status === 'ready' ? (
        <div className="border-ink-700 bg-ink-900/40 space-y-1 rounded border p-2 text-xs">
          <p className="text-green-300">
            {t('deviceFirmware.imageReady', {
              name: planState.plan.sourceName,
              size: formatBytes(planState.plan.payloadBytes),
            })}
          </p>
          {planState.plan.releaseLabel ? (
            <p className="text-ink-300">
              {t('deviceFirmware.imageVersion', { version: planState.plan.releaseLabel })}
            </p>
          ) : null}
          <p className="text-ink-300 font-mono break-all">
            {t('deviceFirmware.checksum.fileLabel')}: {planState.plan.fileSha256}
          </p>
          <p className="text-ink-300 font-mono break-all">
            {t('deviceFirmware.checksum.payloadLabel')}: {planState.plan.payloadSha256}
          </p>
        </div>
      ) : null}

      {isNrf52 ? (
        <div className="space-y-1">
          <p className="text-ink-400 text-xs">{t('deviceFirmware.enterDfuHint')}</p>
          <DfuModeTrigger
            disabled={controlsDisabled || preflight?.blockers.includes('serialConnectionOpen')}
            busy={busy}
            onEnterDfu={() => {
              void handleEnterDfu();
            }}
          />
        </div>
      ) : null}

      <div
        className="space-y-1 rounded border border-orange-600/40 bg-orange-950/20 p-2"
        data-testid="device-firmware-warnings"
      >
        <h4 className="text-xs font-medium text-orange-200">{t('deviceFirmware.warningsTitle')}</h4>
        <ul className="list-disc space-y-1 pl-4 text-xs text-orange-200">
          {preflight?.warnings.map((id) => (
            <li key={id}>{t(WARNING_KEYS[id])}</li>
          ))}
        </ul>
      </div>

      <label className="text-ink-200 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={controlsDisabled || !selectedBoard || planState.status !== 'ready'}
          aria-label={t('deviceFirmware.aria.acknowledge')}
          onChange={(e) => {
            setAcknowledgedFor(e.target.checked ? ackFingerprint : null);
          }}
          className="mt-0.5"
        />
        <span>{t('deviceFirmware.acknowledge', { board: selectedBoard?.label ?? '—' })}</span>
      </label>

      {blockers.length > 0 ? (
        <ul
          className="text-ink-400 list-disc space-y-0.5 pl-4 text-xs"
          data-testid="device-firmware-blockers"
        >
          {blockers.map((id) => (
            <li key={id}>{t(BLOCKER_KEYS[id], { percent: FLASH_MIN_BATTERY_PERCENT })}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!preflight?.canFlash || controlsDisabled}
          aria-label={t('deviceFirmware.aria.flash')}
          aria-busy={flashing}
          onClick={() => {
            void handleFlash();
          }}
          className={`${flasherStepButtonClass(
            flashing ? 'busy' : preflight?.canFlash ? 'ready' : 'disabled',
          )} py-2 text-sm`}
        >
          {flashLabel}
        </button>
        {flashing ? (
          <button
            type="button"
            disabled={cancelling}
            aria-label={t('deviceFirmware.aria.cancel')}
            onClick={() => {
              setCancelling(true);
              abortRef.current?.abort();
            }}
            className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {cancelling ? t('deviceFirmware.cancelling') : t('deviceFirmware.cancel')}
          </button>
        ) : null}
      </div>

      <FlashProgress active={flashing} progress={progress} syncing={syncing} />

      <div className="border-ink-700/60 bg-ink-900/30 text-ink-400 space-y-1 rounded border p-2 text-xs">
        <h4 className="text-ink-200 font-medium">{t('deviceFirmware.recovery.title')}</h4>
        <p>{t('deviceFirmware.recovery.esp32')}</p>
        <p>{t('deviceFirmware.recovery.nrf52')}</p>
        <p>{t('deviceFirmware.recovery.docs')}</p>
      </div>
    </div>
  );
}
