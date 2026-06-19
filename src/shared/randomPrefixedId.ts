import { randomCorrelationSuffix } from './randomCorrelationSuffix';

/** Prefixed correlation id: `{prefix}-{timestamp}-{suffix}` for identity/transport slots. */
export function randomPrefixedId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomCorrelationSuffix()}`;
}
