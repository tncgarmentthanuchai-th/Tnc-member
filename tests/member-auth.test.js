const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validatePin,
  hashPin,
  verifyPin,
  createSessionToken,
  verifySessionToken
} = require("../src/MemberAuth");

test("validatePin accepts exactly six digits", () => {
  assert.equal(validatePin("123456"), true);
  assert.equal(validatePin("12345"), false);
  assert.equal(validatePin("12345a"), false);
});

test("hashPin is salted and verifyPin checks the original PIN", () => {
  const first = hashPin("123456", "salt-a");
  const second = hashPin("123456", "salt-b");

  assert.notEqual(first, second);
  assert.equal(verifyPin("123456", "salt-a", first), true);
  assert.equal(verifyPin("654321", "salt-a", first), false);
});

test("signed session token expires and enforces session version", () => {
  const now = Date.parse("2026-06-11T10:00:00.000Z");
  const token = createSessionToken(
    { memberId: "TNC-000001", sessionVersion: 2 },
    "test-secret",
    now
  );

  assert.deepEqual(
    verifySessionToken(token, "test-secret", now + 1000, 2),
    {
      memberId: "TNC-000001",
      sessionVersion: 2,
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    }
  );
  assert.equal(verifySessionToken(token, "wrong-secret", now + 1000, 2), null);
  assert.equal(verifySessionToken(token, "test-secret", now + 1000, 3), null);
  assert.equal(
    verifySessionToken(token, "test-secret", now + 24 * 60 * 60 * 1000 + 1, 2),
    null
  );
});
