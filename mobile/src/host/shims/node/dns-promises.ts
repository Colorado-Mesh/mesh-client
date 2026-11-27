/** `dns/promises` shim — see `dns.ts`. */
import { promises } from './dns';

export const lookup = promises.lookup;
export const resolve = promises.resolve;
export const resolve4 = promises.resolve4;
export const resolve6 = promises.resolve6;
export const reverse = promises.reverse;
export const setDefaultResultOrder = promises.setDefaultResultOrder;
export default promises;
