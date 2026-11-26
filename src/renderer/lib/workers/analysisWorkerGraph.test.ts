import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The analysis worker runs in a dedicated Worker: no `window`, no `document`, no React.
 * A single UI or store import anywhere in its static graph makes Vite's dev pipeline inject
 * `/@react-refresh` into that module, which reads `window` at module init and kills the worker
 * (`mcL1173` / `mcL1402` on every diagnostics re-analysis pass).
 *
 * Guard the invariant, not one specific import: the worker graph must stay UI-free.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const WORKER_ENTRY = path.join(SRC_ROOT, 'renderer', 'workers', 'analysis.worker.ts');

const UI_DIR_SEGMENTS = [
  path.join('src', 'renderer', 'components') + path.sep,
  path.join('src', 'renderer', 'stores') + path.sep,
];
const UI_PACKAGES = [/^react$/, /^react-dom/, /^framer-motion$/, /^motion$/, /^lucide-react/];

/** Runtime import specifiers only — `import type` / `import { type X }` are erased. */
function runtimeSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      let hasRuntimeBinding = clause.name != null;
      const bindings = clause.namedBindings;
      if (bindings) {
        hasRuntimeBinding =
          hasRuntimeBinding ||
          ts.isNamespaceImport(bindings) ||
          bindings.elements.some((element) => !element.isTypeOnly);
      }
      if (hasRuntimeBinding && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      const onlyTypes =
        clause != null &&
        ts.isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly);
      if (!onlyTypes && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(SRC_ROOT, specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else return null;

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep)) ?? null
  );
}

function relativeToRepo(file: string): string {
  return path.relative(REPO_ROOT, file);
}

interface WorkerGraph {
  files: string[];
  parent: Map<string, string>;
  bareImports: { from: string; specifier: string }[];
}

function findWorkerGraph(): WorkerGraph {
  const parent = new Map<string, string>();
  const bareImports: { from: string; specifier: string }[] = [];
  const seen = new Set<string>([WORKER_ENTRY]);
  const queue = [WORKER_ENTRY];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of runtimeSpecifiers(file)) {
      const resolved = resolveSpecifier(file, specifier);
      if (!resolved) {
        if (!specifier.startsWith('.')) bareImports.push({ from: file, specifier });
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      parent.set(resolved, file);
      queue.push(resolved);
    }
  }
  return { files: [...seen].sort(), parent, bareImports };
}

function chainTo(file: string, parent: Map<string, string>): string {
  const parts: string[] = [relativeToRepo(file)];
  let current = file;
  while (parent.has(current)) {
    current = parent.get(current)!;
    parts.push(relativeToRepo(current));
  }
  return parts.reverse().join('\n  → ');
}

describe('analysis worker import graph', () => {
  const graph = findWorkerGraph();

  it('reaches no renderer UI components or stores', () => {
    const offenders = graph.files.filter((file) => {
      const repoPath = relativeToRepo(file);
      return (
        UI_DIR_SEGMENTS.some((segment) => repoPath.startsWith(segment)) || repoPath.endsWith('.tsx')
      );
    });
    expect(
      offenders.map((file) => chainTo(file, graph.parent)),
      'analysis worker must only import pure analysis helpers (a worker has no window/document)',
    ).toEqual([]);
  });

  it('imports no UI framework packages', () => {
    const offenders = graph.bareImports
      .filter((entry) => UI_PACKAGES.some((pkg) => pkg.test(entry.specifier)))
      .map((entry) => `${relativeToRepo(entry.from)} → ${entry.specifier}`);
    expect(offenders).toEqual([]);
  });

  it('resolves the analysis entry through the pure topology filter', () => {
    const repoPaths = graph.files.map(relativeToRepo);
    expect(repoPaths).toContain(
      path.join('src', 'renderer', 'lib', 'workers', 'analysisJobHandlers.ts'),
    );
    expect(repoPaths).toContain(
      path.join('src', 'renderer', 'lib', 'reticulum', 'reticulumTopologyRfFilter.ts'),
    );
  });
});
