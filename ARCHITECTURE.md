# FIXORA — Architecture & Design Rationale

## Core thesis
Verification should be empirical, not opinion-based. An LLM "reviewing" its
own or another LLM's fix is still just another opinion. Running the real
test suite — against the changed file AND its direct callers — is evidence.

## Design decisions and the judge questions they pre-answer

| Question a judge will ask | Answer built into the system |
|---|---|
| "How do you know the fix is actually correct?" | It's not asked to opine — the real test suite executes against it in an isolated worktree (`sandboxRunner.js`). Score = pass/fail, not a self-report. |
| "What if the fix breaks something else it touches?" | `blastRadius.js` finds direct callers of the changed function and their tests; `sandboxRunner.js` runs those too, separately from the file's own tests, so a candidate that passes locally but breaks a caller is caught, not hidden. |
| "What if the AI's fix is wrong?" | If no candidate passes both own and downstream tests, the pipeline escalates to a human via Telegram instead of merging anything (`pipeline.js`). |
| "Do you trust it blindly once tests pass?" | No autonomous merging at all — FIXORA always opens a PR and leaves the merge decision to the developer. Historical reliability (`confidenceCalibration.js`) is shown as evidence in the PR, not acted on. |
| "Does this respect why the code was written that way?" | `gitArchaeology.js` walks `git blame` to the introducing commit and feeds its commit message (developer intent) into the fix prompt and the PR's root-cause section. |
| "Can this bug come back?" | `regressionTestWriter.js` generates and commits a test reproducing the original failure, alongside the fix, in the same PR. |
| "How thorough is the blast-radius check, really?" | Direct callers only (single-hop, via repo-wide reference scan) — not a full transitive dependency graph. This is stated plainly in the PR body and README rather than oversold. |
| "Does this scale beyond a toy example?" | Candidate generation and evaluation run in parallel (`Promise.allSettled`); each candidate is isolated via `git worktree` so they never collide. |

## What blast-radius actually does (and doesn't)

`blastRadius.js`:
1. Extracts exported/callable identifiers from the changed file (function
   declarations, `module.exports`, `exports.x =`, arrow-function consts).
2. Scans all code files in the repo for ones that `require`/`import` the
   changed module AND reference one of those identifiers — these are the
   "direct callers."
3. Finds the test file(s) associated with each caller (either the caller
   file itself if it's a test, or a same-name `.test.js`/`.spec.js`
   sibling).
4. Returns that list to `sandboxRunner.js`, which runs those specific test
   files against each candidate fix as a distinct pass, so "my own tests
   pass" and "I didn't break a caller" are reported separately.

This is intentionally a **single-hop** check — it does not follow the call
graph transitively through multiple files. A full transitive graph is a
reasonable v2, but wasn't worth the risk of building something fragile
under time pressure when a single-hop check already turns "you might break
something else" from a hand-wave into a tested, evidenced claim.

## Supported error classes (v1)

Scoped narrowly on purpose:
1. `null-or-undefined-ref`
2. `missing-env-var`
3. `type-mismatch`

Anything else is classified as `unsupported` and escalated to a human
rather than guessed at (`logParser.classifyErrorClass`).

## Deliberately out of scope for this build

- **Full transitive blast-radius** across multi-hop call chains (v1 covers
  direct callers only — see above).
- **"Cost of the bug" ticker**: a rough downtime/cost estimate shown during
  the demo. Pure UI flourish, not core to correctness.
- **Counterfactual replay**: replaying the original broken deploy against
  the fixed code side-by-side. Good demo closer, time permitting.

## Extending to more error classes

Add a new extractor to `EXTRACTORS` in `logParser.js`, add a branch to
`classifyErrorClass`, and add the class name to `SUPPORTED_CLASSES` in
`pipeline.js`. No other changes needed — the rest of the pipeline,
including blast-radius and sandboxing, is error-class-agnostic.
