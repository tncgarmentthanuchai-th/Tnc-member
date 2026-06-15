const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { createOrderService } = require("../src/OrderService");

function createMemoryRepository(seedMembers = [], seedOrders = []) {
  const members = seedMembers.map((member) => ({ ...member }));
  const orders = seedOrders.map((order) => ({ ...order }));
  const audits = [];
  let sequence = orders.length;
  let lockCount = 0;
  let allOrderReads = 0;

  return {
    members,
    orders,
    audits,
    get lockCount() {
      return lockCount;
    },
    get allOrderReads() {
      return allOrderReads;
    },
    withLock(callback) {
      lockCount += 1;
      return callback();
    },
    findMemberById(memberId) {
      return members.find((member) => member.memberId === memberId) || null;
    },
    updateMember(memberId, changes) {
      const index = members.findIndex((member) => member.memberId === memberId);
      if (index < 0) return null;
      members[index] = { ...members[index], ...changes };
      return { ...members[index] };
    },
    listMembers() {
      return members.map((member) => ({ ...member }));
    },
    nextOrderSequence() {
      sequence += 1;
      return sequence;
    },
    insertOrder(order) {
      orders.push({ ...order });
      return { ...order };
    },
    findOrderById(orderId) {
      return orders.find((order) => order.orderId === orderId) || null;
    },
    updateOrder(orderId, changes) {
      const index = orders.findIndex((order) => order.orderId === orderId);
      if (index < 0) return null;
      orders[index] = { ...orders[index], ...changes };
      return { ...orders[index] };
    },
    listOrdersByMember(memberId) {
      return orders
        .filter((order) => order.memberId === memberId)
        .map((order) => ({ ...order }));
    },
    listAllOrders() {
      allOrderReads += 1;
      return orders.map((order) => ({ ...order }));
    },
    audit(entry) {
      audits.push({ ...entry });
    }
  };
}

function member(overrides = {}) {
  return {
    memberId: "TNC-000001",
    fullname: "สมชาย ใจดี",
    status: "ใช้งาน",
    points: 0,
    tier: "Silver",
    lastOrderAt: "",
    ...overrides
  };
}

function order(overrides = {}) {
  return {
    orderId: "ORD-000001",
    memberId: "TNC-000001",
    memberName: "สมชาย ใจดี",
    orderDate: "2026-05-01",
    amount: 20000,
    note: "",
    status: "ACTIVE",
    createdAt: "2026-05-01T10:00:00.000Z",
    createdBy: "admin@example.com",
    cancelledAt: "",
    cancelledBy: "",
    cancellationReason: "",
    ...overrides
  };
}

test("create order updates points, tier, latest date, and audit", () => {
  const repository = createMemoryRepository([member()]);
  const service = createOrderService(
    repository,
    () => "2026-06-12T10:00:00.000Z"
  );

  const result = service.createOrder({
    memberId: "TNC-000001",
    orderDate: "2026-06-12",
    amount: "30000",
    note: "มัดจำ"
  }, "admin@example.com");

  assert.equal(result.ok, true);
  assert.equal(result.order.orderId, "ORD-000001");
  assert.equal(result.order.status, "ACTIVE");
  assert.deepEqual(result.summary, {
    points: 30000,
    tier: "Gold",
    lastOrderAt: "2026-06-12"
  });
  assert.equal(repository.members[0].points, 30000);
  assert.equal(repository.members[0].tier, "Gold");
  assert.equal(repository.audits[0].action, "ORDER_CREATE");
  assert.equal(repository.audits[0].actor, "admin@example.com");
  assert.equal(repository.lockCount, 1);
});

test("create order uses sequential ids and decimal totals", () => {
  const repository = createMemoryRepository([member()]);
  const service = createOrderService(repository, () => "2026-06-12T10:00:00.000Z");

  const first = service.createOrder({
    memberId: "TNC-000001", orderDate: "2026-06-11", amount: 0.1
  }, "admin@example.com");
  const second = service.createOrder({
    memberId: "TNC-000001", orderDate: "2026-06-12", amount: 0.2
  }, "admin@example.com");

  assert.equal(first.order.orderId, "ORD-000001");
  assert.equal(second.order.orderId, "ORD-000002");
  assert.equal(second.summary.points, 0.3);
});

