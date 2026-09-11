/**
 * blastRadius.js
 * Simplified but REAL blast-radius analysis: instead of a full transitive
 * dependency graph, this finds direct callers of the changed function
 * (via a repo-wide text/AST-lite search) and identifies test files that
 * touch those callers, so we can run real tests against real downstream
 * consumers of the change — not just the file that broke.
 *
 * Scope note (be upfront about this in Q&A): this catches DIRECT callers
 * of the changed function/export across the repo, not a full multi-hop
 * transitive graph. That's a documented next step, not a stretch claim.
 */

const fs = require('fs');
const path = require('path');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__fixora_tests__']);
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const TEST_FILE_RE = /(\.test\.|\.spec\.)/;

function walkRepo(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRepo(fullPath, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Extracts likely exported/callable function names from the changed file
 * so we know what identifiers to search for elsewhere in the repo.
 * Covers common patterns: `function foo(...)`, `exports.foo = `,
 * `module.exports = { foo }`, `const foo = (...) =>`.
 */
function extractExportedNames(fileContents) {
  const names = new Set();
  const patterns = [
    /function\s+([A-Za-z0-9_$]+)\s*\(/g,
    /exports\.([A-Za-z0-9_$]+)\s*=/g,
    /module\.exports\s*=\s*\{([^}]*)\}/g,
    /const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(fileContents)) !== null) {
      if (m[1].includes(',')) {
        // module.exports = { a, b, c } case
        m[1].split(',').forEach((n) => {
          const clean = n.trim().split(':')[0].trim();
          if (clean) names.add(clean);
        });
      } else {
        names.add(m[1].trim());
      }
    }
  }
  return [...names];
}

/**
 * @param {string} repoRoot
 * @param {string} changedFile - relative path of the file that was fixed
 * @param {string} changedFileContents
 * @returns {object} { callers: string[], testFilesToRun: string[], exportedNames: string[] }
 */
function analyzeBlastRadius(repoRoot, changedFile, changedFileContents) {
  const exportedNames = extractExportedNames(changedFileContents);
  if (exportedNames.length === 0) {
    return { exportedNames: [], callers: [], testFilesToRun: [], scopeNote: 'No exported identifiers detected; blast-radius scan skipped for this file.' };
  }

  const allFiles = walkRepo(repoRoot);
  const changedAbsPath = path.resolve(repoRoot, changedFile);

  const callers = [];
  for (const filePath of allFiles) {
    if (path.resolve(filePath) === changedAbsPath) continue;
    const contents = fs.readFileSync(filePath, 'utf8');

    // A "caller" = a file that both requires/imports the changed module
    // AND references one of its exported names elsewhere in the file.
    const importsChangedModule =
      contents.includes(`require('./${path.basename(changedFile, path.extname(changedFile))}`) ||
      contents.includes(`require("./${path.basename(changedFile, path.extname(changedFile))}`) ||
      contents.includes(`from './${path.basename(changedFile, path.extname(changedFile))}`);

    if (!importsChangedModule) continue;

    const usesExportedName = exportedNames.some((name) => new RegExp(`\\b${name}\\b`).test(contents.replace(/require\(.*?\)/g, '')));
    if (usesExportedName) {
      callers.push(path.relative(repoRoot, filePath));
    }
  }

  // Downstream tests = test files that are callers themselves, or that
  // sit alongside a caller file (common convention: foo.js + foo.test.js).
  const testFilesToRun = new Set();
  for (const caller of callers) {
    if (TEST_FILE_RE.test(caller)) {
      testFilesToRun.add(caller);
    } else {
      const dir = path.dirname(caller);
      const base = path.basename(caller, path.extname(caller));
      const candidateTest = allFiles
        .map((f) => path.relative(repoRoot, f))
        .find((f) => f.startsWith(path.join(dir, base)) && TEST_FILE_RE.test(f));
      if (candidateTest) testFilesToRun.add(candidateTest);
    }
  }

  return {
    exportedNames,
    callers,
    testFilesToRun: [...testFilesToRun],
    scopeNote: 'Direct callers only (single-hop). Not a full transitive dependency graph.',
  };
}

module.exports = { analyzeBlastRadius };
