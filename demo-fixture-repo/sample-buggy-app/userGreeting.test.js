const { greetUser } = require('./userGreeting');

test('greets a user without a completed profile without crashing', () => {
  const newUser = { id: 42 }; // no `profile` yet
  expect(() => greetUser(newUser)).not.toThrow();
});

test('still greets a normal user correctly', () => {
  const user = { profile: { name: 'Asha' } };
  expect(greetUser(user)).toBe('Hello, Asha!');
});