test("create order rejects missing and suspended members", () => {
  const repository = createMemoryRepository([
    member({ memberId: "TNC-000002", status: "ระงับ" })
  ]);
  const service = createOrderService(repository);
  const payload = {
    memberId: "TNC-000001", orderDate: "2026-06-12", amount: 100
  };

  assert.equal(service.createOrder(payload, "admin@example.com").code, "NOT_FOUND");
  assert.equal(service.createOrder({
    ...payload, memberId: "TNC-000002"
  }, "admin@example.com").code, "MEMBER_SUSPENDED");
  assert.equal(repository.orders.length, 0);
});

test("cancel order subtracts points, lowers tier, and moves latest date backward", () => {
  const repository = createMemoryRepository(
    [member({ points: 110000, tier: "Platinum", lastOrderAt: "2026-06-01" })],
    [
      order({ orderId: "ORD-000001", amount: 20000, orderDate: "2026-05-01" }),
      order({ orderId: "ORD-000002", amount: 90000, orderDate: "2026-06-01" })
    ]
  );
  const service = createOrderService(
    repository,
    () => "2026-06-12T11:00:00.000Z"
  );

  const result = service.cancelOrder({
    orderId: "ORD-000002",
    reason: "ลูกค้ายกเลิกคำสั่งซื้อ"
  }, "admin@example.com");

  assert.equal(result.ok, true);
  assert.equal(result.order.status, "CANCELLED");
  assert.equal(result.order.cancelledBy, "admin@example.com");
  assert.equal(result.order.cancellationReason, "ลูกค้ายกเลิกคำสั่งซื้อ");
  assert.deepEqual(result.summary, {
    points: 20000,
    tier: "Silver",
    lastOrderAt: "2026-05-01"
  });
  assert.equal(repository.audits.at(-1).action, "ORDER_CANCEL");
});

test("cancel order validates input and rejects repeated cancellation", () => {
  const repository = createMemoryRepository(
    [member()],
    [order({ status: "CANCELLED" })]
  );
  const service = createOrderService(repository);

  assert.equal(service.cancelOrder({
    orderId: "bad", reason: "ถูกต้องแล้ว"
  }, "admin@example.com").code, "VALIDATION_ERROR");
  assert.equal(service.cancelOrder({
    orderId: "ORD-000001", reason: "ถูกยกเลิกแล้ว"
  }, "admin@example.com").code, "ORDER_ALREADY_CANCELLED");
});

test("list member orders sorts, filters, and paginates newest first", () => {
  const repository = createMemoryRepository(
    [member()],
    [
      order({ orderId: "ORD-000001", orderDate: "2026-05-01" }),
      order({
        orderId: "ORD-000002",
        orderDate: "2026-06-01",
        createdAt: "2026-06-01T09:00:00.000Z",
        status: "CANCELLED"
      }),
      order({
        orderId: "ORD-000003",
        orderDate: "2026-06-01",
        createdAt: "2026-06-01T10:00:00.000Z"
      })
    ]
  );
  const service = createOrderService(repository);

  const all = service.listMemberOrders("TNC-000001", { page: 1, pageSize: 2 });
  assert.deepEqual(all.items.map((item) => item.orderId), [
    "ORD-000003", "ORD-000002"
  ]);
  assert.equal(all.total, 3);

  const cancelled = service.listMemberOrders("TNC-000001", {
    status: "CANCELLED", page: 1, pageSize: 10
  });
  assert.deepEqual(cancelled.items.map((item) => item.orderId), ["ORD-000002"]);
  assert.equal(service.listMemberOrders("TNC-000001", {
    status: "INVALID"
  }).code, "VALIDATION_ERROR");
  assert.equal(
    service.listMemberOrders("TNC-999999", {}).code,
    "NOT_FOUND"
  );
});

test("rebuild repairs corrupted summary and no-op rebuild does not audit", () => {
  const repository = createMemoryRepository(
    [member({ points: 999, tier: "Platinum", lastOrderAt: "bad" })],
    [order({ amount: 30000, orderDate: "2026-06-01" })]
  );
  const service = createOrderService(repository, () => "2026-06-12T12:00:00.000Z");

  const repaired = service.rebuildMemberPoints(
    "TNC-000001", "admin@example.com"
  );
  assert.equal(repaired.ok, true);
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.summary, {
    points: 30000,
    tier: "Gold",
    lastOrderAt: "2026-06-01"
  });
  assert.equal(repository.audits.at(-1).action, "POINTS_REBUILD");

  const auditCount = repository.audits.length;
  const unchanged = service.rebuildMemberPoints(
    "TNC-000001", "admin@example.com"
  );
  assert.equal(unchanged.changed, false);
  assert.equal(repository.audits.length, auditCount);
});

