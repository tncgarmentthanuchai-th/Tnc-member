var ORDER_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  CANCELLED: "CANCELLED"
});

var TIER = Object.freeze({
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum"
});

var TIER_BENEFITS = Object.freeze({
  Silver: Object.freeze({
    discount: 5,
    priority: false,
    freeDesign: false,
    freeDesignPerOrder: 0,
    freeSample: false,
    freeSamplePerOrder: 0,
    freeShipping: false,
    lockedPriceMonths: 0,
    dedicatedAdmin: false,
    eventInvite: false
  }),
  Gold: Object.freeze({
    discount: 8,
    priority: true,
    freeDesign: true,
    freeDesignPerOrder: 1,
    freeSample: true,
    freeSamplePerOrder: 1,
    freeShipping: false,
    lockedPriceMonths: 0,
    dedicatedAdmin: false,
    eventInvite: false
  }),
  Platinum: Object.freeze({
    discount: 12,
    priority: true,
    freeDesign: true,
    freeDesignPerOrder: null,
    freeSample: true,
    freeSamplePerOrder: null,
    freeShipping: true,
    lockedPriceMonths: 6,
    dedicatedAdmin: true,
    eventInvite: true
  })
});

function normalizePointsText(value) {
  return String(value == null ? "" : value).trim();
}

function validationFailure(fields) {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    fields: fields
  };
}

function roundPointsAmount(amount) {
  return Math.round((amount + Number.EPSILON * amount) * 100) / 100;
}

function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validateOrderPayload(payload) {
  var source = payload || {};
  var amount = Number(source.amount);
  var value = {
    memberId: normalizePointsText(source.memberId),
    orderDate: normalizePointsText(source.orderDate),
    amount: roundPointsAmount(amount),
    note: normalizePointsText(source.note)
  };
  var fields = {};

  if (!/^TNC-\d{6}$/.test(value.memberId)) {
    fields.memberId = "กรุณาระบุรหัสสมาชิกในรูปแบบ TNC-000001";
  }
  if (!isIsoCalendarDate(value.orderDate)) {
    fields.orderDate = "กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD";
  }
  if (!Number.isFinite(amount) || value.amount <= 0 || value.amount > 10000000) {
    fields.amount = "ยอดชำระต้องมากกว่า 0 และไม่เกิน 10,000,000";
  }
  if (value.note.length > 500) {
    fields.note = "หมายเหตุต้องไม่เกิน 500 ตัวอักษร";
  }

  return Object.keys(fields).length
    ? validationFailure(fields)
    : { ok: true, value: value };
}

function validateCancellationReason(reason) {
  var value = normalizePointsText(reason);
  if (value.length < 3 || value.length > 300) {
    return validationFailure({
      reason: "เหตุผลการยกเลิกต้องมี 3-300 ตัวอักษร"
    });
  }
  return { ok: true, value: value };
}

function generateOrderId(sequence) {
  var number = Number(sequence);
  if (!Number.isFinite(number) || number < 1 || number > 999999) {
    throw new RangeError("Order sequence must be between 1 and 999999");
  }
  var value = Math.floor(number);
  return "ORD-" + String(value).padStart(6, "0");
}

function calculateTier(points) {
  var value = Number(points);
  if (!Number.isFinite(value) || value < 30000) return TIER.SILVER;
  if (value < 100000) return TIER.GOLD;
  return TIER.PLATINUM;
}

function getTierBenefits(tier) {
  return TIER_BENEFITS[tier] || TIER_BENEFITS[TIER.SILVER];
}

function summarizeOrders(orders) {
  var points = 0;
  var lastOrderAt = "";

  (orders || []).forEach(function (order) {
    if (!order || order.status !== ORDER_STATUS.ACTIVE) return;
    var amount = Number(order.amount);
    var orderDate = normalizePointsText(order.orderDate);
    if (!Number.isFinite(amount) || amount <= 0 || !isIsoCalendarDate(orderDate)) return;
    points += amount;
    if (orderDate > lastOrderAt) lastOrderAt = orderDate;
  });

  points = roundPointsAmount(points);
  return {
    points: points,
    tier: calculateTier(points),
    lastOrderAt: lastOrderAt
  };
}

function paginateOrders(orders, page, pageSize) {
  var items = orders || [];
  var normalizedSize = typeof pageSize === "number" && Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : 10;
  var safeSize = Math.min(100, normalizedSize > 0 ? normalizedSize : 10);
  var total = items.length;
  var totalPages = Math.max(1, Math.ceil(total / safeSize));
  var normalizedPage = typeof page === "number" && Number.isFinite(page) && page > 0
    ? Math.floor(page)
    : 1;
  var safePage = Math.min(totalPages, normalizedPage > 0 ? normalizedPage : 1);
  var start = (safePage - 1) * safeSize;

  return {
    items: items.slice(start, start + safeSize),
    page: safePage,
    pageSize: safeSize,
    total: total,
    totalPages: totalPages
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ORDER_STATUS: ORDER_STATUS,
    TIER: TIER,
    TIER_BENEFITS: TIER_BENEFITS,
    validateOrderPayload: validateOrderPayload,
    validateCancellationReason: validateCancellationReason,
    generateOrderId: generateOrderId,
    calculateTier: calculateTier,
    getTierBenefits: getTierBenefits,
    summarizeOrders: summarizeOrders,
    paginateOrders: paginateOrders
  };
}
