const test = require("node:test");
const assert = require("node:assert/strict");

const { MEMBER_STATUS, ERROR_CODES } = require("../src/Core");
const { createMemberService } = require("../src/MemberService");
const { hashPin } = require("../src/MemberAuth");

function createMemoryRepository(seed = []) {
  const members = seed.map((member) => ({ ...member }));
  const audits = [];
  let sequence = members.length;

  return {
    members,
    audits,
    withLock(callback) {
      return callback();
    },
    findByPhone(phone) {
      return members.find((member) => member.phone === phone) || null;
    },
    findById(memberId) {
      return members.find((member) => member.memberId === memberId) || null;
    },
    nextSequence() {
      sequence += 1;
      return sequence;
    },
    insert(member) {
      members.push({ ...member });
      return { ...member };
    },
    update(memberId, changes) {
      const index = members.findIndex((member) => member.memberId === memberId);
      members[index] = { ...members[index], ...changes };
      return { ...members[index] };
    },
    list() {
      return members.map((member) => ({ ...member }));
    },
    audit(entry) {
      audits.push({ ...entry });
    }
  };
}

const validPayload = {
  fullname: "สมชาย ใจดี",
  phone: "081-234-5678",
  orgType: "หน่วยงานเอกชน",
  orgName: "TNC Garment",
  pin: "123456",
  pinConfirm: "123456"
};

test("register creates an active member and audit record", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository, () => "2026-06-11T10:00:00.000Z");

  const result = service.register(validPayload);

  assert.deepEqual(result, {
    ok: true,
    code: "CREATED",
    memberId: "TNC-000001",
    existing: false,
    status: MEMBER_STATUS.ACTIVE
  });
  assert.equal(repository.members.length, 1);
  assert.equal(repository.members[0].pinHash.length > 20, true);
  assert.equal(repository.members[0].pin, undefined);
  assert.equal(repository.members[0].sessionVersion, 1);
  assert.equal(repository.members[0].mustChangePin, false);
  assert.equal(repository.members[0].points, 0);
  assert.equal(repository.members[0].tier, "Silver");
  assert.equal(repository.members[0].lastOrderAt, "");
  assert.equal(result.points, undefined);
  assert.equal(repository.audits[0].action, "CREATE");
  assert.equal(repository.audits[0].after.includes("pinHash"), false);
  assert.equal(repository.audits[0].after.includes("pinSalt"), false);
});

test("publicMember exposes the member points summary", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);

  const member = service.publicMember({
    memberId: "TNC-000001",
    fullname: "Member",
    phone: "0812345678",
    orgType: "Private",
    orgName: "TNC",
    status: MEMBER_STATUS.ACTIVE,
    suspensionReason: "",
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    points: "125",
    tier: "Gold",
    lastOrderAt: "2026-06-12T09:00:00.000Z",
    pinHash: "secret"
  });

  assert.equal(member.points, 125);
  assert.equal(member.tier, "Gold");
  assert.equal(member.lastOrderAt, "2026-06-12T09:00:00.000Z");
  assert.equal(member.pinHash, undefined);
});

test("publicMember normalizes points to a finite number", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const cases = [
    { input: NaN, expected: 0 },
    { input: Infinity, expected: 0 },
    { input: -Infinity, expected: 0 },
    { input: "not-points", expected: 0 },
    { input: "125", expected: 125 },
    { input: "-12.5", expected: -12.5 }
  ];

  cases.forEach(({ input, expected }) => {
    const member = service.publicMember({ points: input });

    assert.equal(member.points, expected);
  });
});

test("register returns the original id for a duplicate phone", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);

  const first = service.register(validPayload);
  const duplicate = service.register({ ...validPayload, fullname: "ชื่อใหม่" });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.code, "EXISTING");
  assert.equal(duplicate.memberId, first.memberId);
  assert.equal(duplicate.existing, true);
  assert.equal(repository.members.length, 1);
});

test("update rejects a phone used by another member", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const first = service.register(validPayload);
  service.register({ ...validPayload, fullname: "สุดา", phone: "0899999999" });

  const result = service.update(first.memberId, {
    ...validPayload,
    phone: "0899999999"
  }, "admin@example.com");

  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.DUPLICATE_PHONE);
});

test("suspend requires a reason and records the admin", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository, () => "2026-06-11T10:00:00.000Z");
  const member = service.register(validPayload);

  const invalid = service.setStatus(
    member.memberId,
    MEMBER_STATUS.SUSPENDED,
    "",
    "admin@example.com"
  );
  assert.equal(invalid.code, ERROR_CODES.VALIDATION_ERROR);

  const result = service.setStatus(
    member.memberId,
    MEMBER_STATUS.SUSPENDED,
    "ข้อมูลไม่ถูกต้อง",
    "admin@example.com"
  );
  assert.equal(result.ok, true);
  assert.equal(result.member.status, MEMBER_STATUS.SUSPENDED);
  assert.equal(result.member.suspensionReason, "ข้อมูลไม่ถูกต้อง");
  assert.equal(repository.audits.at(-1).actor, "admin@example.com");
});

test("list searches, filters, sorts newest first, and paginates", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  service.register(validPayload);
  service.register({
    ...validPayload,
    fullname: "สุดา มีสุข",
    phone: "0899999999",
    orgType: "สถานศึกษา",
    orgName: "โรงเรียนตัวอย่าง"
  });

  const result = service.list({ search: "สุดา", status: "", page: 1, pageSize: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].fullname, "สุดา มีสุข");
});

test("login returns a session without exposing auth fields", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const registered = service.register(validPayload);

  const result = service.login("0812345678", "123456", "secret");

  assert.equal(result.ok, true);
  assert.equal(result.member.memberId, registered.memberId);
  assert.equal(typeof result.token, "string");
  assert.equal(result.member.pinHash, undefined);
  assert.equal(result.member.pinSalt, undefined);
});

test("temporary PIN forces change and invalidates previous sessions", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const registered = service.register(validPayload);
  const reset = service.resetPin(registered.memberId, "admin@example.com", () => "654321");

  assert.equal(reset.ok, true);
  assert.equal(reset.temporaryPin, "654321");
  assert.equal(repository.members[0].mustChangePin, true);
  assert.equal(repository.members[0].sessionVersion, 2);

  const login = service.login("0812345678", "654321", "secret");
  assert.equal(login.ok, true);
  assert.equal(login.mustChangePin, true);

  const changed = service.changePin(
    registered.memberId,
    "654321",
    "111111",
    "111111"
  );
  assert.equal(changed.ok, true);
  assert.equal(repository.members[0].mustChangePin, false);
  assert.equal(repository.members[0].sessionVersion, 3);
});

test("changing phone requires current PIN and invalidates sessions", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const registered = service.register(validPayload);

  const denied = service.updateOwnProfile(
    registered.memberId,
    { ...validPayload, phone: "0899999999", currentPin: "999999" }
  );
  assert.equal(denied.ok, false);

  const updated = service.updateOwnProfile(
    registered.memberId,
    { ...validPayload, phone: "0899999999", currentPin: "123456" }
  );
  assert.equal(updated.ok, true);
  assert.equal(updated.member.phone, "0899999999");
  assert.equal(repository.members[0].sessionVersion, 2);
});
