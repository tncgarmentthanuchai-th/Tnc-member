function getOrderDependencies() {
  if (typeof module !== "undefined" && module.exports) {
    return {
      points: require("./PointsCore"),
      memberStatus: require("./Core").MEMBER_STATUS
    };
  }
  return {
    points: {
      ORDER_STATUS: ORDER_STATUS,
      validateOrderPayload: validateOrderPayload,
      validateCancellationReason: validateCancellationReason,
      generateOrderId: generateOrderId,
      summarizeOrders: summarizeOrders,
      paginateOrders: paginateOrders
    },
    memberStatus: MEMBER_STATUS
  };
}

function createOrderService(repository, nowProvider) {
  var dependencies = getOrderDependencies();
  var points = dependencies.points;
  var memberStatus = dependencies.memberStatus;
  var now = nowProvider || function () {
    return new Date().toISOString();
  };

  function failure(code, fields) {
    var result = { ok: false, code: code };
    if (fields) result.fields = fields;
    return result;
  }

  function normalizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function safeOrder(order) {
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

  function summaryMatches(member, summary) {
    var memberPoints = Number(member.points);
    if (!Number.isFinite(memberPoints)) memberPoints = 0;
    return memberPoints === summary.points &&
      (member.tier || "Silver") === summary.tier &&
      (member.lastOrderAt || "") === summary.lastOrderAt;
  }

  function calculateMemberSummary(memberId, memberOrders) {
    return points.summarizeOrders(
      memberOrders || repository.listOrdersByMember(memberId)
    );
  }

  function updateSummary(memberId, summary) {
    return repository.updateMember(memberId, {
      points: summary.points,
      tier: summary.tier,
      lastOrderAt: summary.lastOrderAt
    });
  }

  function auditSummary(memberId, action, actor, before, after, extra) {
    repository.audit({
      timestamp: now(),
      memberId: memberId,
      action: action,
      actor: actor,
      before: before ? JSON.stringify(before) : "",
      after: JSON.stringify(Object.assign({}, after, extra || {}))
    });
  }

  function createOrder(payload, actor) {
    var validation = points.validateOrderPayload(payload);
    if (!validation.ok) return validation;

    return repository.withLock(function () {
      var data = validation.value;
      var member = repository.findMemberById(data.memberId);
      if (!member) return failure("NOT_FOUND");
      if (member.status !== memberStatus.ACTIVE) {
        return failure("MEMBER_SUSPENDED");
      }

      var timestamp = now();
      var order = {
        orderId: points.generateOrderId(repository.nextOrderSequence()),
        memberId: member.memberId,
        memberName: member.fullname,
        orderDate: data.orderDate,
        amount: data.amount,
        note: data.note,
        status: points.ORDER_STATUS.ACTIVE,
        createdAt: timestamp,
        createdBy: actor,
        cancelledAt: "",
        cancelledBy: "",
        cancellationReason: ""
      };
      repository.insertOrder(order);
      var summary = calculateMemberSummary(member.memberId);
      updateSummary(member.memberId, summary);
      auditSummary(
        member.memberId,
        "ORDER_CREATE",
        actor,
        "",
        { order: safeOrder(order), summary: summary }
      );
      return { ok: true, order: safeOrder(order), summary: summary };
    });
  }

  function validateCancellation(payload) {
    var source = payload || {};
    var orderId = normalizeText(source.orderId);
    var fields = {};
    if (!/^ORD-\d{6}$/.test(orderId)) {
      fields.orderId = "กรุณาระบุเลขออร์เดอร์ในรูปแบบ ORD-000001";
    }
    var reasonValidation = points.validateCancellationReason(source.reason);
    if (!reasonValidation.ok) {
      fields.reason = reasonValidation.fields.reason;
    }
    return Object.keys(fields).length
      ? failure("VALIDATION_ERROR", fields)
      : { ok: true, orderId: orderId, reason: reasonValidation.value };
  }

  function cancelOrder(payload, actor) {
    var validation = validateCancellation(payload);
    if (!validation.ok) return validation;

    return repository.withLock(function () {
      var current = repository.findOrderById(validation.orderId);
      if (!current) return failure("NOT_FOUND");
      if (current.status === points.ORDER_STATUS.CANCELLED) {
        return failure("ORDER_ALREADY_CANCELLED");
      }
      var member = repository.findMemberById(current.memberId);
      if (!member) return failure("NOT_FOUND");

      var updated = repository.updateOrder(current.orderId, {
        status: points.ORDER_STATUS.CANCELLED,
        cancelledAt: now(),
        cancelledBy: actor,
        cancellationReason: validation.reason
      });
      var summary = calculateMemberSummary(member.memberId);
      updateSummary(member.memberId, summary);
      auditSummary(
        member.memberId,
        "ORDER_CANCEL",
        actor,
        { order: safeOrder(current) },
        {
          order: safeOrder(updated),
          summary: summary,
          reason: validation.reason
        }
      );
      return { ok: true, order: safeOrder(updated), summary: summary };
    });
  }

  function listMemberOrders(memberId, query) {
    var normalizedId = normalizeText(memberId);
    if (!repository.findMemberById(normalizedId)) return failure("NOT_FOUND");
    var options = query || {};
    var status = normalizeText(options.status);
    if (
      status &&
      status !== points.ORDER_STATUS.ACTIVE &&
      status !== points.ORDER_STATUS.CANCELLED
    ) {
      return failure("VALIDATION_ERROR", {
        status: "สถานะออร์เดอร์ไม่ถูกต้อง"
      });
    }
    var orders = repository.listOrdersByMember(normalizedId)
      .filter(function (order) {
        return !status || order.status === status;
      })
      .sort(function (left, right) {
        var dateCompare = String(right.orderDate || "")
          .localeCompare(String(left.orderDate || ""));
        return dateCompare || String(right.createdAt || "")
          .localeCompare(String(left.createdAt || ""));
      })
      .map(safeOrder);
    var page = points.paginateOrders(orders, options.page, options.pageSize);
    page.ok = true;
    return page;
  }

  function rebuildUnlocked(member, actor, action, memberOrders) {
    var summary = calculateMemberSummary(member.memberId, memberOrders);
    if (summaryMatches(member, summary)) {
      return { ok: true, changed: false, summary: summary };
    }
    var existingPoints = Number(member.points);
    var before = {
      points: Number.isFinite(existingPoints) ? existingPoints : 0,
      tier: member.tier || "Silver",
      lastOrderAt: member.lastOrderAt || ""
    };
    updateSummary(member.memberId, summary);
    auditSummary(
      member.memberId,
      action || "POINTS_REBUILD",
      actor,
      before,
      summary
    );
    return { ok: true, changed: true, summary: summary };
  }

  function rebuildMemberPoints(memberId, actor, action) {
    var normalizedId = normalizeText(memberId);
    return repository.withLock(function () {
      var member = repository.findMemberById(normalizedId);
      if (!member) return failure("NOT_FOUND");
      return rebuildUnlocked(member, actor, action);
    });
  }

  function reconcileAllMemberPoints(actor) {
    return repository.withLock(function () {
      var updated = 0;
      var ordersByMember = {};
      var allOrders = repository.listAllOrders
        ? repository.listAllOrders()
        : [];
      allOrders.forEach(function (order) {
        if (!ordersByMember[order.memberId]) ordersByMember[order.memberId] = [];
        ordersByMember[order.memberId].push(order);
      });
      repository.listMembers().forEach(function (member) {
        var memberOrders = repository.listAllOrders
          ? (ordersByMember[member.memberId] || [])
          : repository.listOrdersByMember(member.memberId);
        if (
          rebuildUnlocked(
            member,
            actor || "SYSTEM",
            "POINTS_REBUILD",
            memberOrders
          ).changed
        ) {
          updated += 1;
        }
      });
      return { ok: true, updated: updated };
    });
  }

  return {
    createOrder: createOrder,
    cancelOrder: cancelOrder,
    listMemberOrders: listMemberOrders,
    rebuildMemberPoints: rebuildMemberPoints,
    reconcileAllMemberPoints: reconcileAllMemberPoints,
    safeOrder: safeOrder
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createOrderService: createOrderService };
}
