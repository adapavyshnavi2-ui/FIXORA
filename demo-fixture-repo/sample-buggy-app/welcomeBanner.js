const { greetUser } = require('./userGreeting');

// This is the "downstream caller" blast-radius analysis should detect:
// it imports and calls greetUser, so a bad fix to userGreeting.js could
// break this file even if userGreeting.test.js itself passes.
function renderWelcomeBanner(user) {
  return `=== ${greetUser(user)} ===`;
}

module.exports = { renderWelcomeBanner };
