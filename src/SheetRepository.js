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
  "mustChangePin",
  "points",
  "tier",
  "lastOrderAt"
];

var AUDIT_HEADERS = [
  "timestamp",
  "memberId",
  "action",
  "actor",
  "before",
  "after"
];

var ORDER_HEADERS = [
  "orderId",
  "memberId",
  "memberName",
  "orderDate",
  "amount",
  "note",
  "status",
  "createdAt",
  "createdBy",
  "cancelledAt",
  "cancelledBy",
  "cancellationReason"
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

function sheetDateToIsoDate(value) {
  if (value instanceof Date) {
    if (typeof Utilities !== "undefined" && typeof Session !== "undefined") {
      return Utilities.formatDate(
        value,
        Session.getScriptTimeZone() || "Asia/Bangkok",
        "yyyy-MM-dd"
      );
    }
    return value.toISOString().slice(0, 10);
  }
  var text = sheetValueToString(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
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

function rowToObject(headers, row) {
  var result = {};
  headers.forEach(function (header, index) {
    if (header === "amount") {
      var amount = Number(row[index]);
      result[header] = Number.isFinite(amount) ? amount : 0;
    } else if (header === "orderDate") {
      result[header] = sheetDateToIsoDate(row[index]);
    } else {
      result[header] = sheetValueToString(row[index]);
    }
  });
  return result;
}

function objectToRow(headers, value) {
  return headers.map(function (header) {
    return value[header] == null ? "" : value[header];
  });
}

function findDataRow(sheet, headers, predicate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var index = 0; index < values.length; index += 1) {
    var value = rowToObject(headers, values[index]);
    if (predicate(value)) {
      return { rowNumber: index + 2, value: value };
    }
  }
  return null;
}

function findMemberRow(sheet, predicate) {
  var found = findDataRow(sheet, MEMBER_HEADERS, predicate);
  return found
    ? { rowNumber: found.rowNumber, member: found.value }
    : null;
}

function createSheetRepository() {
  var spreadsheet = getConfiguredSpreadsheet();
  var membersSheet = spreadsheet.getSheetByName("Members");
  var auditSheet = spreadsheet.getSheetByName("AuditLog");
  var settingsSheet = spreadsheet.getSheetByName("Settings");
  var ordersSheet = spreadsheet.getSheetByName("Orders");
  if (!membersSheet || !auditSheet || !settingsSheet || !ordersSheet) {
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
    return nextSettingSequence("LAST_MEMBER_SEQUENCE");
  }

  function nextSettingSequence(key) {
    var values = settingsSheet.getDataRange().getValues();
    for (var index = 1; index < values.length; index += 1) {
      if (values[index][0] === key) {
        var next = (Number(values[index][1]) || 0) + 1;
        settingsSheet.getRange(index + 1, 2).setValue(next);
        return next;
      }
    }
    settingsSheet.appendRow([key, 1]);
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

  function nextOrderSequence() {
    return nextSettingSequence("LAST_ORDER_SEQUENCE");
  }

  function insertOrder(order) {
    ordersSheet.appendRow(objectToRow(ORDER_HEADERS, order));
    return order;
  }

  function findOrderById(orderId) {
    var found = findDataRow(ordersSheet, ORDER_HEADERS, function (order) {
      return order.orderId === orderId;
    });
    return found ? found.value : null;
  }

  function updateOrder(orderId, changes) {
    var found = findDataRow(ordersSheet, ORDER_HEADERS, function (order) {
      return order.orderId === orderId;
    });
    if (!found) return null;
    var updated = Object.assign({}, found.value, changes);
    ordersSheet
      .getRange(found.rowNumber, 1, 1, ORDER_HEADERS.length)
      .setValues([objectToRow(ORDER_HEADERS, updated)]);
    return updated;
  }

  function listOrdersByMember(memberId) {
    return listAllOrders().filter(function (order) {
      return order.memberId === memberId;
    });
  }

  function listAllOrders() {
    var lastRow = ordersSheet.getLastRow();
    if (lastRow < 2) return [];
    return ordersSheet
      .getRange(2, 1, lastRow - 1, ORDER_HEADERS.length)
      .getValues()
      .map(function (row) {
        return rowToObject(ORDER_HEADERS, row);
      });
  }

  return {
    withLock: withLock,
    findByPhone: findByPhone,
    findById: findById,
    findMemberById: findById,
    nextSequence: nextSequence,
    insert: insert,
    update: update,
    updateMember: update,
    list: list,
    listMembers: list,
    audit: audit,
    nextOrderSequence: nextOrderSequence,
    insertOrder: insertOrder,
    findOrderById: findOrderById,
    updateOrder: updateOrder,
    listOrdersByMember: listOrdersByMember,
    listAllOrders: listAllOrders
  };
}
