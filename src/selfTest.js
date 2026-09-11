/**
 * selfTest.js
 * Quick, no-API-key-needed sanity check for the parts of FIXORA that don't
 * require network calls: log parsing, classification, and blast-radius
 * detection against the bundled demo fixture. Run with:
 *   npm run test:self
 */

const path = require('path');
const { parseLog, classifyErrorClass } = require('./logParser');
const { analyzeBlastRadius } = require('./blastRadius');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${message}`);
  }
}

function main() {
  const sampleLog = `TypeError: Cannot read properties of undefined (reading 'name')
    at greetUser (/sample-buggy-app/userGreeting.js:4:30)
    at Object.<anonymous> (/sample-buggy-app/userGreeting.test.js:9:20)`;

  const parsed = parseLog(sampleLog);
  assert(parsed !== null, 'log parser extracts a structured error');
  assert(parsed && parsed.errorType === 'TypeError', 'error type classified as TypeError');
  assert(parsed && parsed.file.endsWith('userGreeting.js'), 'primary file extracted correctly');

  const errorClass = classifyErrorClass(parsed);
  assert(errorClass === 'type-mismatch' || errorClass === 'null-or-undefined-ref', `error classified into a supported class (got: ${errorClass})`);

  const fixtureRoot = path.join(__dirname, '..', 'demo-fixture-repo', 'sample-buggy-app');
  const fs = require('fs');
  const changedFileContents = fs.readFileSync(path.join(fixtureRoot, 'userGreeting.js'), 'utf8');
  const blastRadius = analyzeBlastRadius(fixtureRoot, 'userGreeting.js', changedFileContents);

  assert(blastRadius.exportedNames.includes('greetUser'), 'blast-radius extracts the exported function name');
  assert(blastRadius.callers.some((c) => c.includes('welcomeBanner.js')), 'blast-radius finds welcomeBanner.js as a direct caller');
  assert(blastRadius.testFilesToRun.some((t) => t.includes('welcomeBanner.test.js')), 'blast-radius identifies the downstream test file to run');

  console.log('\nSelf-test complete. (This does not call the Anthropic or GitHub APIs.)');
}

main();
