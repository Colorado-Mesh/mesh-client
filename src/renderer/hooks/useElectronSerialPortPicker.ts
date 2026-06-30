import { useCallback, useEffect, useState } from 'react';

import type { SerialPortInfo } from '@/renderer/lib/types';

export interface UseElectronSerialPortPickerResult {
  serialPorts: SerialPortInfo[];
  showSerialPicker: boolean;
  /** Triggers Electron select-serial-port flow; resolves when user picks a port. */
  requestSerialPort: () => Promise<SerialPort>;
  selectSerialPort: (portId: string) => void;
  cancelSerialPicker: () => void;
}

/** Wire Web Serial requestPort() to main-process serial-ports-discovered + selectSerialPort IPC. */
export function useElectronSerialPortPicker(): UseElectronSerialPortPickerResult {
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [showSerialPicker, setShowSerialPicker] = useState(false);

  useEffect(() => {
    return window.electronAPI.onSerialPortsDiscovered((ports) => {
      setSerialPorts(ports);
      setShowSerialPicker(true);
    });
  }, []);

  const requestSerialPort = useCallback(async (): Promise<SerialPort> => {
    if (!navigator.serial?.requestPort) {
      throw new Error('WEB_SERIAL_UNSUPPORTED');
    }
    setSerialPorts([]);
    setShowSerialPicker(false);
    return navigator.serial.requestPort({ filters: [] });
  }, []);

  const selectSerialPort = useCallback((portId: string) => {
    window.electronAPI.selectSerialPort(portId);
    setShowSerialPicker(false);
  }, []);

  const cancelSerialPicker = useCallback(() => {
    window.electronAPI.selectSerialPort('');
    setShowSerialPicker(false);
  }, []);

  return {
    serialPorts,
    showSerialPicker,
    requestSerialPort,
    selectSerialPort,
    cancelSerialPicker,
  };
}
