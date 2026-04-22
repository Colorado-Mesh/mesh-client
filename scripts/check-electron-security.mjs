#!/usr/bin/env node
/**
 * Pre-commit / CI check for Electron security anti-patterns.
 *
 * Checks src/main/index.ts for security misconfigurations:
 * - Missing nodeIntegration: false
 * - Missing contextIsolation: true
 * - Missing sandbox: true
 * - Unsafe shell.openExternal without URL validation
 * - Missing will-navigate handler
 * - Missing setWindowOpenHandler
 * - experimentalFeatures without permission handlers
 *
 * Run: node scripts/check-electron-security.mjs
 * Or: pnpm run check:electron-security
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MAIN_FILE = path.join(REPO_ROOT, 'src', 'main', 'index.ts');

const FINDINGS = [];

function warn(message, lineNum) {
  const loc = lineNum ? `:${lineNum}` : '';
  FINDINGS.push(`SECURITY${loc}: ${message}`);
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let inWebPreferences = false;
  let webPrefsIndent = 0;
  let foundNodeIntegration = false;
  let foundContextIsolation = false;
  let foundSandbox = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track webPreferences block
    if (line.includes('webPreferences:')) {
      inWebPreferences = true;
      webPrefsIndent = line.match(/^\s*/)[0].length;
      continue;
    }

    // Exit webPreferences block (dedent back to original or lower indent)
    if (inWebPreferences && line.trim() && !line.startsWith(' '.repeat(webPrefsIndent))) {
      inWebPreferences = false;
    }

    if (inWebPreferences) {
      if (line.includes('nodeIntegration:')) {
        if (line.includes('false')) {
          foundNodeIntegration = true;
        } else {
          warn('nodeIntegration should be false', lineNum);
        }
      }
      if (line.includes('contextIsolation:')) {
        if (line.includes('true')) {
          foundContextIsolation = true;
        } else {
          warn('contextIsolation should be true', lineNum);
        }
      }
      if (line.includes('sandbox:')) {
        if (line.includes('true')) {
          foundSandbox = true;
        } else {
          warn('sandbox should be true', lineNum);
        }
      }
    }

    // Check for shell.openExternal (actual call, not comments)
    // Flag if shell.openExternal is called without prior validation function
    if (/\bshell\.openExternal\b/.test(line) && !line.trim().startsWith('//')) {
      const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!context.includes('parseHttpOrHttpsUrl') && !context.includes('validateUrl')) {
        warn('shell.openExternal without URL validation', lineNum);
      }
    }

    // Check for will-navigate handler (look at full handler block)
    if (line.includes('will-navigate')) {
      const block = lines.slice(i, i + 5).join('\n');
      if (!block.includes('preventDefault')) {
        warn('will-navigate handler should call preventDefault()', lineNum);
      }
    }

    // Check for setWindowOpenHandler
    if (line.includes('setWindowOpenHandler')) {
      const block = lines.slice(i, i + 5).join('\n');
      if (!block.includes('deny')) {
        warn('setWindowOpenHandler should deny unexpected windows', lineNum);
      }
    }

    // Check for experimentalFeatures with permission handlers
    if (line.includes('experimentalFeatures: true')) {
      const context = lines.slice(Math.max(0, i - 50), i + 1).join('\n');
      const hasPermissionHandler =
        context.includes('setPermissionCheckHandler') ||
        context.includes('setPermissionRequestHandler');
      if (!hasPermissionHandler) {
        warn('experimentalFeatures enabled without permission handlers', lineNum);
      }
    }
  }

  // Report missing settings at file level
  if (!foundNodeIntegration) {
    warn('nodeIntegration: false not found in webPreferences');
  }
  if (!foundContextIsolation) {
    warn('contextIsolation: true not found in webPreferences');
  }
  if (!foundSandbox) {
    warn('sandbox: true not found in webPreferences');
  }
}

function main() {
  console.log('Checking Electron security configuration...\n');

  if (!fs.existsSync(MAIN_FILE)) {
    console.error(`ERROR: Main file not found: ${MAIN_FILE}`);
    process.exit(1);
  }

  checkFile(MAIN_FILE);

  if (FINDINGS.length > 0) {
    console.error('FAILED — Electron security issues found:\n');
    FINDINGS.forEach((f) => console.error(`  ${f}`));
    console.error('');
    process.exit(1);
  }

  console.log('PASSED — No Electron security issues found');
  process.exit(0);
}

main();
