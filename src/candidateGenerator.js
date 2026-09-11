/**
 * candidateGenerator.js
 * Generates multiple *diverse* candidate fixes in parallel by giving the
 * model different strategy framings. Diversity matters more than one
 * "best" attempt — the sandbox runner decides which one actually works.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const STRATEGIES = [
  {
    name: 'minimal-patch',
    instruction:
      'Make the smallest possible change that fixes the error. Do not refactor or restructure anything else.',
  },
  {
    name: 'defensive-guard',
    instruction:
      'Fix the error by adding proper defensive checks (null/undefined guards, type checks, input validation) around the failure point, in addition to the direct fix.',
  },
  {
    name: 'intent-aligned-rewrite',
    instruction:
      'Given the original commit message describing what this code was trying to do, fix the error in a way that best preserves and fulfills that original intent, even if it requires a small rewrite of the surrounding logic.',
  },
];

function buildPrompt(strategy, parsedError, archaeology) {
  return `You are fixing a production error. Respond with ONLY a JSON object, no markdown fences, no commentary.

Error type: ${parsedError.errorType}
Error message: ${parsedError.message}
File: ${parsedError.file}
Line: ${parsedError.line}

Original commit that introduced this code:
  Commit: ${archaeology.introducingCommit || 'unknown'}
  Commit message (developer intent): ${archaeology.introducingCommitMessage || 'unknown'}

Current file contents (lines ${archaeology.fileWindow?.windowStart}-${archaeology.fileWindow?.windowEnd}):
\`\`\`
${archaeology.fileWindow?.windowContents || '(unavailable)'}
\`\`\`

Strategy for this fix: ${strategy.instruction}

Return JSON exactly in this shape:
{
  "strategy": "${strategy.name}",
  "explanation": "one or two sentence explanation of the fix",
  "fullUpdatedFileContents": "the ENTIRE file with your fix applied, as a single string",
  "confidenceSelfEstimate": 0.0
}`;
}

async function callClaude(prompt) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('\n').trim();
  const cleaned = text.replace(/^```json\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * @param {object} parsedError
 * @param {object} archaeology
 * @param {number} n - number of candidates to generate (defaults to all strategies)
 * @returns {Promise<object[]>} array of candidate fix objects
 */
async function generateCandidates(parsedError, archaeology, n = STRATEGIES.length) {
  const chosen = STRATEGIES.slice(0, n);
  const results = await Promise.allSettled(
    chosen.map((strategy) => callClaude(buildPrompt(strategy, parsedError, archaeology)))
  );

  return results
    .map((r, i) => (r.status === 'fulfilled' ? r.value : { strategy: chosen[i].name, error: r.reason.message }))
    .filter((c) => !c.error);
}

module.exports = { generateCandidates, STRATEGIES };
