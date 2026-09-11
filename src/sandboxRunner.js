/**
 * sandboxRunner.js
 * The empirical core of the system: instead of asking an LLM whether a fix
 * looks correct, each candidate is written into an isolated git worktree
 * and the REAL test suite (or a generated micro-test targeting the bug)
 * is executed against it. Scoring is based on actual pass/fail output.
 *
 * Isolation: each candidate gets its own git worktree + temp dir, so
 * candidates never interfere with each other or with the main working copy.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');

const execFileAsync = promisify(execFile);

const TEST_TIMEOUT_MS = 60_000;

async function createWorktree(git, repoRoot, branchRef = 'HEAD') {
  const worktreeId = uuidv4().slice(0, 8);
  const worktreePath = path.join(os.tmpdir(), `fixora-${worktreeId}`);
  await git.raw(['worktree', 'add', '--detach', worktreePath, branchRef]);
  return worktreePath;
}

async function removeWorktree(git, worktreePath) {
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath]);
  } catch (err) {
    // best-effort cleanup; log and move on
    console.warn(`[sandbox] failed to remove worktree ${worktreePath}: ${err.message}`);
  }
}

async function runTestCommand(worktreePath, testCommand, extraArgs = []) {
  const [cmd, ...args] = testCommand.split(' ');
  try {
    const { stdout, stderr } = await execFileAsync(cmd, [...args, ...extraArgs], {
      cwd: worktreePath,
      timeout: TEST_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true, stdout, stderr };
  } catch (err) {
    return {
      passed: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code,
    };
  }
}

/**
 * Runs a single candidate fix in its own worktree and returns a score.
 * When `downstreamTestFiles` is provided (from blastRadius.js), those are
 * run as a SEPARATE pass so we can report "own tests" vs "downstream
 * tests" results independently — a candidate can pass its own test but
 * break a caller elsewhere, and we want that visible, not averaged away.
 *
 * @param {import('simple-git').SimpleGit} git
 * @param {string} repoRoot
 * @param {object} candidate - { strategy, fullUpdatedFileContents, ... }
 * @param {string} targetFile - relative path of the file being patched
 * @param {string} testCommand - e.g. "npm test" or "pytest -q"
 * @param {string[]} [downstreamTestFiles] - test files identified by blast-radius analysis
 */
async function evaluateCandidate(git, repoRoot, candidate, targetFile, testCommand, downstreamTestFiles = []) {
  const worktreePath = await createWorktree(git, repoRoot);
  try {
    const absTargetPath = path.join(worktreePath, targetFile);
    fs.writeFileSync(absTargetPath, candidate.fullUpdatedFileContents, 'utf8');

    const ownResult = await runTestCommand(worktreePath, testCommand);

    let downstreamResult = { passed: true, stdout: '', stderr: '', skipped: true };
    if (downstreamTestFiles.length > 0) {
      downstreamResult = await runTestCommand(worktreePath, testCommand, downstreamTestFiles);
      downstreamResult.skipped = false;
    }

    return {
      strategy: candidate.strategy,
      explanation: candidate.explanation,
      passed: ownResult.passed && downstreamResult.passed,
      ownTestsPassed: ownResult.passed,
      downstreamTestsPassed: downstreamResult.passed,
      downstreamTestsSkipped: downstreamResult.skipped,
      downstreamTestFiles,
      stdout: ownResult.stdout.slice(-4000),
      stderr: ownResult.stderr.slice(-4000),
      downstreamStdout: downstreamResult.stdout.slice(-4000),
      downstreamStderr: downstreamResult.stderr.slice(-4000),
      fullUpdatedFileContents: candidate.fullUpdatedFileContents,
    };
  } finally {
    await removeWorktree(git, worktreePath);
  }
}

/**
 * Evaluates all candidates in parallel and returns them sorted best-first.
 * "Best" = passed both own + downstream tests, tie-broken by the model's
 * own confidence estimate.
 */
async function evaluateAllCandidates(git, repoRoot, candidates, targetFile, testCommand, downstreamTestFiles = []) {
  const results = await Promise.allSettled(
    candidates.map((c) => evaluateCandidate(git, repoRoot, c, targetFile, testCommand, downstreamTestFiles))
  );

  const evaluated = results
    .map((r, i) => (r.status === 'fulfilled' ? r.value : { strategy: candidates[i].strategy, passed: false, error: r.reason.message }))
    .sort((a, b) => (b.passed - a.passed) || ((b.confidenceSelfEstimate || 0) - (a.confidenceSelfEstimate || 0)));

  return evaluated;
}

module.exports = { evaluateAllCandidates, evaluateCandidate };
