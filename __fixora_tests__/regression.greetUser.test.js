const { test } = require('node:test');
const assert = require('node:assert').strict;
const { greetUser } = require('../sample-buggy-app/userGreeting');

test('greetUser returns fallback when user profile name is missing', () => {
  const result = greetUser({});
  assert.equal(result, 'Hello Unknown');
});
