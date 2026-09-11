function greetUser(user) {
  const name = user && user.profile && user.profile.name;
  return "Hello " + (name ?? "Unknown");
}

module.exports = { greetUser };