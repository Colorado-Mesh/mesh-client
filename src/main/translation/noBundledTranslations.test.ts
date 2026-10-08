import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectSourcePolicyViolations } from '../../architecture/sourcePolicy';
import { SOURCE_POLICY_RULES } from '../../architecture/sourcePolicyRules';

const root = path.resolve(__dirname, '../../..');
const yaml = createRequire(__filename)('js-yaml') as { load: (source: string) => unknown };
const containsTranslationBinary = (config: unknown) =>
  /translation[^"\n]*(?:\.wasm|models?|vocab|lid)|(?:engine|fasttext)\.wasm|lid[^"/\s]*\.(?:ftz|bin)|(?:model|lex)[^"/\s]*\.bin|vocab[^"/\s]*\.spm/i.test(
    JSON.stringify(config),
  );
describe('translation packaging boundary', () => {
  it('contains no translation model, vocabulary, LID or engine binaries', () => {
    const files = globSync(
      ['**/*.wasm', '**/model*.bin', '**/lex.*', '**/*vocab*.spm', '**/lid*.ftz'],
      { cwd: root, exclude: ['node_modules/**', '.git/**', '**/target/**'] },
    );
    // Existing MeshCore signature verification is independent of translation.
    const signatureAssets = new Set([
      'dist/renderer/orlp-ed25519.wasm',
      'dist/renderer/assets/orlp-ed25519.wasm',
    ]);
    expect(files.filter((file) => !signatureAssets.has(file))).toEqual([]);
  });
  it('adds no translation assets to electron-builder resources or ASAR unpack lists', () => {
    const config = yaml.load(readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
    expect(containsTranslationBinary(config)).toBe(false);
    for (const key of ['files', 'extraResources', 'asarUnpack']) {
      expect(
        containsTranslationBinary(yaml.load(`${key}:\n  - resources/translation/model.bin`)),
      ).toBe(true);
    }
    // Preserve the entire existing CSP byte for byte; translation adds no renderer allowance.
    const html = readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
    const policy = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(createHash('sha256').update(policy).digest('hex')).toBe(
      'ede110c10283e66095fb9d4aae5c93d782b368cde15a194377d5453d5aeea9cf',
    );
  });
  it('registers a binary-import guard covering canonical filenames', () => {
    const rule = SOURCE_POLICY_RULES.find((entry) => entry.id === 'translation-no-bundled-models')!;
    for (const file of [
      'engine.wasm',
      'model.bin',
      'model.fren.bin',
      'vocab.spm',
      'srcvocab.spm',
      'trgvocab.spm',
      'lid.ftz',
    ])
      expect(rule.forbid?.test(`import value from './${file}?url'`)).toBe(true);
    expect(collectSourcePolicyViolations({ root, rules: [rule] })).toEqual([]);
  });
});
