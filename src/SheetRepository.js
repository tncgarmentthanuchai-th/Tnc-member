var MEMBER_HEADERS = [
  "memberId",
  "fullname",
  "phone",
  "orgType",
  "orgName",
  "status",
  "suspensionReason",
  "createdAt",
  "updatedAt",
  "updatedBy",
  "pinHash",
  "pinSalt",
  "sessionVersion",
  "mustChangePin"
];

var AUDIT_HEADERS = [
  "timestamp",
  "memberId",
  "action",
  "actor",
  "before",
  "after"
];

function getConfiguredSpreadsheet() {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty("SPREADSHEET_ID");
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!activeSpreadsheet) {
    throw new Error(
      "Missing SPREADSHEET_ID Script Property and no bound spreadsheet is available"
    );
  }
  return activeSpreadsheet;
}

function sheetValueToString(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? "" : String(value);
}

function memberFromRow(row) {
  var member = {};
  MEMBER_HEADERS.forEach(function (header, index) {
    member[header] = sheetValueToString(row[index]);
  });
  return member;
}

function memberToRow(member) {
  return MEMBER_HEADERS.map(function (header) {
    return member[header] == null ? "" : member[header];
  });
}

function findMemberRow(sheet, predicate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length).getValues();
  for (var index = 0; index < values.length; index += 1) {
    var member = memberFromRow(values[index]);
    if (predicate(member)) {
      return { rowNumber: index + 2, member: member };
    }
  }
  return null;
}

function createSheetRepository() {
  var spreadsheet = getConfiguredSpreadsheet();
  var membersSheet = spreadsheet.getSheetByName("Members");
  var auditSheet = spreadsheet.getSheetByName("AuditLog");
  var settingsSheet = spreadsheet.getSheetByName("Settings");
  if (!membersSheet || !auditSheet || !settingsSheet) {
    throw new Error("Sheets are not initialized. Run setupTncMemberSystem().");
  }

  function withLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Could not acquire member data lock");
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function findByPhone(phone) {
    var found = findMemberRow(membersSheet, function (member) {
      return member.phone === phone;
    });
    return found ? found.member : null;
  }

  function findById(memberId) {
    var found = findMemberRow(membersSheet, function (member) {
      return member.memberId === memberId;
    });
    return found ? found.member : null;
  }

  function nextSequence() {
    var values = settingsSheet.getDataRange().getValues();
    for (var index = 1; index < values.length; index += 1) {
      if (values[index][0] === "LAST_MEMBER_SEQUENCE") {
        var next = (Number(values[index][1]) || 0) + 1;
        settingsSheet.getRange(index + 1, 2).setValue(next);
        return next;
      }
    }
    settingsSheet.appendRow(["LAST_MEMBER_SEQUENCE", 1]);
    return 1;
  }

  function insert(member) {
    membersSheet.appendRow(memberToRow(member));
    return member;
  }

  function update(memberId, changes) {
    var found = findMemberRow(membersSheet, function (member) {
      return member.memberId === memberId;
    });
    if (!found) return null;
    var updated = Object.assign({}, found.member, changes);
    membersSheet
      .getRange(found.rowNumber, 1, 1, MEMBER_HEADERS.length)
      .setValues([memberToRow(updated)]);
    return updated;
  }

  function list() {
    var lastRow = membersSheet.getLastRow();
    if (lastRow < 2) return [];
    return membersSheet
      .getRange(2, 1, lastRow - 1, MEMBER_HEADERS.length)
      .getValues()
      .map(memberFromRow);
  }

  function audit(entry) {
    auditSheet.appendRow(AUDIT_HEADERS.map(function (header) {
      return entry[header] == null ? "" : entry[header];
    }));
  }

  return {
    withLock: withLock,
    findByPhone: findByPhone,
    findById: findById,
    nextSequence: nextSequence,
    insert: insert,
    update: update,
    list: list,
    audit: audit
  };
}
