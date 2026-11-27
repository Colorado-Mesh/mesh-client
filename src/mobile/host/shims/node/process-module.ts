import { nodeProcess } from '../../globals';

export default nodeProcess;
export const env = (nodeProcess as { env: Record<string, string> }).env;
