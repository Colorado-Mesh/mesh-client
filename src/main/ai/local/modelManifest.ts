export interface AiLocalAsset {
  file: string;
  url: string;
  size: number;
  sha256: string;
}
export interface AiLocalModel {
  id: string;
  name: string;
  paramsLabel: string;
  qualityNote: string;
  license: string;
  assets: AiLocalAsset[];
}
// Checked 2026-10-15 against the publishers metadata; immutable revisions and LFS SHA-256.
export const AI_LOCAL_MODELS: AiLocalModel[] = [
  {
    id: 'qwen2.5-0.5b-instruct-q4',
    name: 'Qwen2.5 0.5B Instruct Q4_K_M',
    paramsLabel: '0.5B',
    qualityNote: 'Basic summaries; may misread senders or unanswered questions',
    license: 'Apache-2.0',
    assets: [
      {
        file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
        url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf',
        size: 491400032,
        sha256: '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db',
      },
    ],
  },
  {
    id: 'qwen2.5-1.5b-instruct-q4',
    name: 'Qwen2.5 1.5B Instruct Q4_K_M',
    paramsLabel: '1.5B',
    qualityNote: 'Better digests; more memory and CPU',
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
