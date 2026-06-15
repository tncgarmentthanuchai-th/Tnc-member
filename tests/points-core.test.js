const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pointsCorePath = path.join(__dirname, "..", "src", "PointsCore.js");
const {
  ORDER_STATUS,
  TIER,
  validateOrderPayload,
  validateCancellationReason,
  generateOrderId,
  calculateTier,
  normalizeTier,
  getTierBenefits,
  summarizeOrders,
  paginateOrders
} = require(pointsCorePath);

function assertThaiFieldErrors(result, fields) {
  assert.equal(result.ok, false);
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.deepEqual(Object.keys(result.fields).sort(), fields.sort());
  Object.values(result.fields).forEach((message) => {
    assert.match(message, /[\u0E00-\u0E7F]/);
  });
}

test("exports stable order status and tier constants", () => {
  assert.deepEqual(ORDER_STATUS, {
    ACTIVE: "ACTIVE",
    CANCELLED: "CANCELLED"
  });
  assert.deepEqual(TIER, {
    SILVER: "Silver",
    GOLD: "Gold",
    PLATINUM: "Platinum"
  });
});

test("valid order payload is normalized and amount is rounded to two decimals", () => {
  const result = validateOrderPayload({
    memberId: " TNC-000001 ",
    orderDate: "2026-06-12",
    amount: "30000.129",
    note: "  ชำระครบ  "
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      memberId: "TNC-000001",
      orderDate: "2026-06-12",
      amount: 30000.13,
      note: "ชำระครบ"
    }
  });
});

test("order amount uses decimal half-up rounding at two decimals", () => {
  const result = validateOrderPayload({
    memberId: "TNC-000001",
    orderDate: "2026-06-12",
    amount: 10.075
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.amount, 10.08);
});

test("order validation returns Thai field errors for invalid fields", () => {
  assertThaiFieldErrors(validateOrderPayload({
    memberId: "tnc-1",
    orderDate: "12/06/2026",
    amount: "NaN",
    note: "x".repeat(501)
  }), ["memberId", "orderDate", "amount", "note"]);

  [0, -1, Infinity, 10000000.01].forEach((amount) => {
    assertThaiFieldErrors(validateOrderPayload({
      memberId: "TNC-000001",
      orderDate: "2026-06-12",
      amount
    }), ["amount"]);
  });
});

test("order validation rejects impossible calendar dates", () => {
  assertThaiFieldErrors(validateOrderPayload({
    memberId: "TNC-000001",
    orderDate: "2026-02-30",
    amount: 100
  }), ["orderDate"]);
});

test("order validation applies limits to the rounded amount", () => {
  [0.001, 10000000.005].forEach((amount) => {
    assertThaiFieldErrors(validateOrderPayload({
      memberId: "TNC-000001",
      orderDate: "2026-06-12",
      amount
    }), ["amount"]);
  });

  const boundary = validateOrderPayload({
    memberId: "TNC-000001",
    orderDate: "2026-06-12",
    amount: 10000000.004
  });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.value.amount, 10000000);
});

test("cancellation reason is trimmed and constrained to 3-300 characters", () => {
  assert.deepEqual(validateCancellationReason("  ยกเลิกรายการซ้ำ  "), {
    ok: true,
    value: "ยกเลิกรายการซ้ำ"
  });
  assertThaiFieldErrors(validateCancellationReason("no"), ["reason"]);
  assertThaiFieldErrors(validateCancellationReason("x".repeat(301)), ["reason"]);
});

test("tier boundaries are deterministic", () => {
  assert.equal(calculateTier(0), TIER.SILVER);
  assert.equal(calculateTier(29999.99), TIER.SILVER);
  assert.equal(calculateTier(30000), TIER.GOLD);
  assert.equal(calculateTier(99999.99), TIER.GOLD);
  assert.equal(calculateTier(100000), TIER.PLATINUM);
});

test("tier normalization ignores casing and surrounding whitespace", () => {
  assert.equal(normalizeTier(" silver "), TIER.SILVER);
  assert.equal(normalizeTier("GOLD"), TIER.GOLD);
  assert.equal(normalizeTier(" platinum "), TIER.PLATINUM);
});

test("tier normalization defaults unknown values to Silver", () => {
  [undefined, null, "", "diamond"].forEach((tier) => {
    assert.equal(normalizeTier(tier), TIER.SILVER);
  });
});

test("tier benefits match the approved specification", () => {
  assert.deepEqual(getTierBenefits(TIER.SILVER), {
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
  });
  assert.deepEqual(getTierBenefits(TIER.GOLD), {
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
  });
  assert.deepEqual(getTierBenefits(TIER.PLATINUM), {
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
  });
});

