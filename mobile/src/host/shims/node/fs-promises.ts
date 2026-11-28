/** `fs/promises` shim: the promise API of the mobile host `fs` shim (same dirty tracking). */
import { promises } from './fs';

export const readFile = promises.readFile;
export const writeFile = promises.writeFile;
export const appendFile = promises.appendFile;
export const mkdir = promises.mkdir;
export const mkdtemp = promises.mkdtemp;
export const readdir = promises.readdir;
export const rm = promises.rm;
export const rmdir = promises.rmdir;
export const unlink = promises.unlink;
export const rename = promises.rename;
export const stat = promises.stat;
export const lstat = promises.lstat;
export const access = promises.access;
export const open = promises.open;
export const copyFile = promises.copyFile;
export const cp = promises.cp;
export const realpath = promises.realpath;
export const truncate = promises.truncate;
export const utimes = promises.utimes;
export const chmod = promises.chmod;
export const constants = promises.constants;
export default promises;
