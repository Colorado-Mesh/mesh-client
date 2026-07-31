import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCE_POLICY_RULES, type SourcePolicyRule } from './sourcePolicyRules';

export interface SourcePolicyViolation {
  ruleId: string;
  file: string;
  line: number | null;
  message: string;
  detail: string;
}

export interface CollectSourcePolicyViolationsOptions {
  /** Repo root (defaults to process.cwd()). */
  root?: string;
  /** Rules to evaluate (defaults to SOURCE_POLICY_RULES). */
  rules?: readonly SourcePolicyRule[];
}

const TEST_FILE_RE = /\.test\.(?:ts|tsx|mjs|js|jsx|mts|cts)$/;
const SUPPRESS_MARKER_RE = /\/\/\s*source-policy-ok\s+(\S+)/;

function ruleTargetsTests(rule: SourcePolicyRule): boolean {
  return rule.include.some((p) => p.includes('.test.') || p.includes('*.test'));
}

function isExcluded(relPath: string, exclude: string[] | undefined): boolean {
  if (!exclude || exclude.length === 0) return false;
  return exclude.some((pattern) => matchSimpleGlob(relPath, pattern));
}

/** Minimal glob matcher for `**`, `*`, and `{a,b}` brace sets (repo-relative paths). */
export function matchSimpleGlob(relPath: string, pattern: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const pat = pattern.replace(/\\/g, '/');
  const regex = globToRegExp(pat);
  return regex.test(normalized);
}

function globToRegExp(pattern: string): RegExp {
  let i = 0;
  let out = '^';
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    if (ch === '*' && pattern.charAt(i + 1) === '*') {
      if (pattern.charAt(i + 2) === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        out += '\\{';
        i += 1;
        continue;
      }
      const inner = pattern.slice(i + 1, end);
      const alts = inner.split(',').map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      out += `(?:${alts.join('|')})`;
      i = end + 1;
      continue;
    }
    if ('\\.[]()+|^$'.includes(ch)) out += `\\${ch}`;
    else out += ch;
    i += 1;
  }
  out += '$';
  // eslint-disable-next-line security/detect-non-literal-regexp -- glob→regex from trusted rule include patterns
  return new RegExp(out);
}

function collectFilesForRule(root: string, rule: SourcePolicyRule): string[] {
  const out = new Set<string>();
  const targetsTests = ruleTargetsTests(rule);
  for (const pattern of rule.include) {
    const matches = globSync(pattern, {
      cwd: root,
    });
    for (const rel of matches) {
      const normalized = rel.replace(/\\/g, '/');
      if (normalized.endsWith('/')) continue;
      if (isExcluded(normalized, rule.exclude)) continue;
      if (!targetsTests && TEST_FILE_RE.test(normalized)) continue;
      out.add(normalized);
    }
  }
  return [...out].sort();
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function lineHasSuppress(source: string, matchIndex: number, ruleId: string): boolean {
  const lineStart = source.lastIndexOf('\n', matchIndex - 1) + 1;
  const lineEnd = source.indexOf('\n', matchIndex);
  const line = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
  const m = SUPPRESS_MARKER_RE.exec(line);
  return m?.[1] === ruleId;
}

function fileHasSuppress(source: string, ruleId: string): boolean {
  for (const line of source.split('\n')) {
    const m = SUPPRESS_MARKER_RE.exec(line);
    if (m?.[1] === ruleId) return true;
  }
  return false;
}

function cloneRegExp(re: RegExp): RegExp {
  // eslint-disable-next-line security/detect-non-literal-regexp -- clone compiled SourcePolicyRule pattern with /g
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}

/**
 * Walk include globs and return policy violations.
 * Failures are reported with rule id, relative path, and optional line number.
 */
export function collectSourcePolicyViolations(
  opts: CollectSourcePolicyViolationsOptions = {},
): SourcePolicyViolation[] {
  const root = opts.root ?? process.cwd();
  const rules = opts.rules ?? SOURCE_POLICY_RULES;
  const violations: SourcePolicyViolation[] = [];

  for (const rule of rules) {
    const files = collectFilesForRule(root, rule);
    for (const rel of files) {
      const abs = join(root, rel);
      let source: string;
      try {
        source = readFileSync(abs, 'utf-8');
      } catch (err) {
        console.error(`[source-policy] failed to read ${rel}:`, err);
        throw err;
      }

      if (rule.when && !rule.when.test(source)) continue;

      if (rule.forbid) {
        const forbidRe = cloneRegExp(rule.forbid);
        let match: RegExpExecArray | null;
        while ((match = forbidRe.exec(source)) !== null) {
          if (lineHasSuppress(source, match.index, rule.id)) continue;
          violations.push({
            ruleId: rule.id,
            file: rel,
            line: lineNumberAt(source, match.index),
            message: rule.message,
            detail: `forbid matched: ${match[0].slice(0, 80)}`,
          });
          // Avoid zero-length infinite loops
          if (match[0].length === 0) forbidRe.lastIndex++;
        }
      }

      if (rule.require && !rule.require.test(source)) {
        if (fileHasSuppress(source, rule.id)) continue;
        violations.push({
          ruleId: rule.id,
          file: rel,
          line: null,
          message: rule.message,
          detail: `require missing: /${rule.require.source}/`,
        });
      }
    }
  }

  return violations;
}
