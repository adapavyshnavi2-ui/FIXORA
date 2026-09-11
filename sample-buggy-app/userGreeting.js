function greetUser(user) {
  return "Hello " + (user?.profile?.name ?? "Unknown");
}

module.exports = { greetUser };
