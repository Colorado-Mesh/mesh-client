import { describe, expect, it } from 'vitest';

import {
  meshtasticMqttTopicPrefixesDiverge,
  meshtasticRadioMqttRootFromModuleConfigs,
  normalizeMeshtasticMqttTopicPrefix,
  overlayMeshtasticMqttTopicPrefixForRadio,
} from './meshtasticMqttTopicPrefixOverlay';

describe('meshtasticMqttTopicPrefixOverlay', () => {
  it('normalizes topic prefixes with trailing slash', () => {
    expect(normalizeMeshtasticMqttTopicPrefix('msh/US')).toBe('msh/US/');
    expect(normalizeMeshtasticMqttTopicPrefix('msh/US/')).toBe('msh/US/');
    expect(normalizeMeshtasticMqttTopicPrefix('')).toBe('msh/');
  });

  it('reads radio mqtt.root from module config', () => {
    expect(
      meshtasticRadioMqttRootFromModuleConfigs({
        mqtt: { root: 'msh/US/CO' },
      }),
    ).toBe('msh/US/CO/');
    expect(meshtasticRadioMqttRootFromModuleConfigs({ mqtt: { root: '' } })).toBeNull();
  });

  it('detects divergent app and radio prefixes', () => {
    expect(meshtasticMqttTopicPrefixesDiverge('msh/US', 'msh/US/CO')).toBe(true);
    expect(meshtasticMqttTopicPrefixesDiverge('msh/US/', 'msh/US/CO/')).toBe(true);
    expect(meshtasticMqttTopicPrefixesDiverge('msh/US/CO', 'msh/US/CO/')).toBe(false);
  });

  it('overlays more specific radio root over broader app prefix', () => {
    expect(overlayMeshtasticMqttTopicPrefixForRadio('msh/US', 'msh/US/CO')).toBe('msh/US/CO/');
    expect(overlayMeshtasticMqttTopicPrefixForRadio('msh/US/CO', 'msh/US')).toBe('msh/US/CO/');
    expect(overlayMeshtasticMqttTopicPrefixForRadio('msh/US/CO', 'msh/US/CO')).toBe('msh/US/CO/');
  });
});
