function greetUser(user) {
  const name = user?.profile?.name;
  return "Hello " + (name ?? "Unknown");
}

module.exports = { greetUser };