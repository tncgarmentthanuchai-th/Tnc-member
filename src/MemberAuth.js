function validatePin(pin) {
  return /^\d{6}$/.test(String(pin || ""));
}

function bytesToBase64Url(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function stringToBase64Url(value) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(String(value), "utf8").toString("base64url");
  }
  return Utilities.base64EncodeWebSafe(String(value)).replace(/=+$/g, "");
}

function base64UrlToString(value) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64url").toString("utf8");
  }
  return Utilities.newBlob(
    Utilities.base64DecodeWebSafe(value)
  ).getDataAsString();
}

function sha256Bytes(value) {
  if (typeof module !== "undefined" && module.exports) {
    return require("node:crypto").createHash("sha256").update(value, "utf8").digest();
  }
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
}

function hmacBytes(value, secret) {
  if (typeof module !== "undefined" && module.exports) {
    return require("node:crypto")
      .createHmac("sha256", secret)
      .update(value, "utf8")
      .digest();
  }
  return Utilities.computeHmacSha256Signature(
    value,
    secret,
    Utilities.Charset.UTF_8
  );
}

function constantTimeEqual(left, right) {
  var a = String(left || "");
  var b = String(right || "");
  var difference = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function createPinSalt() {
  if (typeof module !== "undefined" && module.exports) {
    return require("node:crypto").randomBytes(16).toString("base64url");
  }
  return Utilities.getUuid().replace(/-/g, "");
}

function hashPin(pin, salt) {
  return bytesToBase64Url(sha256Bytes(String(salt) + ":" + String(pin)));
}

function verifyPin(pin, salt, expectedHash) {
  if (!validatePin(pin) || !salt || !expectedHash) return false;
  return constantTimeEqual(hashPin(pin, salt), expectedHash);
}

var DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function createSessionToken(member, secret, nowValue, ttlMs) {
  var now = Number(nowValue == null ? Date.now() : nowValue);
  var ttl = Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_SESSION_TTL_MS;
  var payload = {
    memberId: member.memberId,
    sessionVersion: Number(member.sessionVersion) || 1,
    issuedAt: now,
    expiresAt: now + ttl
  };
  var encoded = stringToBase64Url(JSON.stringify(payload));
  return encoded + "." + bytesToBase64Url(hmacBytes(encoded, secret));
}

function verifySessionToken(token, secret, nowValue, expectedVersion) {
  try {
    var parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    var expectedSignature = bytesToBase64Url(hmacBytes(parts[0], secret));
    if (!constantTimeEqual(parts[1], expectedSignature)) return null;
    var payload = JSON.parse(base64UrlToString(parts[0]));
    var now = Number(nowValue == null ? Date.now() : nowValue);
    if (payload.expiresAt < now) return null;
    if (
      expectedVersion != null &&
      Number(payload.sessionVersion) !== Number(expectedVersion)
    ) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function generateTemporaryPin() {
  var value;
  if (typeof module !== "undefined" && module.exports) {
    value = require("node:crypto").randomInt(0, 1000000);
  } else {
    value = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 8), 16) %
      1000000;
  }
  return String(value).padStart(6, "0");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validatePin: validatePin,
    createPinSalt: createPinSalt,
    hashPin: hashPin,
    verifyPin: verifyPin,
    createSessionToken: createSessionToken,
    verifySessionToken: verifySessionToken,
    generateTemporaryPin: generateTemporaryPin
  };
}
