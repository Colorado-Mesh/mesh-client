import type { AiLocalAsset, AiLocalModel } from './modelManifest';

const LLAMA_LICENSE: AiLocalAsset = {
  file: 'LICENSE.txt',
  url: 'https://raw.githubusercontent.com/meta-llama/llama-models/0e0b8c519242d5833d8c11bffc1232b77ad7f301/models/llama3_2/LICENSE',
  size: 7669,
  sha256: '8cc15535a8a34b41888f644b339a1a9eb428af793a4f5e24df58a3e5b1487d74',
};

const LLAMA_NOTICE: AiLocalAsset = {
  file: 'NOTICE.txt',
  content:
    'Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.\n',
  size: 116,
  sha256: '3bc2d1a6b360a03d172058198631b931c9aadf01650892fb0d25b93c6b8f0025',
};

const hubFile = (file: string, size: number, sha256: string): AiLocalAsset => ({
  file,
  size,
  sha256,
});

/** Pinned offline Catch up packs — shipped as sibling `ai-local-models.js` out of index.js. */
export const AI_LOCAL_MODELS: AiLocalModel[] = [
  {
    id: 'qwen2.5-1.5b-instruct-mlx-4bit',
    name: 'Qwen2.5 1.5B Instruct MLX 4-bit',
    paramsLabel: '1.5B',
    license: 'Apache-2.0',
    runtime: 'mlx',
    recommendAs: 'fasterMachines',
    platforms: ['darwin'],
    archs: ['arm64'],
    hub: {
      repo: 'mlx-community/Qwen2.5-1.5B-Instruct-4bit',
      rev: '8b403126fc14f14cfc99bb4cfa72ecbc129ea677',
    },
    assets: [
      hubFile(
        'config.json',
        784,
        '636d3e2a15e8914b8cf82b05cc2288a811f9bd93c3bf1afc00cab701a70b47c0',
      ),
      hubFile(
        'model.safetensors',
        868628559,
        '0979f33d1bc58afcf696d13f57977644e7b11a6f0eec3e631d8e9463d18c0717',
      ),
      hubFile(
        'model.safetensors.index.json',
        51569,
        '6b98634d5044f0e2ad45228a374f8445904e571f1082392d08a6ce54f5d517ca',
      ),
      hubFile(
        'tokenizer.json',
        7031673,
        'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf',
      ),
      hubFile(
        'tokenizer_config.json',
        7308,
        'f7c61e32b7a17d19bf8e7037dcb74079a833e53ea9801f24008cac68458f03b7',
      ),
      hubFile(
        'special_tokens_map.json',
        613,
        '76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd',
      ),
      hubFile(
        'vocab.json',
        2776833,
        'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
      ),
      hubFile(
        'merges.txt',
        1671853,
        '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
      ),
      hubFile(
        'added_tokens.json',
        605,
        '58b54bbe36fc752f79a24a271ef66a0a0830054b4dfad94bde757d851968060b',
      ),
    ],
  },
  {
    id: 'llama3.2-3b-instruct-mlx-4bit',
    name: 'Llama 3.2 3B Instruct MLX 4-bit',
    paramsLabel: '3B',
    license: 'Llama 3.2 Community License',
    runtime: 'mlx',
    recommendAs: 'quality',
    platforms: ['darwin'],
    archs: ['arm64'],
    hub: {
      repo: 'mlx-community/Llama-3.2-3B-Instruct-4bit',
      rev: '7f0dc925e0d0afb0322d96f9255cfddf2ba5636e',
    },
    assets: [
      hubFile(
        'config.json',
        1122,
        'c546925585e48f43890d9dc5150df4fec73dd3780d92961c5ace451934cc4cd6',
      ),
      hubFile(
        'model.safetensors',
        1807496278,
        'd75e1ee0ea653cc5b76191ec934c7c0d568e94d4e47846619f1f4bc715b7b265',
      ),
      hubFile(
        'model.safetensors.index.json',
        45720,
        '2ef31fa0b9dcda01f87835851d5e1d5a39ab6258ae618af6ea864c3747e556e4',
      ),
      hubFile(
        'tokenizer.json',
        17209920,
        '6b9e4e7fb171f92fd137b777cc2714bf87d11576700a1dcd7a399e7bbe39537b',
      ),
      hubFile(
        'tokenizer_config.json',
        54558,
        '022d5ae3df4737998ab97d8f31ac2bcb4c06dd8ebe5a8aba2b4aceef1e5ea7d3',
      ),
      hubFile(
        'special_tokens_map.json',
        296,
        '6f38c73729248f6c127296386e3cdde96e254636cc58b4169d3fd32328d9a8ec',
      ),
      LLAMA_LICENSE,
      LLAMA_NOTICE,
    ],
  },
  {
    id: 'qwen2.5-1.5b-instruct-q4',
    name: 'Qwen2.5 1.5B Instruct Q4_K_M',
    paramsLabel: '1.5B',
    license: 'Apache-2.0',
    runtime: 'wllama',
    recommendAs: 'fasterMachines',
    hub: {
      repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
      rev: '91cad51170dc346986eccefdc2dd33a9da36ead9',
    },
    assets: [
      hubFile(
        'qwen2.5-1.5b-instruct-q4_k_m.gguf',
        1117320736,
        '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
      ),
    ],
  },
  {
    id: 'llama3.2-3b-instruct-q4',
    name: 'Llama 3.2 3B Instruct Q4_K_M',
    paramsLabel: '3B',
    license: 'Llama 3.2 Community License',
    runtime: 'wllama',
    recommendAs: 'quality',
    hub: {
      repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
      rev: 'c1f82a567baf4622ef1be9094a208511846e60df',
    },
    assets: [
      hubFile(
        'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        2019377696,
        '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
      ),
      LLAMA_LICENSE,
      LLAMA_NOTICE,
    ],
  },
];
