import type { FastTextModule, ModuleOptions } from '../wasmTypes';
declare function loadFastText(options: ModuleOptions): Promise<FastTextModule>;
export default loadFastText;
