import { useCallback, useMemo, useState } from 'react';

import {
  buildExtraFieldOverrides,
  defaultExtraFieldValues,
  type ExtraConfigFieldSpec,
  extraFieldList,
  type ExtraFieldOverridesResult,
  type ExtraFieldValue,
  type ExtraFieldValues,
  readExtraFieldValues,
} from '@/renderer/lib/meshtastic/meshtasticExtraConfigFields';

import { useSyncFormFromConfig } from './useSyncFormFromConfig';

export interface MeshtasticExtraConfigFieldsState {
  values: ExtraFieldValues;
  setValue: (key: string, value: ExtraFieldValue) => void;
  /** Apply overrides for these fields, or the first field that fails to parse. */
  result: ExtraFieldOverridesResult;
}

/** Form state for a group of declarative extra fields, re-synced when the device slice changes. */
export function useMeshtasticExtraConfigFields(
  configSlice: unknown,
  fields: Readonly<Record<string, ExtraConfigFieldSpec>>,
): MeshtasticExtraConfigFieldsState {
  const specs = useMemo(() => extraFieldList(fields), [fields]);
  const [values, setValues] = useState<Record<string, ExtraFieldValue>>(() =>
    defaultExtraFieldValues(specs),
  );
  useSyncFormFromConfig(configSlice, (cfg) => {
    setValues(readExtraFieldValues(cfg, specs));
  });
  const setValue = useCallback((key: string, value: ExtraFieldValue) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);
  const result = useMemo(
    () => buildExtraFieldOverrides(configSlice, specs, values),
    [configSlice, specs, values],
  );
  return { values, setValue, result };
}
