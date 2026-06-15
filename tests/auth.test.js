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

test("authorizer requires Google login for a blank active user", () => {
  const blank = createAuthorizer(() => "", () => "admin@example.com");

  assert.deepEqual(blank.requireAdmin(), {
    ok: false,
    code: "LOGIN_REQUIRED"
  });
});

test("authorizer rejects an identified user who is not allowlisted", () => {
  const stranger = createAuthorizer(
    () => "stranger@example.com",
    () => "admin@example.com"
  );

  assert.equal(stranger.requireAdmin().code, ERROR_CODES.UNAUTHORIZED);
});
