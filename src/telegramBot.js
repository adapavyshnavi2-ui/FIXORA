/**
 * telegramBot.js
 * Thin wrapper around node-telegram-bot-api for posting pipeline updates
 * and, when confidence is below the auto-merge threshold, asking a human
 * to approve or reject the PR via inline buttons.
 */

const TelegramBot = require('node-telegram-bot-api');

let bot;
function getBot() {
  if (!bot) {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  }
  return bot;
}

async function notify(message) {
  await getBot().sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
}

async function notifyPipelineStart(parsedError, errorClass) {
  await notify(
    `🔎 *New error detected*\n` +
    `Type: \`${parsedError.errorType}\`\n` +
    `Class: \`${errorClass}\`\n` +
    `Message: ${parsedError.message}\n` +
    `Generating and testing candidate fixes...`
  );
}

async function notifyBlastRadius(blastRadius) {
  if (!blastRadius || blastRadius.callers.length === 0) {
    await notify(`🕸️ *Blast-radius scan*\nNo direct callers found for the changed function(s). Proceeding with own-file tests only.`);
    return;
  }
  await notify(
    `🕸️ *Blast-radius scan*\n` +
    `Found ${blastRadius.callers.length} direct caller(s):\n` +
    blastRadius.callers.map((c) => `  - \`${c}\``).join('\n') +
    `\nRunning ${blastRadius.testFilesToRun.length} downstream test file(s) against each candidate.`
  );
}

async function notifyCandidateResults(evaluatedCandidates) {
  const lines = evaluatedCandidates.map((c) => {
    if (c.error) return `⚠️ \`${c.strategy}\` — errored: ${c.error}`;
    const own = c.ownTestsPassed ? '✅ own' : '❌ own';
    const downstream = c.downstreamTestsSkipped ? '(no downstream)' : (c.downstreamTestsPassed ? '✅ downstream' : '❌ downstream');
    return `${c.passed ? '✅' : '❌'} \`${c.strategy}\` — ${own}, ${downstream}`;
  });
  await notify(`🧪 *Candidate results*\n${lines.join('\n')}`);
}

async function notifyResult({ mergeDecision, prResult, regressionTest }) {
  const merged = prResult.autoMerged ? 'auto-merged ✅' : 'awaiting human approval ⏳';
  await notify(
    `🚀 *Fix ${merged}*\n` +
    `PR: ${prResult.prUrl}\n` +
    `Historical reliability: ${(mergeDecision.reliability * 100).toFixed(0)}%\n` +
    (regressionTest ? `Regression test added: \`${regressionTest.testFileName}\`\n` : '') +
    (prResult.autoMerged ? '' : 'Reply /approve or /reject to this PR when ready.')
  );
}

async function notifyUnsupported(parsedError, reason) {
  await notify(
    `⚠️ *Error not auto-handled*\n` +
    `Type: \`${parsedError?.errorType || 'unknown'}\`\n` +
    `Reason: ${reason}\n` +
    `Please investigate manually.`
  );
}

module.exports = { notify, notifyPipelineStart, notifyBlastRadius, notifyCandidateResults, notifyResult, notifyUnsupported };
