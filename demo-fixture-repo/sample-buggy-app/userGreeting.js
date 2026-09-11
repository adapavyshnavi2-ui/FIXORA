// Intentionally buggy for demo purposes: `user.profile.name` throws when
// `profile` is undefined (e.g. a new signup that hasn't completed onboarding).
function greetUser(user) {
  return `Hello, ${user.profile.name}!`;
}

module.exports = { greetUser };
