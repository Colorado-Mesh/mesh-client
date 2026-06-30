import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { bytesToHex } from '@/renderer/lib/flasher/binaryUtils';
import { rnodeDisplayBufferToPng } from '@/renderer/lib/flasher/displayUtils';
import { flashEsp32Firmware } from '@/renderer/lib/flasher/esp32Flasher';
import { humanizeFlasherError } from '@/renderer/lib/flasher/flasherErrorHumanize';
import {
  connectRNode,
  requestFlasherSerialPort,
  safeCloseSerialPort,
} from '@/renderer/lib/flasher/flasherSerial';
import { Nrf52DfuFlasher } from '@/renderer/lib/flasher/nrf52DfuFlasher';
import { provisionEeprom, setFirmwareHashFromDevice } from '@/renderer/lib/flasher/provision';
import { ROM } from '@/renderer/lib/flasher/rom';
import type { RNodeModel, RNodeProduct } from '@/renderer/lib/flasher/types';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';

import { ConfirmModal } from '../ConfirmModal';
import { AdvancedTools } from './AdvancedTools';
import { BluetoothConfig } from './BluetoothConfig';
import { DeviceSelector } from './DeviceSelector';
import { DfuModeTrigger } from './DfuModeTrigger';
import { DisplayCanvas } from './DisplayCanvas';
import { FirmwareHashStep } from './FirmwareHashStep';
import { FirmwarePicker } from './FirmwarePicker';
import { FlashProgress } from './FlashProgress';
import { ProvisionStep } from './ProvisionStep';
import { TncConfig } from './TncConfig';

export interface RNodeFlasherSectionProps {
  portBlocked: boolean;
}

export function RNodeFlasherSection({ portBlocked }: RNodeFlasherSectionProps) {
  const { t } = useTranslation();
  const [selectedProduct, setSelectedProduct] = useState<RNodeProduct | null>(null);
  const [selectedModel, setSelectedModel] = useState<RNodeModel | null>(null);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [flashing, setFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
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

  const actionsDisabled = portBlocked || busy || flashing || provisioning || settingHash;

  const runWithRNode = useCallback(
    async (fn: (rnode: Awaited<ReturnType<typeof connectRNode>>) => Promise<void>) => {
      if (portBlocked) {
        showStatus(t('flasher.errors.blockedByStack'), true);
        return;
      }
      setBusy(true);
      let port: SerialPort | null = null;
      try {
        port = await requestFlasherSerialPort();
        const rnode = await connectRNode(port);
        await fn(rnode);
        await rnode.close();
      } catch (e) {
        // catch-no-log-ok error humanized and surfaced via flasher status UI
        showStatus(humanizeFlasherError(e), true);
        await safeCloseSerialPort(port);
      } finally {
        setBusy(false);
      }
    },
    [portBlocked, t, showStatus],
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
    let port: SerialPort | null = null;
    try {
      port = await requestFlasherSerialPort();
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
  }, [portBlocked, selectedProduct, t, showStatus]);

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

    setFlashing(true);
    setFlashProgress(0);
    let port: SerialPort | null = null;

    try {
      port = await requestFlasherSerialPort();

      if (selectedProduct.platform === ROM.PLATFORM_NRF52) {
        const flasher = new Nrf52DfuFlasher(port);
        await flasher.flash(firmwareFile, setFlashProgress);
      } else if (selectedProduct.platform === ROM.PLATFORM_ESP32) {
        const flashConfig = selectedModel?.flash_config ?? selectedProduct.flash_config;
        if (!flashConfig) {
          showStatus(t('flasher.errors.flashConfigMissing'), true);
          return;
        }
        await flashEsp32Firmware(port, firmwareFile, flashConfig, setFlashProgress);
      } else {
        showStatus(t('flasher.errors.selectProduct'), true);
        return;
      }

      showStatus(t('flasher.flashSuccess'));
    } catch (e) {
      // catch-no-log-ok error humanized and surfaced via flasher status UI
      showStatus(humanizeFlasherError(e), true);
    } finally {
      await safeCloseSerialPort(port);
      setFlashing(false);
    }
  }, [firmwareFile, portBlocked, selectedModel, selectedProduct, showStatus, t]);

  const handleProvision = useCallback(async () => {
    if (!selectedProduct || !selectedModel) {
      showStatus(
        !selectedProduct ? t('flasher.errors.selectProduct') : t('flasher.errors.selectModel'),
        true,
      );
      return;
    }

    setProvisioning(true);
    await runWithRNode(async (rnode) => {
      const rom = await rnode.getRomAsObject();
      const details = rom.parse();
      if (details?.is_provisioned) {
        showStatus(t('flasher.provisionAlreadyDone'), true);
        return;
      }
      await provisionEeprom(rnode, { product: selectedProduct, model: selectedModel });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await rnode.reset();
      showStatus(t('flasher.provisionSuccess'));
    });
    setProvisioning(false);
  }, [runWithRNode, selectedModel, selectedProduct, showStatus, t]);

  const handleSetFirmwareHash = useCallback(async () => {
    setSettingHash(true);
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
      showStatus(t('flasher.firmwareHashSuccess'));
    });
    setSettingHash(false);
  }, [runWithRNode, showStatus, t]);

  const handleWipeEeprom = useCallback(async () => {
    setShowWipeConfirm(false);
    await runWithRNode(async (rnode) => {
      await rnode.wipeRom();
      await rnode.reset();
      showStatus(t('flasher.wipeEepromSuccess'));
    });
  }, [runWithRNode, showStatus, t]);

  const isNrf52 = selectedProduct?.platform === ROM.PLATFORM_NRF52;

  return (
    <>
      <details className="group bg-deep-black rounded-lg border border-gray-700">
        <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
          <span>{t('flasher.title')}</span>
          <DetailsChevron />
        </summary>
        <div className="space-y-4 px-4 pb-4">
          {portBlocked ? (
            <p className="rounded border border-amber-600/40 bg-amber-950/20 p-2 text-xs text-amber-200">
              {t('flasher.portContentionWarning')}
            </p>
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

          {isNrf52 ? (
            <DfuModeTrigger disabled={actionsDisabled} busy={busy} onEnterDfu={handleEnterDfu} />
          ) : null}

          <button
            type="button"
            disabled={actionsDisabled}
            aria-label={t('flasher.flashFirmware')}
            onClick={() => {
              void handleFlash();
            }}
            className="bg-readable-green hover:bg-readable-green/90 rounded px-3 py-2 text-sm font-medium text-white disabled:bg-gray-600 disabled:opacity-60"
          >
            {flashing
              ? t('flasher.flashing', { progress: flashProgress })
              : t('flasher.flashFirmware')}
          </button>

          <FlashProgress active={flashing} progress={flashProgress} />

          <ProvisionStep
            disabled={actionsDisabled}
            busy={provisioning}
            onProvision={() => {
              void handleProvision();
            }}
          />

          <FirmwareHashStep
            disabled={actionsDisabled}
            busy={settingHash}
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
      </details>

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
