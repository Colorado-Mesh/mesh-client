import 'vitest';
import type { AxeMatchers } from 'vitest-axe/matchers';

// Explicitly augment the Vitest 'Assertion' interface
// so tsc recognizes toHaveNoViolations()
declare module 'vitest' {
  export interface Assertion<T = any> extends AxeMatchers {}
  export interface AsymmetricMatchersContaining extends AxeMatchers {}
}

declare module '@meshtastic/protobufs' {
  export const Channel: any;
  export const Mesh: any;
  export const Portnums: any;
}
