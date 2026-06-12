const test = require("node:test");
const assert = require("node:assert/strict");

const { ERROR_CODES } = require("../src/Core");
const { createAuthorizer, parseAdminEmails } = require("../src/Auth");

test("parseAdminEmails normalizes and removes duplicates", () => {
  assert.deepEqual(
    parseAdminEmails("Admin@Example.com, owner@example.com\nadmin@example.com"),
    ["admin@example.com", "owner@example.com"]
  );
});

test("authorizer accepts an allowlisted active user", () => {
  const auth = createAuthorizer(
    () => "admin@example.com",
    () => "admin@example.com,owner@example.com"
  );

  assert.deepEqual(auth.requireAdmin(), {
    ok: true,
    email: "admin@example.com"
  });
});

test("authorizer rejects blank or unlisted users", () => {
  const blank = createAuthorizer(() => "", () => "admin@example.com");
  const stranger = createAuthorizer(
    () => "stranger@example.com",
    () => "admin@example.com"
  );

  assert.equal(blank.requireAdmin().code, ERROR_CODES.UNAUTHORIZED);
  assert.equal(stranger.requireAdmin().code, ERROR_CODES.UNAUTHORIZED);
});
