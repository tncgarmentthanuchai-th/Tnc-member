function ensureSheet(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var existingColumns = Math.max(1, sheet.getLastColumn());
    var current = sheet.getRange(1, 1, 1, existingColumns).getValues()[0];
    var requiredPrefix = headers.slice(0, current.length);
    if (current.join("|") !== requiredPrefix.join("|")) {
      throw new Error(name + " header does not match the required schema");
    }
    if (current.length < headers.length) {
      sheet.getRange(1, current.length + 1, 1, headers.length - current.length)
        .setValues([headers.slice(current.length)]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#1a1a2e")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  return sheet;
}

function ensureSetting(settings, key, defaultValue) {
  var values = settings.getDataRange().getValues();
  for (var index = 1; index < values.length; index += 1) {
    if (values[index][0] === key) return;
  }
  settings.appendRow([key, defaultValue]);
}

function columnToA1_(column) {
  var address = "";
  var current = column;
  while (current > 0) {
    var remainder = (current - 1) % 26;
    address = String.fromCharCode(65 + remainder) + address;
    current = Math.floor((current - 1) / 26);
  }
  return address;
}

function fillBlankMemberSummaries(members) {
  var lastRow = members.getLastRow();
  if (lastRow < 2) return;
  var pointsColumn = MEMBER_HEADERS.indexOf("points") + 1;
  var summaries = members.getRange(2, pointsColumn, lastRow - 1, 3);
  var values = summaries.getValues();
  var formulas = summaries.getFormulas();
  var blankPoints = [];
  var blankTiers = [];
  values.forEach(function (row, rowIndex) {
    if (row[0] === "" && formulas[rowIndex][0] === "") {
      blankPoints.push(columnToA1_(pointsColumn) + (rowIndex + 2));
    }
    if (row[1] === "" && formulas[rowIndex][1] === "") {
      blankTiers.push(columnToA1_(pointsColumn + 1) + (rowIndex + 2));
    }
  });
  if (blankPoints.length > 0) {
    members.getRangeList(blankPoints).setValue(0);
  }
  if (blankTiers.length > 0) {
    members.getRangeList(blankTiers).setValue("Silver");
  }
}

function formatOrdersAmountColumn_(orders) {
  var maxRows = orders.getMaxRows();
  if (maxRows < 2) {
    orders.insertRowsAfter(1, 1);
    maxRows = 2;
  }
  orders.getRange(2, 5, maxRows - 1, 1).setNumberFormat("#,##0.00");
}

function setupTncMemberSystem() {
  var spreadsheet = getConfiguredSpreadsheet();
  var members = ensureSheet(spreadsheet, "Members", MEMBER_HEADERS);
  var audit = ensureSheet(spreadsheet, "AuditLog", AUDIT_HEADERS);
  var settings = ensureSheet(spreadsheet, "Settings", ["key", "value"]);
  var orders = ensureSheet(spreadsheet, "Orders", ORDER_HEADERS);

  ensureSetting(settings, "LAST_MEMBER_SEQUENCE", 0);
  ensureSetting(settings, "LAST_ORDER_SEQUENCE", 0);
  fillBlankMemberSummaries(members);

  members.autoResizeColumns(1, MEMBER_HEADERS.length);
  audit.autoResizeColumns(1, AUDIT_HEADERS.length);
  settings.autoResizeColumns(1, 2);
  formatOrdersAmountColumn_(orders);
  orders.autoResizeColumns(1, ORDER_HEADERS.length);
  PropertiesService.getScriptProperties().setProperty(
    "SYSTEM_SCHEMA_VERSION",
    "3"
  );
  return {
    ok: true,
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: ["Members", "AuditLog", "Settings", "Orders"]
  };
}

function ensureSystemReady_() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("SYSTEM_SCHEMA_VERSION") === "3") {
    getMemberSessionSecret_();
    return;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (properties.getProperty("SYSTEM_SCHEMA_VERSION") !== "3") {
      setupTncMemberSystem();
    }
  } finally {
    lock.releaseLock();
  }
  getMemberSessionSecret_();
}

function assertInteractiveScriptOwner_() {
  var properties = PropertiesService.getScriptProperties();
  var ownerEmail = String(
    properties.getProperty("SETUP_OWNER_EMAIL") || ""
  ).trim().toLowerCase();
  var activeEmail = String(
    Session.getActiveUser().getEmail() || ""
  ).trim().toLowerCase();
  if (!ownerEmail || !activeEmail || activeEmail !== ownerEmail) {
    throw new Error("Unauthorized setup: interactive script owner required.");
  }
  return ownerEmail;
}

function installPointsReconciliationTrigger() {
  assertInteractiveScriptOwner_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var matches = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === "reconcileAllMemberPoints";
    });
    if (matches.length === 0) {
      ScriptApp.newTrigger("reconcileAllMemberPoints")
        .timeBased()
        .everyDays(1)
        .create();
      return;
    }
    matches.slice(1).forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  } finally {
    lock.releaseLock();
  }
}

function bootstrapTncMemberSystem() {
  var installerEmail = assertInteractiveScriptOwner_();
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("ADMIN_EMAILS")) {
    properties.setProperty("ADMIN_EMAILS", installerEmail);
  }
  getMemberSessionSecret_();
  var setupResult = setupTncMemberSystem();
  installPointsReconciliationTrigger();
  return setupResult;
}
