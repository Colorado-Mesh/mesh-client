export type AiLocalAsset = {
  file: string;
  size: number;
  sha256: string;
} & ({ url: string; content?: never } | { content: string; url?: never });
export interface AiLocalModel {
  id: string;
  name: string;
  paramsLabel: string;
  license: string;
  assets: AiLocalAsset[];
}
// Checked 2026-10-16 against publisher metadata; immutable revisions and LFS SHA-256.
export const AI_LOCAL_MODELS: AiLocalModel[] = [
  {
    id: 'llama3.2-1b-instruct-q4',
    name: 'Llama 3.2 1B Instruct Q4_K_M',
    paramsLabel: '1B',
    license: 'Llama 3.2 Community License',
    assets: [
      {
        file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        // eslint-disable-next-line no-secrets/no-secrets -- public, immutable model asset URL
        url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/067b946cf014b7c697f3654f621d577a3e3afd1c/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        size: 807694464,
        sha256: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
      },
      {
        file: 'LICENSE.txt',
        url: 'https://raw.githubusercontent.com/meta-llama/llama-models/0e0b8c519242d5833d8c11bffc1232b77ad7f301/models/llama3_2/LICENSE',
        size: 7669,
        sha256: '8cc15535a8a34b41888f644b339a1a9eb428af793a4f5e24df58a3e5b1487d74',
      },
      {
        file: 'NOTICE.txt',
        content:
          'Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.\n',
        size: 116,
        sha256: '3bc2d1a6b360a03d172058198631b931c9aadf01650892fb0d25b93c6b8f0025',
      },
    ],
  },
  {
    id: 'qwen2.5-1.5b-instruct-q4',
    name: 'Qwen2.5 1.5B Instruct Q4_K_M',
    paramsLabel: '1.5B',
    license: 'Apache-2.0',
    assets: [
      {
        file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf',
        size: 1117320736,
        sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
      },
    ],
  },
];
