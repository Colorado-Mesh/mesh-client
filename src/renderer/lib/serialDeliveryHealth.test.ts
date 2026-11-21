import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAppToast } from '../components/Toast';
import { setConnection, useConnectionStore } from '../stores/connectionStore';
import {
  clearSerialPostWakeUntrusted,
  isSerialPostWakeUntrusted,
  noteSerialDeliveryFailure,
  noteSerialPostWakeUntrusted,
  noteSerialTransportLoss,
  resetSerialDeliveryHealthForTests,
} from './serialDeliveryHealth';

vi.mock('../components/Toast', () => ({
  pushAppToast: vi.fn(),
}));

vi.mock('./i18n', () => ({
  default: { t: (key: string) => key },
}));

describe('serialDeliveryHealth', () => {
  beforeEach(() => {
    resetSerialDeliveryHealthForTests();
    useConnectionStore.setState({ connections: {} });
    vi.mocked(pushAppToast).mockClear();
  });

  afterEach(() => {
    resetSerialDeliveryHealthForTests();
  });

  it('ignores delivery failures when connection is not serial', () => {
    setConnection('id-ble', {
      status: 'configured',
      connectionType: 'ble',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });
    noteSerialTransportLoss({ connectionType: 'ble' });
    noteSerialDeliveryFailure({ reason: 'delivery-ack-timeout', connectionType: 'ble' });
    noteSerialDeliveryFailure({ reason: 'delivery-ack-timeout', connectionType: 'ble' });
    expect(pushAppToast).not.toHaveBeenCalled();
  });

  it('nudges after transport loss plus repeated delivery ACK timeouts on serial', async () => {
    setConnection('id-serial', {
      status: 'configured',
      connectionType: 'serial',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });
    noteSerialTransportLoss({ connectionType: 'serial' });
    noteSerialDeliveryFailure({ reason: 'delivery-ack-timeout', connectionType: 'serial' });
    expect(pushAppToast).not.toHaveBeenCalled();
    noteSerialDeliveryFailure({ reason: 'delivery-ack-timeout', connectionType: 'serial' });
    await vi.waitFor(() => {
      expect(pushAppToast).toHaveBeenCalledWith(
        'connectionBanner.serialDeliveryUnhealthy',
        'warning',
        8000,
      );
    });
    const serialConn = useConnectionStore.getState().connections['id-serial'];
    expect(serialConn).toBeDefined();
    expect(serialConn.serialNeedsReselect).toBe(true);
  });

  it('nudges immediately on probe-failed for serial', async () => {
    setConnection('id-serial', {
      status: 'configured',
      connectionType: 'serial',
      mqttStatus: 'disconnected',
      reconnectAttempt: 0,
      myNodeNum: 1,
    });
    noteSerialDeliveryFailure({ reason: 'probe-failed', connectionType: 'serial' });
    await vi.waitFor(() => {
      expect(pushAppToast).toHaveBeenCalledTimes(1);
    });
  });

  it('tracks post-wake untrusted window', () => {
    noteSerialPostWakeUntrusted(30_000);
    expect(isSerialPostWakeUntrusted()).toBe(true);
    clearSerialPostWakeUntrusted();
    expect(isSerialPostWakeUntrusted()).toBe(false);
  });
});
