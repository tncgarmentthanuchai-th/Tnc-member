const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ERROR_CODES,
  MEMBER_STATUS,
  normalizePhone,
  validateMemberPayload,
  generateMemberId,
  filterMembers,
  paginateMembers,
  toCsv
} = require("../src/Core");

test("normalizePhone removes separators and preserves digits", () => {
  assert.equal(normalizePhone("081-234-5678"), "0812345678");
});

test("normalizePhone restores Thai domestic format from Sheet numbers and +66", () => {
  assert.equal(normalizePhone(812345678), "0812345678");
  assert.equal(normalizePhone("+66 81 234 5678"), "0812345678");
});

test("validateMemberPayload accepts a valid Thai member payload", () => {
  const result = validateMemberPayload({
    fullname: "สมชาย ใจดี",
    phone: "081-234-5678",
    orgType: "หน่วยงานเอกชน",
    orgName: "TNC Garment"
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      fullname: "สมชาย ใจดี",
      phone: "0812345678",
      orgType: "หน่วยงานเอกชน",
      orgName: "TNC Garment"
    }
  });
});

test("validateMemberPayload rejects missing fields and invalid phone", () => {
  const result = validateMemberPayload({
    fullname: "",
    phone: "123",
    orgType: "",
    orgName: ""
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.VALIDATION_ERROR);
  assert.deepEqual(Object.keys(result.fields).sort(), [
    "fullname",
    "orgName",
    "orgType",
    "phone"
  ]);
});

test("generateMemberId creates a six-digit member id", () => {
  assert.equal(generateMemberId(42), "TNC-000042");
});

test("filterMembers searches common fields and status", () => {
  const members = [
    {
      memberId: "TNC-000001",
      fullname: "สมชาย ใจดี",
      phone: "0812345678",
      orgType: "หน่วยงานเอกชน",
      orgName: "TNC Garment",
      status: MEMBER_STATUS.ACTIVE
    },
    {
      memberId: "TNC-000002",
      fullname: "สุดา มีสุข",
      phone: "0899999999",
      orgType: "สถานศึกษา",
      orgName: "โรงเรียนตัวอย่าง",
      status: MEMBER_STATUS.SUSPENDED
    }
  ];

  assert.deepEqual(
    filterMembers(members, { search: "tnc", status: MEMBER_STATUS.ACTIVE }),
    [members[0]]
  );
  assert.deepEqual(
    filterMembers(members, { search: "0899", status: "" }),
    [members[1]]
  );
});

test("paginateMembers clamps page and returns metadata", () => {
  const members = Array.from({ length: 25 }, (_, index) => ({ index }));
  const result = paginateMembers(members, 99, 10);

  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 10);
  assert.equal(result.total, 25);
  assert.equal(result.totalPages, 3);
  assert.deepEqual(result.items, members.slice(20));
});

test("toCsv includes UTF-8 BOM and escapes spreadsheet formulas", () => {
  const csv = toCsv(
    [["รหัสสมาชิก", "ชื่อ"], ["TNC-000001", '=HYPERLINK("bad")']],
    true
  );

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /TNC-000001/);
  assert.match(csv, /"'=HYPERLINK\(\"\"bad\"\"\)"/);
});
