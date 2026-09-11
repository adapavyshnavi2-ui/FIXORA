import { test } from 'node:test';
import assert from 'node:assert';
import { greetUser } from '../sample-buggy-app/userGreeting.js';

test('greetUser returns Hello Unknown when profile missing', () => {
  const result = greetUser({});
  assert.strictEqual(result, 'Hello Unknown');
});