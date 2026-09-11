const test = require("node:test");
const assert = require("node:assert");
const { greetUser } = require("./userGreeting");

test("greets a user", () => {
  assert.strictEqual(
    greetUser({ profile: { name: "Vyshnavi" } }),
    "Hello Vyshnavi"
  );
});

test("handles missing profile safely", () => {
  assert.strictEqual(
    greetUser({}),
    "Hello Unknown"
  );
});
