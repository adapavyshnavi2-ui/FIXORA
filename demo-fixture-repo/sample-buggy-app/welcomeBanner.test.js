const { renderWelcomeBanner } = require('./welcomeBanner');

test('renders a welcome banner for a user without a completed profile', () => {
  const newUser = { id: 7 };
  expect(() => renderWelcomeBanner(newUser)).not.toThrow();
});

test('renders a welcome banner for a normal user', () => {
  const user = { profile: { name: 'Rohit' } };
  expect(renderWelcomeBanner(user)).toBe('=== Hello, Rohit! ===');
});
