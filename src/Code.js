function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function renderTemplate(filename, title) {
  return HtmlService.createTemplateFromFile(filename)
    .evaluate()
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getAdminPageUrl_() {
  return ScriptApp.getService().getUrl() + "?page=admin";
}

function doGet(event) {
  ensureSystemReady_();
  var page = event && event.parameter ? event.parameter.page : "";
  if (page === "admin") {
    var session = createAppsScriptAuthorizer().requireAdmin();
    if (!session.ok) {
      if (session.code === "LOGIN_REQUIRED") {
        return renderTemplate("AdminLogin", "เข้าสู่ระบบผู้ดูแล");
      }
      return renderTemplate("Unauthorized", "ไม่มีสิทธิ์เข้าถึง");
    }
    return renderTemplate("Admin", "TNC Garment - จัดการสมาชิก");
  }
  if (page === "member") {
    return renderTemplate("Member", "TNC Garment - บัญชีสมาชิก");
  }
  return renderTemplate("Public", "TNC Garment - สมัครสมาชิก");
}

function runSafely(callback) {
  try {
    return callback();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return { ok: false, code: ERROR_CODES.SYSTEM_ERROR };
  }
}

function withAdmin(callback) {
  return runSafely(function () {
    var session = createAppsScriptAuthorizer().requireAdmin();
    if (!session.ok) {
      return { ok: false, code: ERROR_CODES.UNAUTHORIZED };
    }
    return callback(session.email);
  });
}

function getService() {
  return createMemberService(createSheetRepository());
}

function getOrderService() {
  return createOrderService(createSheetRepository());
}

function getMemberSessionSecret_() {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty("MEMBER_SESSION_SECRET");
  if (secret) return secret;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    secret = properties.getProperty("MEMBER_SESSION_SECRET");
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty("MEMBER_SESSION_SECRET", secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

function safeAdminMember_(member) {
  var points = Number(member.points || 0);
  return {
    memberId: member.memberId,
    fullname: member.fullname,
    phone: member.phone,
    orgType: member.orgType,
    orgName: member.orgName,
    status: member.status,
    suspensionReason: member.suspensionReason,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    updatedBy: member.updatedBy,
    points: isFinite(points) ? points : 0,
    tier: member.tier || "Silver",
    lastOrderAt: member.lastOrderAt || "",
    hasPin: Boolean(member.pinHash),
    mustChangePin: String(member.mustChangePin) === "true" ||
      member.mustChangePin === true
  };
}

function safeOrder_(order) {
  var amount = Number(order.amount);
  return {
    orderId: order.orderId,
    memberId: order.memberId,
    memberName: order.memberName,
    orderDate: order.orderDate,
    amount: Number.isFinite(amount) ? amount : 0,
    note: order.note || "",
    status: order.status,
    createdAt: order.createdAt,
    createdBy: order.createdBy,
    cancelledAt: order.cancelledAt || "",
    cancelledBy: order.cancelledBy || "",
    cancellationReason: order.cancellationReason || ""
  };
}

function withMemberSession_(token, allowMustChangePin, callback) {
  return runSafely(function () {
    var secret = getMemberSessionSecret_();
    var payload = verifySessionToken(token, secret, Date.now());
    if (!payload) return { ok: false, code: "SESSION_INVALID" };
    var result = getService().get(payload.memberId);
    if (!result.ok) return { ok: false, code: "SESSION_INVALID" };
    var member = result.member;
    if (Number(member.sessionVersion) !== Number(payload.sessionVersion)) {
      return { ok: false, code: "SESSION_INVALID" };
    }
    if (member.status !== MEMBER_STATUS.ACTIVE) {
      return { ok: false, code: "MEMBER_SUSPENDED" };
    }
    var mustChange = String(member.mustChangePin) === "true" ||
      member.mustChangePin === true;
    if (mustChange && !allowMustChangePin) {
      return { ok: false, code: "PIN_CHANGE_REQUIRED" };
    }
    return callback(member);
  });
}

function registerMember(payload) {
  return runSafely(function () {
    ensureSystemReady_();
    return getService().register(payload);
  });
}

function getAdminSession() {
  return withAdmin(function (email) {
    return { ok: true, email: email };
  });
}

function listMembers(query) {
  return withAdmin(function () {
    var result = getService().list(query || {});
    result.items = result.items.map(safeAdminMember_);
    return result;
  });
}

function getMember(memberId) {
  return withAdmin(function () {
    var result = getService().get(memberId);
    if (result.ok) result.member = safeAdminMember_(result.member);
    return result;
  });
}

function updateMember(payload) {
  return withAdmin(function (email) {
    var source = payload || {};
    return getService().update(source.memberId, source, email);
  });
}

function setMemberStatus(payload) {
  return withAdmin(function (email) {
    var source = payload || {};
    return getService().setStatus(
      source.memberId,
      source.status,
      source.reason,
      email
    );
  });
}

function resetMemberPin(memberId) {
  return withAdmin(function (email) {
    return getService().resetPin(memberId, email);
  });
}

function createOrder(payload) {
  return withAdmin(function (email) {
    return getOrderService().createOrder(payload || {}, email);
  });
}

function cancelOrder(payload) {
  return withAdmin(function (email) {
    return getOrderService().cancelOrder(payload || {}, email);
  });
}

function listMemberOrders(query) {
  return withAdmin(function () {
    var source = query || {};
    var result = getOrderService().listMemberOrders(source.memberId, source);
    if (result.ok) result.items = result.items.map(safeOrder_);
    return result;
  });
}

function rebuildMemberPoints(memberId) {
  return withAdmin(function (email) {
    return getOrderService().rebuildMemberPoints(memberId, email);
  });
}

function loginMember(payload) {
  return runSafely(function () {
    ensureSystemReady_();
    var phone = normalizePhone(payload && payload.phone);
    var pin = String(payload && payload.pin || "");
    var cache = CacheService.getScriptCache();
    var key = hashPin(phone || "blank", "login-rate-v2");
    var blockedKey = "blocked:" + key;
    if (cache.get(blockedKey)) {
      return { ok: false, code: "LOGIN_BLOCKED" };
    }
    var result = getService().login(phone, pin, getMemberSessionSecret_());
    if (!result.ok) {
      var attemptKey = "attempts:" + key;
      var attempts = Number(cache.get(attemptKey) || 0) + 1;
      if (attempts >= 5) {
        cache.put(blockedKey, "1", 30 * 60);
        cache.remove(attemptKey);
        return { ok: false, code: "LOGIN_BLOCKED" };
      }
      cache.put(attemptKey, String(attempts), 15 * 60);
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    cache.remove("attempts:" + key);
    cache.remove(blockedKey);
    return result;
  });
}

function getMemberAccount(token) {
  return withMemberSession_(token, true, function (member) {
    return {
      ok: true,
      mustChangePin: String(member.mustChangePin) === "true" ||
        member.mustChangePin === true,
      member: getService().publicMember(member),
      benefits: getTierBenefits(member.tier || "Silver")
    };
  });
}

function getMyOrders(payload) {
  var source = payload || {};
  return withMemberSession_(source.token, false, function (member) {
    var result = getOrderService().listMemberOrders(member.memberId, {
      page: source.page,
      pageSize: source.pageSize
    });
    if (result.ok) result.items = result.items.map(safeOrder_);
    return result;
  });
}

function updateMemberAccount(payload) {
  return withMemberSession_(payload && payload.token, false, function (member) {
    return getService().updateOwnProfile(member.memberId, payload || {});
  });
}

function changeMemberPin(payload) {
  return withMemberSession_(payload && payload.token, true, function (member) {
    return getService().changePin(
      member.memberId,
      payload.currentPin,
      payload.newPin,
      payload.confirmPin
    );
  });
}

function exportMembers(query) {
  return withAdmin(function () {
    var repository = createSheetRepository();
    var members = filterMembers(repository.list(), query || {});
    members.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    var rows = [[
      "รหัสสมาชิก",
      "ชื่อ-นามสกุล",
      "เบอร์โทรศัพท์",
      "ประเภทองค์กร",
      "ชื่อองค์กร",
      "สถานะ",
      "เหตุผลระงับ",
      "วันที่สมัคร",
      "วันที่แก้ไข",
      "ผู้แก้ไขล่าสุด"
    ]];
    members.forEach(function (member) {
      rows.push([
        member.memberId,
        member.fullname,
        member.phone,
        member.orgType,
        member.orgName,
        member.status,
        member.suspensionReason,
        member.createdAt,
        member.updatedAt,
        member.updatedBy
      ]);
    });
    return {
      ok: true,
      filename: "tnc-members-" +
        Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyyMMdd-HHmmss") +
        ".csv",
      mimeType: "text/csv;charset=utf-8",
      content: toCsv(rows, true)
    };
  });
}

function reconcileAllMemberPoints_() {
  return getOrderService().reconcileAllMemberPoints("SYSTEM");
}
