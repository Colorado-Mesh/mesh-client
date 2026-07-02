import { describe, expect, it } from 'vitest';

import {
  isDeleteActiveMqttIdentityError,
  markDeleteActiveMqttIdentityError,
} from './meshtasticDeleteNodeError';

describe('meshtasticDeleteNodeError', () => {
  it('marks and detects active MQTT identity delete errors', () => {
    const err = markDeleteActiveMqttIdentityError(
      'Cannot delete active MQTT identity while MQTT is connected',
    );
    expect(isDeleteActiveMqttIdentityError(err)).toBe(true);
    expect(isDeleteActiveMqttIdentityError(new Error('other'))).toBe(false);
  });
});
