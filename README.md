# FIXORA

**FIXORA** is an AI-powered autonomous DevOps agent that diagnoses deployment
failures, generates multiple candidate fixes, and makes each one **prove
itself through real execution** — own tests, downstream/blast-radius tests,
and a generated regression test — before handing a fully-documented PR to a
developer for the final merge decision.

## The core idea

Most "AI fixer" bots ask a second LLM call whether a fix looks correct.
FIXORA doesn't trust opinions. Every candidate fix is written into an
isolated git worktree and the real test suite is executed against it —
both the tests for the file that broke, and tests for any other files that
directly call the changed function (blast-radius analysis). Only fixes
backed by that evidence reach a PR, and the merge decision always stays
with the developer.

## Pipeline

```
deploy log
   │
   ▼
logParser.js            → structured error + error class
   │
   ▼
gitArchaeology.js        → git blame → introducing commit → developer intent
   │
   ▼
candidateGenerator.js    → N diverse candidate fixes (parallel LLM calls)
   │
   ▼
blastRadius.js           → finds direct callers of the changed function
                            + the test files that exercise them
   │
   ▼
sandboxRunner.js          → each candidate run in an isolated worktree;
                            own tests AND downstream tests executed
                            (real pass/fail, not a model's self-assessment)
   │
   ▼
confidenceCalibration.js  → historical reliability for this error class
                            (shown as evidence in the PR, not acted on —
                            FIXORA never auto-merges)
   │
   ▼
regressionTestWriter.js   → generates a test that locks in the fix
   │
   ▼
githubPR.js               → PR with root cause, selected fix, test results,
                            blast-radius impact analysis, and regression
                            test — developer makes the final call
   │
   ▼
telegramBot.js             → status updates at every step
```

## Setup

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_OWNER/REPO, TELEGRAM_BOT_TOKEN/CHAT_ID
```

Point `LOCAL_REPO_PATH` in `.env` at a local clone of the repo you want
FIXORA to watch (needs the base branch, e.g. `Dev`, checked out and push
access via the token).

```bash
npm start
```

## Demo script (recommended run order for judges)

1. Use `demo-fixture-repo/sample-buggy-app` as your `LOCAL_REPO_PATH` target
   (copy it into a real git repo with a `Dev` branch and `npm test` wired to
   jest — see `demo-fixture-repo/README.md`). It includes both the buggy
   file (`userGreeting.js`) **and a downstream caller**
   (`welcomeBanner.js`) so blast-radius has something real to find.
2. `POST` the contents of `demo-fixture-repo/sample-error-log.txt` to
   `http://localhost:3000/demo/trigger` as
   `{ "log": "<paste>", "testCommand": "npx jest" }`.
3. Narrate live as Telegram messages arrive:
   - **"New error detected"** → shows classification
   - **"Blast-radius scan"** → shows `welcomeBanner.js` found as a direct
     caller, and its test queued to run — *this is the moment to point at:
     we're not just fixing the broken file, we're checking who else calls it*
   - **"Candidate results"** → shows 3 strategies, own-test AND
     downstream-test results per candidate — *this is the moment to say: we
     don't trust an LLM's opinion, we ran the tests, including on callers*
   - **"Fix ready"** → PR link, with root cause, blast-radius findings, and
     regression test all documented in the PR body
4. Open the PR in GitHub to show the full evidence package, and point out
   that FIXORA left the merge button for the developer.

### If venue wifi is unreliable

Record a full successful run beforehand as a backup video. Attempt live
first; fall back only if a step visibly fails.

## Honest scope notes (say these in Q&A, don't get caught by them)

- **Blast-radius** finds **direct callers** of the changed function via a
  repo-wide scan (single-hop). It is not a full transitive dependency graph
  across multi-hop call chains — that's the natural next iteration.
- Supported error classes in this MVP: `null-or-undefined-ref`,
  `missing-env-var`, `type-mismatch`. Anything else is classified as
  `unsupported` and escalated to a human rather than guessed at.
- FIXORA never auto-merges. The historical reliability score is shown in
  the PR as supporting evidence for the developer's decision, not acted on
  autonomously.

## Files

- `src/logParser.js` — parses raw logs into structured errors, classifies error class
- `src/gitArchaeology.js` — git blame + commit message → developer intent (root cause)
- `src/candidateGenerator.js` — parallel diverse candidate fix generation
- `src/blastRadius.js` — finds direct callers + their tests for impact analysis
- `src/sandboxRunner.js` — isolated worktree execution + real own/downstream test scoring
- `src/confidenceCalibration.js` — historical reliability ledger (informational, shown in PR)
- `src/regressionTestWriter.js` — generates a locking regression test
- `src/githubPR.js` — commits fix + regression test, opens PR with full evidence package
- `src/telegramBot.js` — status notifications
- `src/pipeline.js` — orchestrates all of the above
- `src/index.js` — webhook server entry point
- `demo-fixture-repo/` — a tiny buggy app (with a downstream caller) + sample log for a full live demo
