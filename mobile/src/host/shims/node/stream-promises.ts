import rs from 'readable-stream';

const p = (rs as unknown as { promises: { pipeline: unknown; finished: unknown } }).promises;
export const pipeline = p.pipeline;
export const finished = p.finished;
export default p;
