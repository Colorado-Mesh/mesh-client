/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronSerialPortPicker } from '@/renderer/hooks/useElectronSerialPortPicker';
import { bytesToHex } from '@/renderer/lib/flasher/binaryUtils';
import { rnodeDisplayBufferToPng } from '@/renderer/lib/flasher/displayUtils';
import { flashEsp32Firmware } from '@/renderer/lib/flasher/esp32Flasher';
import { humanizeFlasherError } from '@/renderer/lib/flasher/flasherErrorHumanize';
import {
  connectRNode,
  requestFlasherRNodePort,
  requestFlasherSerialPort,
  safeCloseSerialPort,
} from '@/renderer/lib/flasher/flasherSerial';
import {
  clearFlasherFlashSession,
  hasFlasherSessionPort,
  markFlasherFlashCompleted,
  setFlasherSessionPortId,
  setFlasherSessionSerialPort,
} from '@/renderer/lib/flasher/flasherSessionPort';
import { Nrf52DfuFlasher } from '@/renderer/lib/flasher/nrf52DfuFlasher';
import { provisionEeprom, setFirmwareHashFromDevice } from '@/renderer/lib/flasher/provision';
import { ROM } from '@/renderer/lib/flasher/rom';
import type { RNodeModel, RNodeProduct } from '@/renderer/lib/flasher/types';
import { persistSerialPortIdentity } from '@/renderer/lib/serialPortSignature';

import { ConfirmModal } from '../ConfirmModal';
import { AdvancedTools } from './AdvancedTools';
import { BluetoothConfig } from './BluetoothConfig';
import { DeviceSelector } from './DeviceSelector';
import { DfuModeTrigger } from './DfuModeTrigger';
import { DisplayCanvas } from './DisplayCanvas';
import { FirmwareDownloadLinks } from './FirmwareDownloadLinks';
import { FirmwareHashStep } from './FirmwareHashStep';
import { FirmwarePicker } from './FirmwarePicker';
import { FlasherSerialPortPicker } from './FlasherSerialPortPicker';
import { flasherStepButtonClass } from './flasherStepButtonStyles';
import { FlashProgress } from './FlashProgress';
import { ProvisionStep } from './ProvisionStep';
import { TncConfig } from './TncConfig';

export interface RNodeFlasherSectionProps {
  portBlocked: boolean;
}