test("reconcile updates only mismatched members under one lock", () => {
  const repository = createMemoryRepository(
    [
      member({ memberId: "TNC-000001", points: 0 }),
      member({
        memberId: "TNC-000002",
        fullname: "สุดา มีสุข",
        points: 100,
        tier: "Silver",
        lastOrderAt: "2026-05-01"
      })
    ],
    [
      order({ memberId: "TNC-000001", amount: 30000 }),
      order({
        orderId: "ORD-000002",
        memberId: "TNC-000002",
        memberName: "สุดา มีสุข",
        amount: 100
      })
    ]
  );
  const service = createOrderService(repository, () => "2026-06-12T12:00:00.000Z");

  const result = service.reconcileAllMemberPoints("SYSTEM");

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(repository.members[0].tier, "Gold");
  assert.equal(repository.audits.length, 1);
  assert.equal(repository.lockCount, 1);
  assert.equal(repository.allOrderReads, 1);
});

test("order audits never include member authentication fields", () => {
  const repository = createMemoryRepository([
    member({ pinHash: "hash", pinSalt: "salt", sessionVersion: 9 })
  ]);
  const service = createOrderService(repository, () => "2026-06-12T10:00:00.000Z");

  service.createOrder({
    memberId: "TNC-000001", orderDate: "2026-06-12", amount: 100
  }, "admin@example.com");

  const audit = JSON.stringify(repository.audits);
  assert.equal(audit.includes("pinHash"), false);
  assert.equal(audit.includes("pinSalt"), false);
  assert.equal(audit.includes("sessionVersion"), false);
});

test("safe order output normalizes corrupted non-finite amounts", () => {
  const repository = createMemoryRepository(
    [member()],
    [order({ amount: Infinity })]
  );
  const service = createOrderService(repository);

  const result = service.listMemberOrders("TNC-000001", {});

  assert.equal(result.items[0].amount, 0);
});

test("missing order and member rebuild return NOT_FOUND", () => {
  const repository = createMemoryRepository([member()]);
  const service = createOrderService(repository);

  assert.equal(service.cancelOrder({
    orderId: "ORD-999999",
    reason: "ไม่พบรายการนี้"
  }, "admin@example.com").code, "NOT_FOUND");
  assert.equal(
    service.rebuildMemberPoints("TNC-999999", "admin@example.com").code,
    "NOT_FOUND"
  );
});

test("sheet repository normalizes order Date values to ISO calendar dates", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "SheetRepository.js"),
    "utf8"
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);

  const value = vm.runInContext(
    "sheetDateToIsoDate(new Date('2026-06-12T00:00:00.000Z'))",
    context
  );

  assert.equal(value, "2026-06-12");
});

test("sheet repository matches phones after Sheet removes the leading zero", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "SheetRepository.js"),
    "utf8"
  );
  const context = {
    normalizePhone(value) {
      const digits = String(value == null ? "" : value).replace(/\D/g, "");
      if (/^66\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
      if (/^[1-9]\d{8}$/.test(digits)) return `0${digits}`;
      return digits;
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(
    vm.runInContext("phoneValuesMatch('0812345678', 812345678)", context),
    true
  );
  assert.equal(
    vm.runInContext(
      "phoneValuesMatch('0812345678', '+66 81-234-5678')",
      context
    ),
    true
  );
});

test("sheet repository selects the newest row when legacy duplicates exist", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "SheetRepository.js"),
    "utf8"
  );
  const context = {
    normalizePhone(value) {
      return String(value == null ? "" : value).replace(/\D/g, "");
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.testSheet = {
    getLastRow() {
      return 3;
    },
    getRange() {
      return {
        getValues() {
          return [
            ["TNC-000001", "Old"],
            ["TNC-000002", "Newest"]
          ];
        }
      };
    }
  };

  const found = vm.runInContext(
    "findLastDataRow(testSheet, ['memberId', 'fullname'], function () { return true; })",
    context
  );

  assert.equal(found.rowNumber, 3);
  assert.equal(found.value.memberId, "TNC-000002");
});

test("OrderService resolves PointsCore and member status as Apps Script globals", () => {
  const context = {};
  vm.createContext(context);
  ["Core.js", "PointsCore.js", "OrderService.js"].forEach((file) => {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"),
      context
    );
  });

  const dependencies = vm.runInContext("getOrderDependencies()", context);

  assert.equal(dependencies.points.ORDER_STATUS.ACTIVE, "ACTIVE");
  assert.equal(dependencies.memberStatus.ACTIVE, "ใช้งาน");
  assert.equal(typeof context.createOrderService, "function");
});
