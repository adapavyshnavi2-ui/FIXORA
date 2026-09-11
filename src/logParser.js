/**
 * logParser.js
 * Turns a raw deploy log / stack trace string into a structured error object:
 * { errorType, message, file, line, column, stackFrames[], rawLog }
 *
 * Supports Node.js style stack traces (most Vercel/Railway Node deploys) out of the box.
 * Extend `EXTRACTORS` to add support for Python tracebacks, etc.
 */

const STACK_LINE_RE = /at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?/;

function parseNodeStackTrace(rawLog) {
  const lines = rawLog.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const headerLine = lines[0];
  const headerMatch = headerLine.match(/^(\w+Error|Error):\s*(.*)$/);
  const errorType = headerMatch ? headerMatch[1] : 'UnknownError';
  const message = headerMatch ? headerMatch[2] : headerLine;

  const stackFrames = [];
  for (const line of lines.slice(1)) {
    const m = line.match(STACK_LINE_RE);
    if (m) {
      const [, fnName, file, ln, col] = m;
      // Skip node_modules / internal frames — we care about user code
      if (file && !file.includes('node_modules') && !file.startsWith('node:')) {
        stackFrames.push({
          function: fnName || '<anonymous>',
          file,
          line: parseInt(ln, 10),
          column: parseInt(col, 10),
        });
      }
    }
  }

  if (stackFrames.length === 0) return null;

  const primary = stackFrames[0];
  return {
    errorType,
    message,
    file: primary.file,
    line: primary.line,
    column: primary.column,
    stackFrames,
    rawLog,
  };
}

function parseMissingEnvVar(rawLog) {
  // Common pattern: "ReferenceError: X is not defined" or explicit "Missing required env var: X"
  const m = rawLog.match(/Missing (?:required )?env(?:ironment)? var(?:iable)?s?:?\s*([A-Z0-9_]+)/i);
  if (!m) return null;
  return {
    errorType: 'MissingEnvVar',
    message: `Missing environment variable: ${m[1]}`,
    envVar: m[1],
    file: null,
    line: null,
    stackFrames: [],
    rawLog,
  };
}

const EXTRACTORS = [parseMissingEnvVar, parseNodeStackTrace];

/**
 * @param {string} rawLog - raw log text from the deploy platform
 * @returns {object|null} structured error, or null if no supported pattern matched
 */
function parseLog(rawLog) {
  for (const extractor of EXTRACTORS) {
    const result = extractor(rawLog);
    if (result) return result;
  }
  return null;
}

/**
 * Classifies a parsed error into one of the three supported error classes
 * for this MVP. Anything else is flagged as "unsupported" so the pipeline
 * can escalate to a human instead of guessing.
 */
function classifyErrorClass(parsedError) {
  if (!parsedError) return 'unsupported';
  if (parsedError.errorType === 'MissingEnvVar') return 'missing-env-var';
  if (parsedError.errorType === 'TypeError') return 'type-mismatch';
  if (parsedError.errorType === 'ReferenceError' || /undefined|null/i.test(parsedError.message)) {
    return 'null-or-undefined-ref';
  }
  return 'unsupported';
}

module.exports = { parseLog, classifyErrorClass };
