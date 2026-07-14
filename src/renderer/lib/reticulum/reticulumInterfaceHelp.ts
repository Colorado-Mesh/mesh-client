import { isReticulumBleRnodeSerialPort } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { isReticulumTcpRnodeSerialPort } from '@/renderer/lib/reticulum/reticulumRnodeTransport';
import {
  RETICULUM_SHARED_INSTANCE_CLIENT_NAME,
  RETICULUM_SHARED_INSTANCE_NAME,
} from '@/renderer/lib/reticulum/reticulumSharedInstanceNames';

export {
  RETICULUM_SHARED_INSTANCE_CLIENT_NAME,
  RETICULUM_SHARED_INSTANCE_NAME,
} from '@/renderer/lib/reticulum/reticulumSharedInstanceNames';

export interface ReticulumInterfaceHelpInput {
  id: string;
  name: string;
  type: string;
  serial_port?: string | null;
}

export interface ReticulumInterfaceHelp {
  purposeKey: string;
  isRuntimeOnly: boolean;
  isSystemManaged: boolean;
}

export function getReticulumInterfaceHelp(
  iface: ReticulumInterfaceHelpInput,
): ReticulumInterfaceHelp {
  if (iface.name === RETICULUM_SHARED_INSTANCE_NAME) {
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.sharedInstance',
      isRuntimeOnly: true,
      isSystemManaged: true,
    };
  }
  if (iface.name === RETICULUM_SHARED_INSTANCE_CLIENT_NAME) {
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.sharedInstanceClient',
      isRuntimeOnly: true,
      isSystemManaged: true,
    };
  }
  if (iface.type === 'auto' || iface.name === 'Default Interface') {
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.auto',
      isRuntimeOnly: false,
      isSystemManaged: false,
    };
  }
  if (iface.type === 'tcp') {
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.tcp',
      isRuntimeOnly: false,
      isSystemManaged: false,
    };
  }
  if (iface.type === 'rnode') {
    const port = iface.serial_port ?? '';
    if (isReticulumBleRnodeSerialPort(port)) {
      return {
        purposeKey: 'connectionPanel.reticulumInterfaces.purpose.rnodeBle',
        isRuntimeOnly: false,
        isSystemManaged: false,
      };
    }
    if (isReticulumTcpRnodeSerialPort(port)) {
      return {
        purposeKey: 'connectionPanel.reticulumInterfaces.purpose.rnodeWifi',
        isRuntimeOnly: false,
        isSystemManaged: false,
      };
    }
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.rnodeUsb',
      isRuntimeOnly: false,
      isSystemManaged: false,
    };
  }
  if (iface.type === 'ble_peer') {
    return {
      purposeKey: 'connectionPanel.reticulumInterfaces.purpose.blePeer',
      isRuntimeOnly: false,
      isSystemManaged: false,
    };
  }
  return {
    purposeKey: 'connectionPanel.reticulumInterfaces.purpose.generic',
    isRuntimeOnly: false,
    isSystemManaged: false,
  };
}