test("tier benefits use normalized tier values", () => {
  assert.equal(getTierBenefits("GOLD").discount, 8);
  assert.equal(getTierBenefits(" platinum ").discount, 12);
  assert.equal(getTierBenefits("diamond").discount, 5);
});

test("summary ignores cancelled orders, rounds totals, and keeps latest active date", () => {
  const summary = summarizeOrders([
    { status: ORDER_STATUS.ACTIVE, amount: 0.1, orderDate: "2026-05-01" },
    { status: ORDER_STATUS.CANCELLED, amount: 90000, orderDate: "2026-06-01" },
    { status: ORDER_STATUS.ACTIVE, amount: 0.2, orderDate: "2026-05-10" },
    { status: ORDER_STATUS.ACTIVE, amount: 29999.7, orderDate: "2026-05-20" }
  ]);

  assert.deepEqual(summary, {
    points: 30000,
    tier: TIER.GOLD,
    lastOrderAt: "2026-05-20"
  });
  assert.deepEqual(summarizeOrders([]), {
    points: 0,
    tier: TIER.SILVER,
    lastOrderAt: ""
  });
});

test("summary ignores active records with invalid amounts or calendar dates", () => {
  const summary = summarizeOrders([
    { status: ORDER_STATUS.ACTIVE, amount: 10.125, orderDate: "2026-05-01" },
    { status: ORDER_STATUS.ACTIVE, amount: 20.125, orderDate: "2026-05-20" },
    { status: ORDER_STATUS.ACTIVE, amount: 100, orderDate: "2026-02-30" },
    { status: ORDER_STATUS.ACTIVE, amount: 100, orderDate: "not-a-date" },
    { status: ORDER_STATUS.ACTIVE, amount: NaN, orderDate: "2026-06-01" },
    { status: ORDER_STATUS.ACTIVE, amount: Infinity, orderDate: "2026-06-02" },
    { status: ORDER_STATUS.ACTIVE, amount: 0, orderDate: "2026-06-03" },
    { status: ORDER_STATUS.ACTIVE, amount: -1, orderDate: "2026-06-04" }
  ]);

  assert.deepEqual(summary, {
    points: 30.25,
    tier: TIER.SILVER,
    lastOrderAt: "2026-05-20"
  });
});

test("order ids use six digits and pagination clamps page and page size", () => {
  assert.equal(generateOrderId(7), "ORD-000007");

  const orders = Array.from({ length: 21 }, (_, index) => ({ index }));
  assert.deepEqual(paginateOrders(orders, 99, 10), {
    items: orders.slice(20),
    page: 3,
    pageSize: 10,
    total: 21,
    totalPages: 3
  });
  assert.equal(paginateOrders(orders, 0, 0).page, 1);
  assert.equal(paginateOrders(orders, 1).pageSize, 10);
});

test("order ids floor valid fractional sequences without creating overflow duplicates", () => {
  assert.equal(generateOrderId(7.9), "ORD-000007");
  assert.equal(generateOrderId(999998.9), "ORD-999998");
});

test("order ids reject non-finite and out-of-range sequences", () => {
  [NaN, Infinity, -Infinity, 0, -1, 1000000, Number.MAX_SAFE_INTEGER].forEach((sequence) => {
    assert.throws(() => generateOrderId(sequence), RangeError);
  });
});

test("pagination floors fractional page and page size to positive integers", () => {
  const orders = Array.from({ length: 20 }, (_, index) => ({ index }));

  assert.deepEqual(paginateOrders(orders, 2.9, 4.8), {
    items: orders.slice(4, 8),
    page: 2,
    pageSize: 4,
    total: 20,
    totalPages: 5
  });
});

test("pagination defaults invalid numeric inputs and caps page size", () => {
  const orders = Array.from({ length: 250 }, (_, index) => ({ index }));

  [undefined, null, 0, -1, NaN, Infinity, -Infinity, true, false, "2"].forEach((page) => {
    assert.equal(paginateOrders(orders, page, 10).page, 1);
  });

  [undefined, null, 0, -1, NaN, Infinity, -Infinity, true, false, "20"].forEach((pageSize) => {
    assert.equal(paginateOrders(orders, 1, pageSize).pageSize, 10);
  });

  assert.equal(paginateOrders(orders, 1, 101).pageSize, 100);
  assert.equal(paginateOrders(orders, 1, 1000).pageSize, 100);
});

test("top-level declarations are available as Apps Script globals", () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(pointsCorePath, "utf8"), context);

  assert.equal(context.ORDER_STATUS.ACTIVE, "ACTIVE");
  assert.equal(context.TIER.PLATINUM, "Platinum");
  assert.equal(context.generateOrderId(12), "ORD-000012");
  assert.equal(context.calculateTier(30000), "Gold");
});
