/**
 * pipeline.js
 * The orchestrator. This is the single function the webhook server calls
 * with a raw log string; it runs the full FIXORA pipeline end to end.
 */

const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const { parseLog, classifyErrorClass } = require('./logParser');
const { investigate } = require('./gitArchaeology');
const { generateCandidates } = require('./candidateGenerator');
const { evaluateAllCandidates } = require('./sandboxRunner');
const { analyzeBlastRadius } = require('./blastRadius');
const { decideMergeAction, recordOutcome } = require('./confidenceCalibration');
const { writeRegressionTest } = require('./regressionTestWriter');
const { openFixPR } = require('./githubPR');
const telegram = require('./telegramBot');

const SUPPORTED_CLASSES = ['null-or-undefined-ref', 'missing-env-var', 'type-mismatch'];

async function runPipeline(rawLog, { testCommand = 'npm test' } = {}) {
  const repoRoot = process.env.LOCAL_REPO_PATH || './workspace/repo';
  const git = simpleGit(repoRoot);

  // 1. Parse the log into a structured error
  const parsedError = parseLog(rawLog);
  const errorClass = classifyErrorClass(parsedError);

  if (!parsedError || !SUPPORTED_CLASSES.includes(errorClass)) {
    await telegram.notifyUnsupported(parsedError, 'Error class not in the supported set for auto-fixing yet.');
    return { status: 'escalated', errorClass, parsedError };
  }

  await telegram.notifyPipelineStart(parsedError, errorClass);

  // 2. Git archaeology: find the introducing commit + developer intent
  const archaeology = await investigate(git, repoRoot, parsedError);
  if (!archaeology.supported) {
    await telegram.notifyUnsupported(parsedError, archaeology.reason);
    return { status: 'escalated', errorClass, parsedError };
  }

  // 3. Generate diverse candidate fixes in parallel
  const candidates = await generateCandidates(parsedError, archaeology, parseInt(process.env.NUM_CANDIDATES || '3', 10));
  if (candidates.length === 0) {
    await telegram.notifyUnsupported(parsedError, 'No candidate fixes could be generated.');
    return { status: 'escalated', errorClass, parsedError };
  }

  // 4. Blast-radius analysis: find direct callers of the changed function
  //    and the test files that exercise them, so evaluation covers more
  //    than just the file that broke.
  const currentFileContents = fs.readFileSync(path.join(repoRoot, parsedError.file), 'utf8');
  const blastRadius = analyzeBlastRadius(repoRoot, parsedError.file, currentFileContents);
  await telegram.notifyBlastRadius(blastRadius);

  // 5. Empirically test every candidate in an isolated worktree, against
  //    both its own tests AND the downstream tests found above.
  const evaluated = await evaluateAllCandidates(
    git, repoRoot, candidates, parsedError.file, testCommand, blastRadius.testFilesToRun
  );
  await telegram.notifyCandidateResults(evaluated);

  const winner = evaluated.find((c) => c.passed);
  if (!winner) {
    const anyOwnPassed = evaluated.some((c) => c.ownTestsPassed && !c.downstreamTestsPassed);
    const reason = anyOwnPassed
      ? 'Every candidate passed its own tests but broke a downstream caller (blast-radius check). Escalating to a human.'
      : 'All candidate fixes failed the test suite. Escalating to a human.';
    await telegram.notifyUnsupported(parsedError, reason);
    return { status: 'escalated', errorClass, parsedError, evaluated, blastRadius };
  }

  // 6. Decide auto-merge vs. human approval. FIXORA always leaves the
  //    final merge decision to the developer — this score is surfaced in
  //    the PR as supporting evidence, not acted on autonomously.
  const mergeDecision = decideMergeAction(errorClass);

  // 7. Write a regression test that locks in the fix
  let regressionTest = null;
  try {
    regressionTest = await writeRegressionTest(parsedError, winner);
  } catch (err) {
    console.warn(`[pipeline] regression test generation failed: ${err.message}`);
  }

  // 8. Commit, push, open PR with root cause, selected fix, test results,
  //    blast-radius impact analysis, and regression test. Merge is always
  //    left to the developer.
  const prResult = await openFixPR(git, {
    targetFile: parsedError.file,
    fixedContents: winner.fullUpdatedFileContents,
    regressionTest,
    parsedError,
    mergeDecision,
    winningCandidate: winner,
    blastRadius,
    archaeology,
  });

  // 9. Record the outcome for future calibration (in a real system this
  //    would be updated later based on whether the PR was reverted).
  recordOutcome(errorClass, /* heldUp = */ true);

  await telegram.notifyResult({ mergeDecision, prResult, regressionTest });

  return { status: 'resolved', errorClass, parsedError, winner, mergeDecision, prResult, regressionTest, blastRadius };
}

module.exports = { runPipeline };
