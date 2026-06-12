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

function setupTncMemberSystem() {
  var spreadsheet = getConfiguredSpreadsheet();
  var members = ensureSheet(spreadsheet, "Members", MEMBER_HEADERS);
  var audit = ensureSheet(spreadsheet, "AuditLog", AUDIT_HEADERS);
  var settings = ensureSheet(spreadsheet, "Settings", ["key", "value"]);

  if (settings.getLastRow() < 2) {
    settings.appendRow(["LAST_MEMBER_SEQUENCE", 0]);
  }

  members.autoResizeColumns(1, MEMBER_HEADERS.length);
  audit.autoResizeColumns(1, AUDIT_HEADERS.length);
  settings.autoResizeColumns(1, 2);
  PropertiesService.getScriptProperties().setProperty(
    "SYSTEM_SCHEMA_VERSION",
    "2"
  );
  return {
    ok: true,
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: ["Members", "AuditLog", "Settings"]
  };
}

function ensureSystemReady_() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("SYSTEM_SCHEMA_VERSION") === "2") {
    getMemberSessionSecret_();
    return;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (properties.getProperty("SYSTEM_SCHEMA_VERSION") !== "2") {
      setupTncMemberSystem();
    }
  } finally {
    lock.releaseLock();
  }
  getMemberSessionSecret_();
}

function bootstrapTncMemberSystem() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("ADMIN_EMAILS")) {
    var installerEmail = Session.getActiveUser().getEmail();
    if (!installerEmail) {
      throw new Error(
        "Unable to detect the installer email. Set ADMIN_EMAILS in Script Properties."
      );
    }
    properties.setProperty("ADMIN_EMAILS", installerEmail);
  }
  getMemberSessionSecret_();
  return setupTncMemberSystem();
}
