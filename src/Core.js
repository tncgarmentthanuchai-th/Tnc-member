var ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  DUPLICATE_PHONE: "DUPLICATE_PHONE",
  NOT_FOUND: "NOT_FOUND",
  SYSTEM_ERROR: "SYSTEM_ERROR"
});

var MEMBER_STATUS = Object.freeze({
  ACTIVE: "ใช้งาน",
  SUSPENDED: "ระงับ"
});

var ORG_TYPES = Object.freeze([
  "สถานศึกษา",
  "หน่วยงานภาครัฐ",
  "หน่วยงานเอกชน",
  "อื่นๆ"
]);

function normalizeText(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
}

function normalizePhone(value) {
  var digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (/^66\d{9}$/.test(digits)) {
    return "0" + digits.slice(2);
  }
  if (/^[1-9]\d{8}$/.test(digits)) {
    return "0" + digits;
  }
  return digits;
}

function validateMemberPayload(payload) {
  var source = payload || {};
  var value = {
    fullname: normalizeText(source.fullname),
    phone: normalizePhone(source.phone),
    orgType: normalizeText(source.orgType),
    orgName: normalizeText(source.orgName)
  };
  var fields = {};

  if (!value.fullname || value.fullname.length > 120) {
    fields.fullname = "กรุณากรอกชื่อ-นามสกุลไม่เกิน 120 ตัวอักษร";
  }
  if (!/^0\d{8,9}$/.test(value.phone)) {
    fields.phone = "กรุณากรอกเบอร์โทรศัพท์ไทย 9-10 หลัก";
  }
  if (ORG_TYPES.indexOf(value.orgType) === -1) {
    fields.orgType = "กรุณาเลือกประเภทองค์กร";
  }
  if (!value.orgName || value.orgName.length > 160) {
    fields.orgName = "กรุณากรอกชื่อองค์กรไม่เกิน 160 ตัวอักษร";
  }

  if (Object.keys(fields).length) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATION_ERROR,
      fields: fields
    };
  }

  return { ok: true, value: value };
}

function generateMemberId(sequence) {
  var value = Math.max(1, Number(sequence) || 1);
  return "TNC-" + String(Math.floor(value)).padStart(6, "0");
}

function filterMembers(members, query) {
  var options = query || {};
  var search = normalizeText(options.search).toLocaleLowerCase("th");
  var status = normalizeText(options.status);

  return (members || []).filter(function (member) {
    if (status && member.status !== status) return false;
    if (!search) return true;

    return [
      member.memberId,
      member.fullname,
      member.phone,
      member.orgType,
      member.orgName
    ].some(function (value) {
      return String(value || "").toLocaleLowerCase("th").indexOf(search) !== -1;
    });
  });
}

function paginateMembers(members, page, pageSize) {
  var safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  var total = (members || []).length;
  var totalPages = Math.max(1, Math.ceil(total / safeSize));
  var safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  var start = (safePage - 1) * safeSize;

  return {
    items: (members || []).slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: total,
    totalPages: totalPages
  };
}

function escapeCsvCell(value) {
  var text = String(value == null ? "" : value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function toCsv(rows, includeBom) {
  var csv = (rows || []).map(function (row) {
    return row.map(escapeCsvCell).join(",");
  }).join("\r\n");
  return (includeBom ? "\ufeff" : "") + csv;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ERROR_CODES: ERROR_CODES,
    MEMBER_STATUS: MEMBER_STATUS,
    ORG_TYPES: ORG_TYPES,
    normalizeText: normalizeText,
    normalizePhone: normalizePhone,
    validateMemberPayload: validateMemberPayload,
    generateMemberId: generateMemberId,
    filterMembers: filterMembers,
    paginateMembers: paginateMembers,
    escapeCsvCell: escapeCsvCell,
    toCsv: toCsv
  };
}