export function RNodeFlasherSection({ portBlocked }: RNodeFlasherSectionProps) {
  const { t } = useTranslation();
  const { serialPorts, showSerialPicker, requestSerialPort, selectSerialPort, cancelSerialPicker } =
    useElectronSerialPortPicker();

  const selectFlasherSerialPort = useCallback(
    (portId: string) => {
      setFlasherSessionPortId(portId);
      selectSerialPort(portId);
    },
    [selectSerialPort],
  );
  const [selectedProduct, setSelectedProduct] = useState<RNodeProduct | null>(null);
  const [selectedModel, setSelectedModel] = useState<RNodeModel | null>(null);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [esp32Syncing, setEsp32Syncing] = useState(false);
  const [flashSucceeded, setFlashSucceeded] = useState(false);
  const [provisionSucceeded, setProvisionSucceeded] = useState(false);
  const [hashSetSucceeded, setHashSetSucceeded] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [settingHash, setSettingHash] = useState(false);
  const [pairingPin, setPairingPin] = useState<number | null>(null);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const showStatus = useCallback((message: string, isError = false) => {
    setStatusMessage(message);
    setStatusIsError(isError);
  }, []);

  const clearStatus = useCallback(() => {
    setStatusMessage(null);
    setStatusIsError(false);
  }, []);

  const actionsDisabled = portBlocked || busy || flashing || provisioning || settingHash;
  const canFlash =
    !portBlocked &&
    !busy &&
    !provisioning &&
    !settingHash &&
    !flashing &&
    selectedProduct != null &&
    firmwareFile != null;

  const flashButtonState = flashing
    ? 'busy'
    : flashSucceeded
      ? 'done'
      : canFlash
        ? 'ready'
        : 'disabled';

  const provisionButtonState = provisioning
    ? 'busy'
    : provisionSucceeded
      ? 'done'
      : flashSucceeded && !actionsDisabled
        ? 'ready'
        : 'disabled';

  const hashButtonState = settingHash
    ? 'busy'
    : hashSetSucceeded
      ? 'done'
      : provisionSucceeded && !actionsDisabled
        ? 'ready'
        : 'disabled';

  useEffect(() => {
    setFlashSucceeded(false);
    setProvisionSucceeded(false);
    setHashSetSucceeded(false);
    clearFlasherFlashSession();
  }, [firmwareFile, selectedProduct, selectedModel]);

  const runWithRNode = useCallback(
    async (
      fn: (rnode: Awaited<ReturnType<typeof connectRNode>>) => Promise<void>,
    ): Promise<boolean> => {
      if (portBlocked) {
        showStatus(t('flasher.errors.blockedByStack'), true);
        return false;
      }
      setBusy(true);
      clearStatus();
      let port: SerialPort | null = null;
      try {
        port = await requestFlasherRNodePort(requestSerialPort);
        setFlasherSessionSerialPort(port);
        const rnode = await connectRNode(port);
        await fn(rnode);
        await rnode.close();
        return true;
      } catch (e) {
        // catch-no-log-ok error humanized and surfaced via flasher status UI
        const statusText = humanizeFlasherError(e);
        showStatus(statusText, true);
        await safeCloseSerialPort(port);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [portBlocked, t, showStatus, requestSerialPort, clearStatus],
  );

  const handleEnterDfu = useCallback(async () => {
    if (portBlocked) {
      showStatus(t('flasher.errors.blockedByStack'), true);
      return;
    }
    if (selectedProduct?.platform !== ROM.PLATFORM_NRF52) {
      showStatus(t('flasher.errors.selectProduct'), true);
      return;
    }
    setBusy(true);
    clearStatus();
    let port: SerialPort | null = null;
    try {
      port = await requestFlasherSerialPort(requestSerialPort);
      const flasher = new Nrf52DfuFlasher(port);
      await flasher.enterDfuMode();
      showStatus(t('flasher.dfuModeDone'));
    } catch (e) {
      // catch-no-log-ok error humanized and surfaced via flasher status UI
      showStatus(humanizeFlasherError(e), true);
    } finally {
      await safeCloseSerialPort(port);
      setBusy(false);
    }
  }, [portBlocked, selectedProduct, t, showStatus, requestSerialPort, clearStatus]);

  const handleFlash = useCallback(async () => {
    if (portBlocked) {
      showStatus(t('flasher.errors.blockedByStack'), true);
      return;
    }
    if (!selectedProduct) {
      showStatus(t('flasher.errors.selectProduct'), true);
      return;
    }
    if (!firmwareFile) {
      showStatus(t('flasher.errors.selectFirmware'), true);
      return;
    }

    clearStatus();
    setFlashSucceeded(false);
    setProvisionSucceeded(false);
    setHashSetSucceeded(false);
    setFlashing(true);
    setFlashProgress(0);
    setEsp32Syncing(selectedProduct.platform === ROM.PLATFORM_ESP32);
    let port: SerialPort | null = null;

    try {
      port = await requestFlasherSerialPort(requestSerialPort, {
        preferSessionReuse: hasFlasherSessionPort(),
      });
      setFlasherSessionSerialPort(port);
      persistSerialPortIdentity(port);

      if (selectedProduct.platform === ROM.PLATFORM_NRF52) {
        const flasher = new Nrf52DfuFlasher(port);
        await flasher.flash(firmwareFile, setFlashProgress);
      } else if (selectedProduct.platform === ROM.PLATFORM_ESP32) {
        const flashConfig = selectedModel?.flash_config ?? selectedProduct.flash_config;
        if (!flashConfig) {
          showStatus(t('flasher.errors.flashConfigMissing'), true);
          return;
        }
        await flashEsp32Firmware(port, firmwareFile, flashConfig, (progress) => {
          if (progress > 0) {
            setEsp32Syncing(false);
          }
          setFlashProgress(progress);
        });
      } else {
        showStatus(t('flasher.errors.selectProduct'), true);
        return;
      }

      markFlasherFlashCompleted();
      setFlashSucceeded(true);
      showStatus(t('flasher.flashSuccess'));
    } catch (e) {
      setFlashSucceeded(false);
      // catch-no-log-ok error humanized and surfaced via flasher status UI
      showStatus(humanizeFlasherError(e), true);
    } finally {
      await safeCloseSerialPort(port);
      setEsp32Syncing(false);
      setFlashing(false);
      setFlasherSessionSerialPort(null);
    }
  }, [
    firmwareFile,
    portBlocked,
    requestSerialPort,
    selectedModel,
    selectedProduct,
    showStatus,
    t,
    clearStatus,
  ]);

  const handleProvision = useCallback(async () => {
    if (!flashSucceeded) {
      showStatus(t('flasher.provisionRequiresFlash'), true);
      return;
    }
    if (!selectedProduct || !selectedModel) {
      showStatus(
        !selectedProduct ? t('flasher.errors.selectProduct') : t('flasher.errors.selectModel'),
        true,
      );
      return;
    }

    clearStatus();
    setProvisioning(true);
    showStatus(t('flasher.provisioning'));
    await runWithRNode(async (rnode) => {
      const rom = await rnode.getRomAsObject();
      const details = rom.parse();
      if (details?.is_provisioned) {
        setProvisionSucceeded(true);
        showStatus(t('flasher.provisionAlreadyDone'));
        return;
      }
      await provisionEeprom(rnode, { product: selectedProduct, model: selectedModel });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await rnode.reset();
      setProvisionSucceeded(true);
      showStatus(t('flasher.provisionSuccess'));
    });
    setProvisioning(false);
  }, [flashSucceeded, runWithRNode, selectedModel, selectedProduct, showStatus, t, clearStatus]);

  const handleSetFirmwareHash = useCallback(async () => {
    if (!provisionSucceeded) {
      showStatus(t('flasher.firmwareHashNotProvisioned'), true);
      return;
    }

    clearStatus();
    setSettingHash(true);
    showStatus(t('flasher.settingFirmwareHash'));
    await runWithRNode(async (rnode) => {
      const rom = await rnode.getRomAsObject();
      const details = rom.parse();
      if (!details?.is_provisioned) {
        showStatus(t('flasher.firmwareHashNotProvisioned'), true);
        return;
      }
      await setFirmwareHashFromDevice(rnode);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await rnode.reset();
      setHashSetSucceeded(true);
      showStatus(t('flasher.firmwareHashSuccess'));
    });
    setSettingHash(false);
  }, [provisionSucceeded, runWithRNode, showStatus, t, clearStatus]);

  const handleWipeEeprom = useCallback(async () => {
    setShowWipeConfirm(false);
    clearStatus();
    await runWithRNode(async (rnode) => {
      await rnode.wipeRom();
      await rnode.reset();
      setProvisionSucceeded(false);
      setHashSetSucceeded(false);
      showStatus(t('flasher.wipeEepromSuccess'));
    });
  }, [runWithRNode, showStatus, t, clearStatus]);

  const isNrf52 = selectedProduct?.platform === ROM.PLATFORM_NRF52;
  const isEsp32 = selectedProduct?.platform === ROM.PLATFORM_ESP32;
  const recommendedFirmwareFilename =
    selectedModel?.firmware_filename ?? selectedProduct?.firmware_filename ?? null;

  return (
    <>
      <div className="space-y-4">
        {portBlocked ? (
          <p className="rounded border border-amber-600/40 bg-amber-950/20 p-2 text-xs text-amber-200">
            {t('flasher.portContentionWarning')}
          </p>
        ) : null}

        {showSerialPicker ? (
          <FlasherSerialPortPicker
            ports={serialPorts}
            onSelect={selectFlasherSerialPort}
            onCancel={cancelSerialPicker}
          />
        ) : null}

        {statusMessage ? (
          <p
            className={
              statusIsError
                ? 'rounded border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200'
                : 'rounded border border-green-700/50 bg-green-950/30 p-2 text-xs text-green-200'
            }
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="space-y-4 rounded border border-gray-700 bg-slate-900/40 p-3">
          <h4 className="text-sm font-medium text-gray-200">{t('flasher.flashSectionTitle')}</h4>

          <DeviceSelector
            selectedProduct={selectedProduct}
            selectedModel={selectedModel}
            disabled={actionsDisabled}
            onProductChange={setSelectedProduct}
            onModelChange={setSelectedModel}
          />

          <FirmwarePicker
            file={firmwareFile}
            disabled={actionsDisabled}
            onFileChange={setFirmwareFile}
          />

          <FirmwareDownloadLinks recommendedFilename={recommendedFirmwareFilename} />

          {isEsp32 ? <p className="text-xs text-gray-400">{t('flasher.esp32BootHint')}</p> : null}

          {isNrf52 ? (
            <DfuModeTrigger disabled={actionsDisabled} busy={busy} onEnterDfu={handleEnterDfu} />
          ) : null}

          <button
            type="button"
            disabled={flashButtonState === 'disabled'}
            aria-label={t('flasher.flashFirmware')}
            aria-busy={flashing}
            onClick={() => {
              void handleFlash();
            }}
            className={`${flasherStepButtonClass(flashButtonState)} py-2 text-sm`}
          >
            {flashing
              ? t('flasher.flashing', { progress: flashProgress })
              : flashSucceeded
                ? t('flasher.flashDone')
                : t('flasher.flashFirmware')}
          </button>

          <FlashProgress active={flashing} progress={flashProgress} syncing={esp32Syncing} />
        </div>

        <ProvisionStep
          state={provisionButtonState}
          onProvision={() => {
            void handleProvision();
          }}
        />

        <FirmwareHashStep
          state={hashButtonState}
          onSetHash={() => {
            void handleSetFirmwareHash();
          }}
        />

        <AdvancedTools
          disabled={actionsDisabled}
          onDetect={() => {
            void runWithRNode(async (rnode) => {
              const version = await rnode.getFirmwareVersion();
              console.debug('[RNodeFlasher] detect', {
                firmware_version: version,
                platform: await rnode.getPlatform(),
              });
              showStatus(`${t('flasher.detectDevice')}: v${version}`);
            });
          }}
          onReboot={() => {
            void runWithRNode(async (rnode) => {
              await rnode.reset();
              showStatus(t('flasher.rebootSuccess'));
            });
          }}
          onWipeEeprom={() => {
            setShowWipeConfirm(true);
          }}
          onDumpEeprom={() => {
            void runWithRNode(async (rnode) => {
              const eeprom = await rnode.getRom();
              console.debug('[RNodeFlasher] EEPROM', bytesToHex(eeprom));
            });
          }}
        />

        <BluetoothConfig
          disabled={actionsDisabled}
          pairingPin={pairingPin}
          onEnable={() => {
            void runWithRNode(async (rnode) => {
              await rnode.enableBluetooth();
            });
          }}
          onDisable={() => {
            void runWithRNode(async (rnode) => {
              await rnode.disableBluetooth();
              setPairingPin(null);
            });
          }}
          onStartPairing={() => {
            void runWithRNode(async (rnode) => {
              await rnode.startBluetoothPairing((pin) => {
                setPairingPin(pin);
              });
            });
          }}
        />

        <TncConfig
          disabled={actionsDisabled}
          onEnable={() => {
            void runWithRNode(async (rnode) => {
              await rnode.saveConfig();
            });
          }}
          onDisable={() => {
            void runWithRNode(async (rnode) => {
              await rnode.deleteConfig();
            });
          }}
        />

        <DisplayCanvas
          disabled={actionsDisabled}
          imageDataUrl={displayImage}
          onReadDisplay={() => {
            void runWithRNode(async (rnode) => {
              const buffer = await rnode.readDisplay();
              setDisplayImage(rnodeDisplayBufferToPng(buffer));
            });
          }}
          onSetRotation={(rotation) => {
            void runWithRNode(async (rnode) => {
              await rnode.setDisplayRotation(rotation);
            });
          }}
          onRecondition={() => {
            void runWithRNode(async (rnode) => {
              await rnode.startDisplayReconditioning();
            });
          }}
        />
      </div>

      {showWipeConfirm ? (
        <ConfirmModal
          title={t('flasher.wipeEepromConfirmTitle')}
          message={t('flasher.wipeEepromConfirmMessage')}
          confirmLabel={t('flasher.wipeEepromConfirm')}
          danger
          onConfirm={() => {
            void handleWipeEeprom();
          }}
          onCancel={() => {
            setShowWipeConfirm(false);
          }}
        />
      ) : null}
    </>
  );
}
