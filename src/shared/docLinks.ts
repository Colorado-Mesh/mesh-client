import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

export interface BrokenDocLink {
  sourceFile: string;
  line: number;
  urlOrTarget: string;
  resolvedPath: string;
}

const MESH_CLIENT_BLOB_RE =
  /https:\/\/github\.com\/Colorado-Mesh\/mesh-client\/blob\/main\/([^\s"'#)]+)/g;

const RELATIVE_DOC_LINK_RE = /\]\((docs\/[^)#]+\.md)/g;

const ROOT_MARKDOWN = ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md'] as const;

function collectFilesRecursive(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...collectFilesRecursive(full, extensions));
    } else if (extensions.some((ext) => ent.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function collectScanFiles(repoRoot: string): string[] {
  const files: string[] = [];

  files.push(...collectFilesRecursive(join(repoRoot, 'src/renderer'), ['.ts', '.tsx']));

  for (const name of ROOT_MARKDOWN) {
    const path = join(repoRoot, name);
    if (existsSync(path)) files.push(path);
  }

  files.push(...collectFilesRecursive(join(repoRoot, 'docs'), ['.md']));
  files.push(...collectFilesRecursive(join(repoRoot, '.github'), ['.md']));

  return files;
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Extract repo-relative doc paths from blob URLs and `](docs/...)` markdown links. */
export function extractDocLinkTargets(content: string): string[] {
  const targets: string[] = [];

  let match: RegExpExecArray | null;
  MESH_CLIENT_BLOB_RE.lastIndex = 0;
  while ((match = MESH_CLIENT_BLOB_RE.exec(content)) !== null) {
    targets.push(match[1]);
  }

  RELATIVE_DOC_LINK_RE.lastIndex = 0;
  while ((match = RELATIVE_DOC_LINK_RE.exec(content)) !== null) {
    targets.push(match[1]);
  }

  return targets;
}

/** Returns doc links in scanned sources whose target file is missing from the repo. */
export function findBrokenDocLinks(repoRoot: string): BrokenDocLink[] {
  const broken: BrokenDocLink[] = [];
  const scanFiles = collectScanFiles(repoRoot);

  for (const sourceFile of scanFiles) {
    const content = readFileSync(sourceFile, 'utf8');
    const relSource = relative(repoRoot, sourceFile);

    let match: RegExpExecArray | null;
    MESH_CLIENT_BLOB_RE.lastIndex = 0;
    while ((match = MESH_CLIENT_BLOB_RE.exec(content)) !== null) {
      const target = match[1];
      const resolvedPath = join(repoRoot, target);
      if (!existsSync(resolvedPath)) {
        broken.push({
          sourceFile: relSource,
          line: lineNumberAt(content, match.index),
          urlOrTarget: match[0],
          resolvedPath: target,
        });
      }
    }

    RELATIVE_DOC_LINK_RE.lastIndex = 0;
    while ((match = RELATIVE_DOC_LINK_RE.exec(content)) !== null) {
      const target = match[1];
      const resolvedPath = join(repoRoot, target);
      if (!existsSync(resolvedPath)) {
        broken.push({
          sourceFile: relSource,
          line: lineNumberAt(content, match.index),
          urlOrTarget: `](${target})`,
          resolvedPath: target,
        });
      }
    }
  }

  return broken;
}
