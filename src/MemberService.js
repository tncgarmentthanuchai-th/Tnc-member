function getTncCore() {
  if (typeof module !== "undefined" && module.exports) {
    return require("./Core");
  }
  return {
    ERROR_CODES: ERROR_CODES,
    MEMBER_STATUS: MEMBER_STATUS,
    validateMemberPayload: validateMemberPayload,
    generateMemberId: generateMemberId,
    filterMembers: filterMembers,
    paginateMembers: paginateMembers,
    normalizeText: normalizeText,
    normalizePhone: normalizePhone
  };
}

function createMemberService(repository, nowProvider) {
  var core = getTncCore();
  var auth = typeof module !== "undefined" && module.exports
    ? require("./MemberAuth")
    : {
        validatePin: validatePin,
        createPinSalt: createPinSalt,
        hashPin: hashPin,
        verifyPin: verifyPin,
        createSessionToken: createSessionToken,
        generateTemporaryPin: generateTemporaryPin
      };
  var now = nowProvider || function () {
    return new Date().toISOString();
  };

  function failure(code, fields) {
    var result = { ok: false, code: code };
    if (fields) result.fields = fields;
    return result;
  }

  function normalizePoints(value) {
    var points = Number(value);
    return Number.isFinite(points) ? points : 0;
  }

  function register(payload) {
    var validation = core.validateMemberPayload(payload);
    if (!validation.ok) return validation;
    if (
      !auth.validatePin(payload && payload.pin) ||
      payload.pin !== payload.pinConfirm
    ) {
      return failure(core.ERROR_CODES.VALIDATION_ERROR, {
        pin: "PIN ต้องเป็นตัวเลข 6 หลักและตรงกัน"
      });
    }

    return repository.withLock(function () {
      var data = validation.value;
      var existing = repository.findByPhone(data.phone);
      if (existing) {
        return failure(core.ERROR_CODES.DUPLICATE_PHONE, {
          phone: "เบอร์โทรศัพท์นี้สมัครสมาชิกแล้ว"
        });
      }

      var timestamp = now();
      var pinSalt = auth.createPinSalt();
      var member = {
        memberId: core.generateMemberId(repository.nextSequence()),
        fullname: data.fullname,
        phone: data.phone,
        orgType: data.orgType,
        orgName: data.orgName,
        status: core.MEMBER_STATUS.ACTIVE,
        suspensionReason: "",
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedBy: "",
        pinHash: auth.hashPin(payload.pin, pinSalt),
        pinSalt: pinSalt,
        sessionVersion: 1,
        mustChangePin: false,
        points: 0,
        tier: "Silver",
        lastOrderAt: ""
      };
      repository.insert(member);
      repository.audit({
        timestamp: timestamp,
        memberId: member.memberId,
        action: "CREATE",
        actor: "PUBLIC",
        before: "",
        after: JSON.stringify(publicMember(member))
      });

      return {
        ok: true,
        code: "CREATED",
        memberId: member.memberId,
        existing: false,
        status: member.status
      };
    });
  }

  function publicMember(member) {
    return {
      memberId: member.memberId,
      fullname: member.fullname,
      phone: member.phone,
      orgType: member.orgType,
      orgName: member.orgName,
      status: member.status,
      suspensionReason: member.suspensionReason || "",
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      points: normalizePoints(member.points),
      tier: member.tier || "Silver",
      lastOrderAt: member.lastOrderAt || ""
    };
  }

  function login(phone, pin, secret) {
    var member = repository.findByPhone(core.normalizePhone(phone));
    if (!member || !auth.verifyPin(pin, member.pinSalt, member.pinHash)) {
      if (member) {
        repository.audit({
          timestamp: now(),
          memberId: member.memberId,
          action: "LOGIN_FAILED",
          actor: "MEMBER",
          before: "",
          after: ""
        });
      }
      return failure("INVALID_CREDENTIALS");
    }
    if (member.status !== core.MEMBER_STATUS.ACTIVE) {
      return failure("MEMBER_SUSPENDED");
    }
    repository.audit({
      timestamp: now(),
      memberId: member.memberId,
      action: "LOGIN_SUCCESS",
      actor: "MEMBER",
      before: "",
      after: ""
    });
    return {
      ok: true,
      token: auth.createSessionToken(member, secret),
      mustChangePin: String(member.mustChangePin) === "true" ||
        member.mustChangePin === true,
      member: publicMember(member)
    };
  }

  function resetPin(memberId, actor, pinGenerator) {
    var current = repository.findById(memberId);
    if (!current) return failure(core.ERROR_CODES.NOT_FOUND);
    var temporaryPin = (pinGenerator || auth.generateTemporaryPin)();
    var salt = auth.createPinSalt();
    var timestamp = now();
    var updated = repository.update(memberId, {
      pinHash: auth.hashPin(temporaryPin, salt),
      pinSalt: salt,
      sessionVersion: (Number(current.sessionVersion) || 0) + 1,
      mustChangePin: true,
      updatedAt: timestamp,
      updatedBy: actor
    });
    repository.audit({
      timestamp: timestamp,
      memberId: memberId,
      action: "RESET_PIN",
      actor: actor,
      before: "",
      after: JSON.stringify({ sessionVersion: updated.sessionVersion })
    });
    return { ok: true, temporaryPin: temporaryPin };
  }

  function changePin(memberId, currentPin, newPin, confirmPin) {
    var current = repository.findById(memberId);
    if (!current) return failure(core.ERROR_CODES.NOT_FOUND);
    if (!auth.verifyPin(currentPin, current.pinSalt, current.pinHash)) {
      return failure("INVALID_CREDENTIALS");
    }
    if (!auth.validatePin(newPin) || newPin !== confirmPin) {
      return failure(core.ERROR_CODES.VALIDATION_ERROR, {
        pin: "PIN ใหม่ต้องเป็นตัวเลข 6 หลักและตรงกัน"
      });
    }
    var salt = auth.createPinSalt();
    var timestamp = now();
    var updated = repository.update(memberId, {
      pinHash: auth.hashPin(newPin, salt),
      pinSalt: salt,
      sessionVersion: (Number(current.sessionVersion) || 0) + 1,
      mustChangePin: false,
      updatedAt: timestamp,
      updatedBy: "MEMBER"
    });
    repository.audit({
      timestamp: timestamp,
      memberId: memberId,
      action: "CHANGE_PIN",
      actor: "MEMBER",
      before: "",
      after: JSON.stringify({ sessionVersion: updated.sessionVersion })
    });
    return { ok: true };
  }

  function updateOwnProfile(memberId, payload) {
    var current = repository.findById(memberId);
    if (!current) return failure(core.ERROR_CODES.NOT_FOUND);
    var validation = core.validateMemberPayload(payload);
    if (!validation.ok) return validation;
    var phoneChanged = validation.value.phone !== current.phone;
    if (
      phoneChanged &&
      !auth.verifyPin(payload.currentPin, current.pinSalt, current.pinHash)
    ) {
      return failure("INVALID_CREDENTIALS");
    }
    var duplicate = repository.findByPhone(validation.value.phone);
    if (duplicate && duplicate.memberId !== memberId) {
      return failure(core.ERROR_CODES.DUPLICATE_PHONE);
    }
    var timestamp = now();
    var changes = Object.assign({}, validation.value, {
      updatedAt: timestamp,
      updatedBy: "MEMBER"
    });
    if (phoneChanged) {
      changes.sessionVersion = (Number(current.sessionVersion) || 0) + 1;
    }
    var updated = repository.update(memberId, changes);
    repository.audit({
      timestamp: timestamp,
      memberId: memberId,
      action: "MEMBER_UPDATE",
      actor: "MEMBER",
      before: JSON.stringify(publicMember(current)),
      after: JSON.stringify(publicMember(updated))
    });
    return {
      ok: true,
      phoneChanged: phoneChanged,
      member: publicMember(updated)
    };
  }

  function get(memberId) {
    var member = repository.findById(core.normalizeText(memberId));
    return member
      ? { ok: true, member: member }
      : failure(core.ERROR_CODES.NOT_FOUND);
  }

  function list(query) {
    var filtered = core.filterMembers(repository.list(), query);
    filtered.sort(function (a, b) {
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    var page = core.paginateMembers(
      filtered,
      query && query.page,
      query && query.pageSize
    );
    page.ok = true;
    return page;
  }

  function update(memberId, payload, actor) {
    var validation = core.validateMemberPayload(payload);
    if (!validation.ok) return validation;

    return repository.withLock(function () {
      var current = repository.findById(memberId);
      if (!current) return failure(core.ERROR_CODES.NOT_FOUND);

      var duplicate = repository.findByPhone(validation.value.phone);
      if (duplicate && duplicate.memberId !== current.memberId) {
        return failure(core.ERROR_CODES.DUPLICATE_PHONE, {
          phone: "เบอร์โทรศัพท์นี้เป็นของสมาชิกคนอื่นแล้ว"
        });
      }

      var changes = Object.assign({}, validation.value, {
        updatedAt: now(),
        updatedBy: actor
      });
      var updated = repository.update(current.memberId, changes);
      repository.audit({
        timestamp: changes.updatedAt,
        memberId: current.memberId,
        action: "UPDATE",
        actor: actor,
        before: JSON.stringify(publicMember(current)),
        after: JSON.stringify(publicMember(updated))
      });

      return { ok: true, code: "UPDATED", member: updated };
    });
  }

  function setStatus(memberId, status, reason, actor) {
    var normalizedStatus = core.normalizeText(status);
    var normalizedReason = core.normalizeText(reason);
    if (
      normalizedStatus !== core.MEMBER_STATUS.ACTIVE &&
      normalizedStatus !== core.MEMBER_STATUS.SUSPENDED
    ) {
      return failure(core.ERROR_CODES.VALIDATION_ERROR, {
        status: "สถานะสมาชิกไม่ถูกต้อง"
      });
    }
    if (
      normalizedStatus === core.MEMBER_STATUS.SUSPENDED &&
      !normalizedReason
    ) {
      return failure(core.ERROR_CODES.VALIDATION_ERROR, {
        reason: "กรุณาระบุเหตุผลที่ระงับสมาชิก"
      });
    }

    return repository.withLock(function () {
      var current = repository.findById(memberId);
      if (!current) return failure(core.ERROR_CODES.NOT_FOUND);

      var timestamp = now();
      var updated = repository.update(current.memberId, {
        status: normalizedStatus,
        suspensionReason: normalizedStatus === core.MEMBER_STATUS.SUSPENDED
          ? normalizedReason
          : "",
        updatedAt: timestamp,
        updatedBy: actor
      });
      repository.audit({
        timestamp: timestamp,
        memberId: current.memberId,
        action: normalizedStatus === core.MEMBER_STATUS.SUSPENDED
          ? "SUSPEND"
          : "ACTIVATE",
        actor: actor,
        before: JSON.stringify(publicMember(current)),
        after: JSON.stringify(publicMember(updated))
      });

      return { ok: true, code: "STATUS_UPDATED", member: updated };
    });
  }

  return {
    register: register,
    get: get,
    list: list,
    update: update,
    setStatus: setStatus,
    login: login,
    resetPin: resetPin,
    changePin: changePin,
    updateOwnProfile: updateOwnProfile,
    publicMember: publicMember
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createMemberService: createMemberService };
}
