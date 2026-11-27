/** `stream` shim: readable-stream v4 (Node 18+ stream semantics, browser safe). */
import rs from 'readable-stream';

const m = rs as unknown as Record<string, unknown> & { promises?: Record<string, unknown> };
export const Readable = m.Readable;
export const Writable = m.Writable;
export const Duplex = m.Duplex;
export const Transform = m.Transform;
export const PassThrough = m.PassThrough;
export const Stream = m.Stream ?? m.Readable;
export const pipeline = m.pipeline;
export const finished = m.finished;
export const addAbortSignal = m.addAbortSignal;
export const promises = m.promises;
export default m;
