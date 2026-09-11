/**
 * githubPR.js
 * Handles committing the winning fix (and its regression test) to a new
 * branch off the configured base branch, and opening a PR back into it.
 * Uses simple-git for local commits + push, and Octokit for the PR itself.
 */

const { Octokit } = require('@octokit/rest');

function getOctokit() {
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}

/**
 * @param {import('simple-git').SimpleGit} git - git instance in the real (non-worktree) repo checkout
 * @param {object} params
 * @param {string} params.targetFile - relative path of the fixed file
 * @param {string} params.fixedContents - final file contents to write
 * @param {object} [params.regressionTest] - { testFileName, testFileContents }
 * @param {object} params.parsedError
 * @param {object} params.mergeDecision - output of confidenceCalibration.decideMergeAction (shown as evidence only)
 * @param {object} params.winningCandidate
 * @param {object} [params.blastRadius] - output of blastRadius.analyzeBlastRadius
 * @param {object} [params.archaeology] - output of gitArchaeology.investigate (root cause context)
 */
async function openFixPR(git, { targetFile, fixedContents, regressionTest, parsedError, mergeDecision, winningCandidate, blastRadius, archaeology }) {
  const baseBranch = process.env.GITHUB_BASE_BRANCH || 'Dev';
  const branchName = `fixora/${parsedError.errorType.toLowerCase()}-${Date.now()}`;

  await git.checkout(baseBranch);
  await git.pull('origin', baseBranch);
  await git.checkoutLocalBranch(branchName);

  const fs = require('fs');
  const path = require('path');
  const repoRoot = (await git.revparse(['--show-toplevel'])).trim();

  fs.writeFileSync(path.join(repoRoot, targetFile), fixedContents, 'utf8');
  await git.add(targetFile);

  if (regressionTest) {
    const testDir = path.join(repoRoot, '__fixora_tests__');
    fs.mkdirSync(testDir, { recursive: true });
    const testPath = path.join(testDir, regressionTest.testFileName);
    fs.writeFileSync(testPath, regressionTest.testFileContents, 'utf8');
    await git.add(path.relative(repoRoot, testPath));
  }

  const commitMessage = `fixora: resolve ${parsedError.errorType} in ${targetFile}\n\nStrategy: ${winningCandidate.strategy}\n${winningCandidate.explanation}`;
  await git.commit(commitMessage);
  await git.push('origin', branchName);

  const octokit = getOctokit();
  const { data: pr } = await octokit.pulls.create({
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    head: branchName,
    base: baseBranch,
    title: `[FIXORA] ${parsedError.errorType}: ${parsedError.message.slice(0, 80)}`,
    body: buildPRBody({ parsedError, mergeDecision, winningCandidate, regressionTest, blastRadius, archaeology }),
  });

  // FIXORA always leaves the final merge decision to the developer —
  // it never auto-merges. The reliability score above is evidence in the
  // PR, not an autonomous merge trigger.
  return { branchName, prUrl: pr.html_url, prNumber: pr.number, autoMerged: false };
}

function buildPRBody({ parsedError, mergeDecision, winningCandidate, regressionTest, blastRadius, archaeology }) {
  const callerLines = blastRadius && blastRadius.callers.length > 0
    ? blastRadius.callers.map((c) => `  - \`${c}\``).join('\n')
    : '  - none found';
  const downstreamTestLines = blastRadius && blastRadius.testFilesToRun.length > 0
    ? blastRadius.testFilesToRun.map((t) => `  - \`${t}\` — ${winningCandidate.downstreamTestsPassed ? 'passed ✅' : 'FAILED ❌'}`).join('\n')
    : '  - none identified (no direct callers found, or blast-radius scan skipped for this file type)';

  return [
    `## Root cause`,
    `**Error**: ${parsedError.errorType}: ${parsedError.message}`,
    `**File**: \`${parsedError.file}\`${parsedError.line ? `:${parsedError.line}` : ''}`,
    archaeology?.introducingCommit ? `**Introduced in commit**: \`${archaeology.introducingCommit}\`` : '',
    archaeology?.introducingCommitMessage ? `**Original intent**: ${archaeology.introducingCommitMessage.split('\n')[0]}` : '',
    ``,
    `## Selected fix`,
    `**Strategy**: ${winningCandidate.strategy}`,
    `**Why**: ${winningCandidate.explanation}`,
    ``,
    `## Test results (real execution, not an LLM opinion)`,
    `- Own tests: ${winningCandidate.ownTestsPassed ? 'passed ✅' : 'FAILED ❌'}`,
    `- Downstream/blast-radius tests: ${winningCandidate.downstreamTestsSkipped ? 'skipped (no callers found)' : (winningCandidate.downstreamTestsPassed ? 'passed ✅' : 'FAILED ❌')}`,
    `- Other candidate strategies attempted but not selected: see bot log for full comparison.`,
    ``,
    `## Impact analysis (blast radius)`,
    `Scope: ${blastRadius?.scopeNote || 'not run'}`,
    `Direct callers of the changed export(s):`,
    callerLines,
    `Downstream tests executed against this fix:`,
    downstreamTestLines,
    ``,
    `## Regression test`,
    regressionTest ? `Added: \`__fixora_tests__/${regressionTest.testFileName}\` — reproduces the original failure and asserts it's resolved.` : 'Not generated for this fix.',
    ``,
    `## Historical reliability (informational only)`,
    `${(mergeDecision.reliability * 100).toFixed(0)}% of past auto-generated fixes for this error class have held up without revert (threshold for reference: ${(mergeDecision.threshold * 100).toFixed(0)}%).`,
    `**Merge decision is left to you** — FIXORA does not auto-merge.`,
    ``,
    `_Opened automatically by FIXORA._`,
  ].filter(Boolean).join('\n');
}

module.exports = { openFixPR };
