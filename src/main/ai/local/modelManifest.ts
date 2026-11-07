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
// Checked 2026-11-07 against publisher metadata; immutable revisions and LFS SHA-256.
export const AI_LOCAL_MODELS: AiLocalModel[] = [
  {
    id: 'llama3.2-3b-instruct-q4',
    name: 'Llama 3.2 3B Instruct Q4_K_M',
    paramsLabel: '3B',
    license: 'Llama 3.2 Community License',
    assets: [
      {
        file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        // eslint-disable-next-line no-secrets/no-secrets -- public, immutable model asset URL
        url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/c1f82a567baf4622ef1be9094a208511846e60df/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        size: 2019377696,
        sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
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
    id: 'qwen3-1.7b-instruct-q4',
    name: 'Qwen3 1.7B Instruct Q4_K_M',
    paramsLabel: '1.7B',
    license: 'Apache-2.0',
    assets: [
      {
        file: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
        // eslint-disable-next-line no-secrets/no-secrets -- public, immutable model asset URL
        url: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/dcb19155b962dbb6389f4691a982043a8e651022/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
        size: 1282439584,
        sha256: '72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb',
      },
    ],
  },
];
