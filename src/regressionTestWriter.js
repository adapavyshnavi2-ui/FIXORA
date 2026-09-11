/**
 * regressionTestWriter.js
 * Once a candidate fix has empirically passed the sandbox run, generate a
 * small, focused regression test that reproduces the ORIGINAL failure mode
 * and asserts it no longer occurs. This test gets committed alongside the
 * fix so the same bug class can't silently regress later.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function buildPrompt(parsedError, winningCandidate, testFramework = 'jest') {
  return `Write ONE focused regression test using ${testFramework} that reproduces this original bug and asserts it is fixed.

Original error: ${parsedError.errorType}: ${parsedError.message}
File affected: ${parsedError.file}
Fix strategy applied: ${winningCandidate.strategy} - ${winningCandidate.explanation}

Fixed file contents:
\`\`\`
${winningCandidate.fullUpdatedFileContents}
\`\`\`

Respond with ONLY a JSON object, no markdown fences:
{
  "testFileName": "suggested file name for the test, e.g. regression.<shortdesc>.test.js",
  "testFileContents": "the full test file contents as a string"
}`;
}

async function writeRegressionTest(parsedError, winningCandidate, testFramework = 'jest') {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildPrompt(parsedError, winningCandidate, testFramework) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('\n').trim();
  const cleaned = text.replace(/^```json\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { writeRegressionTest };
