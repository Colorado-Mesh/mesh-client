import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
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
/** Package root and subpaths, e.g. `motion` / `motion/react`, `react` / `react/jsx-runtime`. */
export const UI_PACKAGES = [
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^framer-motion(?:\/|$)/,
  /^motion(?:\/|$)/,
  /^lucide-react(?:-motion)?(?:\/|$)/,
];

/**
 * Runtime import specifiers only — `import type` / `import { type X }` are erased.
 * Clause-less `import './x'` statements are side-effect edges and always runtime.
 */
export function collectRuntimeSpecifiers(file: string): string[] {
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
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (!clause) {
        // Side-effect import: always evaluated, so always a runtime edge.
        specifiers.push(statement.moduleSpecifier.text);
        continue;
      }
      if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      let hasRuntimeBinding = clause.name != null;
      const bindings = clause.namedBindings;
      if (bindings) {
        hasRuntimeBinding =
          hasRuntimeBinding ||
          ts.isNamespaceImport(bindings) ||
          bindings.elements.some((element) => !element.isTypeOnly);
      }
      if (hasRuntimeBinding) specifiers.push(statement.moduleSpecifier.text);
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

function isExistingFile(candidate: string): boolean {
  return existsSync(candidate) && statSync(candidate).isFile();
}

function resolveSpecifier(fromFile: string, specifier: string, srcRoot: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else return null;

  // Only files are modules; a directory base must fall through to its index candidates.
  const candidates = [base];
  if (/\.jsx?$/.test(base)) {
    // ESM-style TS sources import `./ui.js` for a `ui.ts` / `ui.tsx` module.
    candidates.push(base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx'));
  }
  candidates.push(
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  );
  return candidates.find(isExistingFile) ?? null;
}

export interface WorkerGraph {
  files: string[];
  parent: Map<string, string>;
  bareImports: { from: string; specifier: string }[];
}

export function buildImportGraph(entry: string, srcRoot: string): WorkerGraph {
  const parent = new Map<string, string>();
  const bareImports: { from: string; specifier: string }[] = [];
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const specifier of collectRuntimeSpecifiers(file)) {
      const resolved = resolveSpecifier(file, specifier, srcRoot);
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

function relativeTo(root: string, file: string): string {
  return path.relative(root, file);
}

function chainTo(file: string, parent: Map<string, string>, root: string): string {
  const parts: string[] = [relativeTo(root, file)];
  let current = file;
  while (parent.has(current)) {
    current = parent.get(current)!;
    parts.push(relativeTo(root, current));
  }
  return parts.reverse().join('\n  → ');
}

/** UI offenders in a graph, with the import chain that reached each one. */
export function uiGraphOffenders(graph: WorkerGraph, root: string): string[] {
  return graph.files
    .filter((file) => {
      const relativePath = relativeTo(root, file);
      return (
        UI_DIR_SEGMENTS.some((segment) => relativePath.startsWith(segment)) ||
        relativePath.endsWith('.tsx')
      );
    })
    .map((file) => chainTo(file, graph.parent, root));
}

function withFixture(
  files: Record<string, string>,
  assert: (graph: WorkerGraph, root: string) => void,
): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'analysis-worker-graph-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      const target = path.join(root, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    assert(buildImportGraph(path.join(root, 'entry.ts'), root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('analysis worker import graph', () => {
  const graph = buildImportGraph(WORKER_ENTRY, SRC_ROOT);

  it('reaches no renderer UI components or stores', () => {
    expect(
      uiGraphOffenders(graph, REPO_ROOT),
      'analysis worker must only import pure analysis helpers (a worker has no window/document)',
    ).toEqual([]);
  });

  it('imports no UI framework packages', () => {
    const offenders = graph.bareImports
      .filter((entry) => UI_PACKAGES.some((pkg) => pkg.test(entry.specifier)))
      .map((entry) => `${relativeTo(REPO_ROOT, entry.from)} → ${entry.specifier}`);
    expect(offenders).toEqual([]);
  });

  it('resolves the analysis entry through the pure topology filter', () => {
    const repoPaths = graph.files.map((file) => relativeTo(REPO_ROOT, file));
    expect(repoPaths).toContain(
      path.join('src', 'renderer', 'lib', 'workers', 'analysisJobHandlers.ts'),
    );
    expect(repoPaths).toContain(
      path.join('src', 'renderer', 'lib', 'reticulum', 'reticulumTopologyRfFilter.ts'),
    );
  });

  it('matches UI packages at the package boundary, including subpaths', () => {
    const matches = (specifier: string): boolean =>
      UI_PACKAGES.some((pattern) => pattern.test(specifier));
    for (const blocked of [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'motion',
      'motion/react',
      'framer-motion',
      'framer-motion/client',
      'lucide-react',
      'lucide-react-motion',
    ]) {
      expect(matches(blocked), blocked).toBe(true);
    }
    for (const allowed of ['reactor', 'react-virtual', 'motion-dom', 'motion-utils', 'lucide']) {
      expect(matches(allowed), allowed).toBe(false);
    }
  });

  it('records side-effect imports and skips type-only imports', () => {
    withFixture(
      {
        'entry.ts': "import './side-effect';\nimport type { T } from './types-only';\n",
        'side-effect.ts': "import './ui';\nexport const sideEffect = 1;\n",
        'ui.tsx': 'export const Ui = 1;\n',
        'types-only.ts': 'export interface T {\n  x: number;\n}\n',
      },
      (fixtureGraph, root) => {
        expect(fixtureGraph.files.map((file) => path.basename(file))).toEqual([
          'entry.ts',
          'side-effect.ts',
          'ui.tsx',
        ]);

        const offenders = uiGraphOffenders(fixtureGraph, root);
        expect(offenders).toHaveLength(1);
        expect(offenders[0]).toContain('ui.tsx');
        expect(offenders[0]).toContain('side-effect.ts');
      },
    );
  });

  it('maps .js specifiers onto .ts / .tsx sources and follows their dependencies', () => {
    withFixture(
      {
        'entry.ts': "import './ui.js';\n",
        'ui.tsx': "import './dep.js';\nexport const Ui = 1;\n",
        'dep.ts': 'export const dep = 1;\n',
      },
      (graphWithTs) => {
        expect(graphWithTs.files.map((file) => path.basename(file))).toEqual([
          'dep.ts',
          'entry.ts',
          'ui.tsx',
        ]);
      },
    );

    withFixture(
      {
        'entry.ts': "import './ui.js';\n",
        'ui.js': 'export const direct = 1;\n',
        'ui.ts': 'export const source = 1;\n',
      },
      (graphWithJs) => {
        // A real .js file still wins over a same-named TS source.
        expect(graphWithJs.files.map((file) => path.basename(file))).toEqual(['entry.ts', 'ui.js']);
      },
    );
  });

  it('prefers a file over a same-named directory and falls back to index candidates', () => {
    withFixture(
      {
        'entry.ts': "import './folder';\n",
        'folder.ts': 'export const direct = 1;\n',
        'folder/index.ts': 'export const fromIndex = 1;\n',
      },
      (graphWithFile) => {
        expect(graphWithFile.files.map((file) => path.basename(file))).toEqual([
          'entry.ts',
          'folder.ts',
        ]);
      },
    );

    withFixture(
      {
        'entry.ts': "import './folder';\n",
        'folder/index.ts': 'export const fromIndex = 1;\n',
      },
      (graphWithIndex) => {
        expect(graphWithIndex.files.map((file) => path.basename(file))).toEqual([
          'entry.ts',
          'index.ts',
        ]);
      },
    );
  });
});
