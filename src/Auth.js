function getAuthErrorCodes() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./Core").ERROR_CODES;
  }
  return ERROR_CODES;
}

function parseAdminEmails(value) {
  var seen = {};
  return String(value || "")
    .split(/[\s,;]+/)
    .map(function (email) {
      return email.trim().toLowerCase();
    })
    .filter(function (email) {
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    });
}

function createAuthorizer(activeEmailProvider, allowlistProvider) {
  var errorCodes = getAuthErrorCodes();
  function requireAdmin() {
    var email = String(activeEmailProvider() || "").trim().toLowerCase();
    var allowed = parseAdminEmails(allowlistProvider());
    if (!email || allowed.indexOf(email) === -1) {
      return { ok: false, code: errorCodes.UNAUTHORIZED };
    }
    return { ok: true, email: email };
  }

  return { requireAdmin: requireAdmin };
}

function createAppsScriptAuthorizer() {
  return createAuthorizer(
    function () {
      return Session.getActiveUser().getEmail();
    },
    function () {
      return PropertiesService.getScriptProperties().getProperty("ADMIN_EMAILS");
    }
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseAdminEmails: parseAdminEmails,
    createAuthorizer: createAuthorizer
  };
}
