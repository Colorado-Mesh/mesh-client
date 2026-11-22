import { describe, expect, it } from 'vitest';

import { REGISTERED_MESH_PROTOCOLS } from '@/shared/meshProtocol';

import {
  defaultFirstRunSelection,
  hiddenProtocolsForSelection,
  shouldOpenFirstRunPicker,
  tourProtocolsForSelection,
} from './firstRunWizard';

describe('shouldOpenFirstRunPicker', () => {
  it('opens on a fresh install that has not seen the wizard', () => {
    expect(shouldOpenFirstRunPicker('unseen', true)).toBe(true);
  });

  it('stays closed on an existing install', () => {
    expect(shouldOpenFirstRunPicker('unseen', false)).toBe(false);
  });

  it.each([undefined, null, 'true', 1, {}])(
    'treats a non-boolean database answer (%s) as an existing install',
    (answer) => {
      expect(shouldOpenFirstRunPicker('unseen', answer)).toBe(false);
    },
  );

  it('reopens after a launch that quit on the picker, whatever the database says', () => {
    expect(shouldOpenFirstRunPicker('pending', false)).toBe(true);
    expect(shouldOpenFirstRunPicker('pending', true)).toBe(true);
  });

  it('never reopens once finished or skipped', () => {
    expect(shouldOpenFirstRunPicker('done', true)).toBe(false);
    expect(shouldOpenFirstRunPicker('done', false)).toBe(false);
  });
});

describe('hiddenProtocolsForSelection', () => {
  it('hides every registered protocol that was not picked', () => {
    expect(hiddenProtocolsForSelection(['reticulum'])).toEqual(
      REGISTERED_MESH_PROTOCOLS.filter((p) => p !== 'reticulum'),
    );
  });

  it('hides nothing when everything is picked', () => {
    expect(hiddenProtocolsForSelection([...REGISTERED_MESH_PROTOCOLS])).toEqual([]);
  });

  it('refuses an empty pick instead of hiding every protocol', () => {
    expect(hiddenProtocolsForSelection([])).toBeNull();
  });
});

describe('tourProtocolsForSelection', () => {
  it('returns the picked protocols in registry order, once each', () => {
    expect(tourProtocolsForSelection(['meshcom', 'meshtastic', 'reticulum', 'meshtastic'])).toEqual(
      REGISTERED_MESH_PROTOCOLS.filter((p) => ['meshcom', 'meshtastic', 'reticulum'].includes(p)),
    );
  });
});

describe('defaultFirstRunSelection', () => {
  it('pre-checks the protocols enabled by default (everything except MeshCom)', () => {
    expect(defaultFirstRunSelection()).toEqual(
      REGISTERED_MESH_PROTOCOLS.filter((p) => p !== 'meshcom'),
    );
  });
});
