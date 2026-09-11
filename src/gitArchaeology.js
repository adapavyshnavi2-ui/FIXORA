/**
 * gitArchaeology.js
 * Given a file + line number, walks git history to find:
 *   - the commit that last touched that line (git blame)
 *   - that commit's message (a proxy for "developer intent")
 *   - the current contents of the file, plus a small window of surrounding lines
 *
 * This context gets fed to the candidate generator so fixes respect *why*
 * the code was written that way, not just what broke.
 */

const fs = require('fs');
const path = require('path');

async function getBlameForLine(git, filePath, lineNumber) {
  try {
    const raw = await git.raw(['blame', '-L', `${lineNumber},${lineNumber}`, '--porcelain', filePath]);
    const commitHash = raw.split('\n')[0].split(' ')[0];
    const summaryMatch = raw.match(/summary (.*)/);
    const authorMatch = raw.match(/author (.*)/);
    return {
      commitHash,
      commitSummary: summaryMatch ? summaryMatch[1] : null,
      author: authorMatch ? authorMatch[1] : null,
    };
  } catch (err) {
    return { commitHash: null, commitSummary: null, author: null, error: err.message };
  }
}

async function getCommitMessage(git, commitHash) {
  if (!commitHash) return null;
  try {
    const msg = await git.raw(['log', '-1', '--pretty=%B', commitHash]);
    return msg.trim();
  } catch {
    return null;
  }
}

function readFileWindow(repoRoot, filePath, lineNumber, windowSize = 15) {
  const fullPath = path.join(repoRoot, filePath);
  if (!fs.existsSync(fullPath)) return null;
  const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
  const start = Math.max(0, (lineNumber || 1) - windowSize);
  const end = Math.min(lines.length, (lineNumber || 1) + windowSize);
  return {
    fullFileContents: lines.join('\n'),
    windowStart: start + 1,
    windowEnd: end,
    windowContents: lines.slice(start, end).join('\n'),
  };
}

/**
 * @param {import('simple-git').SimpleGit} git - simple-git instance rooted at repoRoot
 * @param {string} repoRoot
 * @param {object} parsedError - output of logParser.parseLog
 * @returns {object} archaeology context to pass to the candidate generator
 */
async function investigate(git, repoRoot, parsedError) {
  if (!parsedError.file || !parsedError.line) {
    return { supported: false, reason: 'No file/line info available for this error class.' };
  }

  const blame = await getBlameForLine(git, parsedError.file, parsedError.line);
  const commitMessage = await getCommitMessage(git, blame.commitHash);
  const fileWindow = readFileWindow(repoRoot, parsedError.file, parsedError.line);

  return {
    supported: true,
    file: parsedError.file,
    line: parsedError.line,
    introducingCommit: blame.commitHash,
    introducingCommitMessage: commitMessage,
    author: blame.author,
    fileWindow,
  };
}

module.exports = { investigate };
