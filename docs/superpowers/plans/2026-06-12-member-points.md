# Member Points and Tier System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed paid orders, lifetime points, automatic Tier calculation, order cancellation, member order history, and nightly reconciliation.

**Architecture:** Keep `Orders` as the source of truth and cache `points`, `tier`, and `lastOrderAt` on each member for inexpensive reads. Put deterministic validation and calculations in `PointsCore.js`, business mutations in `OrderService.js`, Google Sheets access in the repository, and expose narrowly scoped admin/member APIs through `Code.js`.

**Tech Stack:** Google Apps Script, Google Sheets, Vanilla HTML/CSS/JavaScript, Node.js built-in test runner

---

## File Map

- Create `src/PointsCore.js`: order validation, Tier rules, benefits, pagination, and summary calculations.
- Create `src/OrderService.js`: create, cancel, list, rebuild, and reconcile order workflows.
- Create `tests/points-core.test.js`: deterministic points and Tier tests.
- Create `tests/order-service.test.js`: service behavior with an in-memory repository.
- Modify `src/SheetRepository.js`: member summary fields plus Orders repository operations.
- Modify `src/Setup.js`: schema version 3 migration, Orders sheet, settings, formatting, and trigger installation.
- Modify `src/appsscript.json`: authorize time-driven trigger management.
- Modify `src/MemberService.js`: initialize and safely expose member points summary.
- Modify `src/Code.js`: admin/member order APIs and safe response mappers.
- Modify `src/Admin.html`, `src/AdminScript.html`, `src/Styles.html`: admin order management.
- Modify `src/Member.html`, `src/MemberScript.html`, `src/Styles.html`: member summary, benefits, progress, and history.
- Modify `tests/member-service.test.js`, `tests/static.test.js`: regression and integration contracts.
- Modify `README.md`, `docs/DEPLOYMENT.md`: operation and deployment instructions.

### Task 1: Points Core

**Files:**
- Create: `src/PointsCore.js`
- Create: `tests/points-core.test.js`

- [ ] **Step 1: Write failing validation and Tier tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORDER_STATUS,
  validateOrderPayload,
  validateCancellationReason,
  generateOrderId,
  calculateTier,
  getTierBenefits,
  summarizeOrders,
  paginateOrders
} = require("../src/PointsCore");

test("valid order amount is rounded to two decimals", () => {
  const result = validateOrderPayload({
    memberId: " TNC-000001 ",
    orderDate: "2026-06-12",
    amount: "30000.129",
    note: "ชำระครบ"
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

test("invalid amounts and cancellation reasons are rejected", () => {
  [0, -1, "NaN", 10000000.01].forEach((amount) => {
    assert.equal(validateOrderPayload({
      memberId: "TNC-000001",
      orderDate: "2026-06-12",
      amount
    }).ok, false);
  });
  assert.equal(validateCancellationReason("no").ok, false);
  assert.equal(validateCancellationReason("ยกเลิกรายการซ้ำ").ok, true);
});

test("tier boundaries and benefits are deterministic", () => {
  assert.equal(calculateTier(0), "Silver");
  assert.equal(calculateTier(29999.99), "Silver");
  assert.equal(calculateTier(30000), "Gold");
  assert.equal(calculateTier(99999.99), "Gold");
  assert.equal(calculateTier(100000), "Platinum");
  assert.equal(getTierBenefits("Gold").discount, 8);
  assert.equal(getTierBenefits("Platinum").lockedPriceMonths, 6);
});

test("summary ignores cancelled orders and keeps latest active date", () => {
  const summary = summarizeOrders([
    { status: ORDER_STATUS.ACTIVE, amount: 25000, orderDate: "2026-05-01" },
    { status: ORDER_STATUS.CANCELLED, amount: 90000, orderDate: "2026-06-01" },
    { status: ORDER_STATUS.ACTIVE, amount: 10000, orderDate: "2026-05-20" }
  ]);
  assert.deepEqual(summary, {
    points: 35000,
    tier: "Gold",
    lastOrderAt: "2026-05-20"
  });
});

test("order ids and pagination use stable contracts", () => {
  assert.equal(generateOrderId(7), "ORD-000007");
  const orders = Array.from({ length: 21 }, (_, index) => ({ index }));
  const page = paginateOrders(orders, 3, 10);
  assert.equal(page.page, 3);
  assert.equal(page.totalPages, 3);
  assert.deepEqual(page.items, orders.slice(20));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/points-core.test.js`

Expected: FAIL because `../src/PointsCore` does not exist.

- [ ] **Step 3: Implement the pure points module**

Create constants `ORDER_STATUS`, `TIER`, and `TIER_BENEFITS`; implement the exported
functions used by the tests. Validation must return
`{ ok: false, code: "VALIDATION_ERROR", fields }`, accept only `TNC-\d{6}`,
require an ISO `YYYY-MM-DD` date, limit notes to 500 characters, reject non-finite
amounts, and round with `Math.round((amount + Number.EPSILON) * 100) / 100`.
`summarizeOrders()` must sum only ACTIVE rows and round the final total to two decimals.

- [ ] **Step 4: Run the focused and full suites**

Run: `node --test tests/points-core.test.js`

Expected: 5 tests pass.

Run: `npm.cmd test`

Expected: all existing and new tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/PointsCore.js tests/points-core.test.js
git commit -m "feat: add points and tier core"
```

### Task 2: Member Summary Schema and Migration

**Files:**
- Modify: `src/SheetRepository.js`
- Modify: `src/Setup.js`
- Modify: `src/MemberService.js`
- Modify: `src/appsscript.json`
- Modify: `tests/member-service.test.js`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing member defaults and schema contract tests**

Add assertions to the registration test:

```js
assert.equal(repository.members[0].points, 0);
assert.equal(repository.members[0].tier, "Silver");
assert.equal(repository.members[0].lastOrderAt, "");
assert.equal(result.points, undefined);
```

Add static assertions:

```js
const repositorySource = fs.readFileSync(
  path.join(sourceDirectory, "SheetRepository.js"), "utf8"
);
const setupSource = fs.readFileSync(path.join(sourceDirectory, "Setup.js"), "utf8");
assert.match(repositorySource, /"points",\s*"tier",\s*"lastOrderAt"/);
assert.match(setupSource, /SYSTEM_SCHEMA_VERSION"[\s\S]*"3"/);
assert.match(setupSource, /ensureSheet\(spreadsheet,\s*"Orders"/);
const manifest = JSON.parse(
  fs.readFileSync(path.join(sourceDirectory, "appsscript.json"), "utf8")
);
assert.equal(
  manifest.oauthScopes.includes("https://www.googleapis.com/auth/script.scriptapp"),
  true
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/member-service.test.js tests/static.test.js`

Expected: FAIL because member defaults, schema version 3, and Orders setup are absent.

- [ ] **Step 3: Extend member rows and registration**

Append `"points"`, `"tier"`, and `"lastOrderAt"` to `MEMBER_HEADERS`.
Set these fields to `0`, `"Silver"`, and `""` in `MemberService.register()`.
Include the summary fields in `publicMember()` and `safeAdminMember_()` while keeping
PIN fields private.

- [ ] **Step 4: Implement idempotent schema version 3 migration**

Define `ORDER_HEADERS` using the exact 12 fields in the approved spec. Update
`setupTncMemberSystem()` to ensure `Members`, `AuditLog`, `Settings`, and `Orders`,
ensure both sequence settings, fill blank summary cells for existing member rows,
format the Orders amount column as `#,##0.00`, and set `SYSTEM_SCHEMA_VERSION` to `3`.
Update `ensureSystemReady_()` to compare against version `3`.
Add `https://www.googleapis.com/auth/script.scriptapp` to the manifest scopes.
Update the existing exact manifest assertion in `tests/static.test.js` to expect
the original two scopes plus `script.scriptapp`.

Add `installPointsReconciliationTrigger()` that deletes duplicate triggers whose
handler is `reconcileAllMemberPoints`, then installs one daily time trigger.
Do not call it from `setupTncMemberSystem()` or `ensureSystemReady_()`, because those
can run during public requests. Call it only from `bootstrapTncMemberSystem()`, which
the owner runs manually.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd test`

Expected: all tests pass.

```powershell
git add src/SheetRepository.js src/Setup.js src/MemberService.js src/appsscript.json tests/member-service.test.js tests/static.test.js
git commit -m "feat: migrate member points schema"
```

### Task 3: Orders Repository and Service

**Files:**
- Create: `src/OrderService.js`
- Create: `tests/order-service.test.js`
- Modify: `src/SheetRepository.js`

- [ ] **Step 1: Write the in-memory repository and failing create tests**

Create an in-memory repository exposing:

```js
{
  members, orders, audits,
  withLock(callback),
  findMemberById(memberId),
  updateMember(memberId, changes),
  nextOrderSequence(),
  insertOrder(order),
  findOrderById(orderId),
  updateOrder(orderId, changes),
  listOrdersByMember(memberId),
  audit(entry)
}
```

Write tests that create an ACTIVE member, call:

```js
const result = service.createOrder({
  memberId: "TNC-000001",
  orderDate: "2026-06-12",
  amount: "30000",
  note: "มัดจำ"
}, "admin@example.com");
```

Assert `ORD-000001`, ACTIVE status, 30,000 points, Gold Tier, updated
`lastOrderAt`, and `ORDER_CREATE` audit. Add tests rejecting a missing member and
a suspended member with `NOT_FOUND` and `MEMBER_SUSPENDED`.

- [ ] **Step 2: Run create tests and verify RED**

Run: `node --test --test-name-pattern="create order|rejects missing|rejects suspended" tests/order-service.test.js`

Expected: FAIL because `OrderService` does not exist.

- [ ] **Step 3: Implement create workflow**

Implement `createOrderService(repository, nowProvider)` and
`createOrder(payload, actor)`. Load `PointsCore` through a Node/Apps Script adapter,
validate before locking, then inside one `withLock()` re-read the member, verify
ACTIVE status, issue the sequence, insert the order, summarize that member's orders,
update member summary, and append the audit. Return only safe order and summary data.

- [ ] **Step 4: Write failing cancellation, list, and rebuild tests**

Cover:

```js
service.cancelOrder(
  { orderId: "ORD-000002", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" },
  "admin@example.com"
);
```

Assert cancellation metadata, points decreasing from 110,000 to 20,000, Tier falling
from Platinum to Silver, recalculated latest active date, `ORDER_CANCEL`, rejection
of a second cancellation, newest-first pagination, and rebuild repairing intentionally
corrupted member summary with `POINTS_REBUILD`.

- [ ] **Step 5: Run cancellation tests and verify RED**

Run: `node --test tests/order-service.test.js`

Expected: create tests pass; cancellation/list/rebuild tests fail because methods are missing.

- [ ] **Step 6: Implement cancellation, list, rebuild, and reconciliation**

Implement:

```js
cancelOrder(payload, actor)
listMemberOrders(memberId, query)
rebuildMemberPoints(memberId, actor, action)
reconcileAllMemberPoints(actor)
```

Cancellation validation occurs before lock; order/member checks and writes occur
inside lock. `listMemberOrders` supports status plus pages of 10 by default and
sorts by `orderDate`, then `createdAt`, newest first. Reconciliation writes only
members whose cached summary differs and uses action `POINTS_REBUILD`.

- [ ] **Step 7: Add Google Sheets repository operations**

In `createSheetRepository()`, require the Orders sheet and expose methods matching
the service's repository contract. Reuse current member methods through aliases
`findMemberById` and `updateMember`. Add `nextOrderSequence`, row conversion helpers,
batch `listOrdersByMember`, and single-row `updateOrder`.

- [ ] **Step 8: Run all tests and commit**

Run: `npm.cmd test`

Expected: all tests pass.

```powershell
git add src/OrderService.js src/SheetRepository.js tests/order-service.test.js
git commit -m "feat: add order points service"
```

### Task 4: Server APIs and Authorization

**Files:**
- Modify: `src/Code.js`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing API contract checks**

Add static checks for `createOrder`, `cancelOrder`, `listMemberOrders`,
`rebuildMemberPoints`, `getMyOrders`, and `reconcileAllMemberPoints`.
Evaluate `Code.js` in a VM with stubbed `withAdmin` and `withMemberSession_` to assert
admin mutations pass the authenticated email and `getMyOrders` ignores any client
memberId in favor of the session member.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/static.test.js`

Expected: FAIL because the new API functions do not exist.

- [ ] **Step 3: Implement safe mappers and API wrappers**

Add:

```js
function getOrderService() {
  return createOrderService(createSheetRepository());
}
function safeOrder_(order) {
  return {
    orderId: order.orderId,
    memberId: order.memberId,
    memberName: order.memberName,
    orderDate: order.orderDate,
    amount: Number(order.amount) || 0,
    note: order.note || "",
    status: order.status,
    createdAt: order.createdAt,
    createdBy: order.createdBy,
    cancelledAt: order.cancelledAt || "",
    cancelledBy: order.cancelledBy || "",
    cancellationReason: order.cancellationReason || ""
  };
}
```

Wrap all admin APIs with `withAdmin()`. Implement `getMyOrders(payload)` through
`withMemberSession_(token, false, ...)` so a temporary PIN must be changed first,
and always use `member.memberId`. Extend
`getMemberAccount()` with benefits from `getTierBenefits(member.tier)`.
The time trigger entry point calls reconciliation with actor `"SYSTEM"`.

- [ ] **Step 4: Run all tests and commit**

Run: `npm.cmd test`

Expected: all tests pass.

```powershell
git add src/Code.js tests/static.test.js
git commit -m "feat: expose points order APIs"
```

### Task 5: Admin Order Management UI

**Files:**
- Modify: `src/Admin.html`
- Modify: `src/AdminScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing static UI checks**

Assert required IDs exist: `memberPoints`, `memberTier`, `memberLastOrder`,
`orderForm`, `orderDate`, `orderAmount`, `orderNote`, `orderRows`,
`orderPreviousButton`, `orderNextButton`, `cancelOrderModal`,
`cancelOrderReason`, and `confirmCancelOrderButton`. Assert scripts still contain
no `innerHTML`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/static.test.js`

Expected: FAIL because the order controls are absent.

- [ ] **Step 3: Add accessible admin markup and styles**

After the existing `editForm` and before the member modal section closes, add a
sibling order-management section containing a summary grid, `orderForm`, order
table, empty/loading states, and pagination. This avoids invalid nested forms.
Add a separate cancellation dialog sibling to the member modal with a labelled
reason textarea and Cancel/Confirm buttons. Use responsive table scrolling and
stack the form controls below 720px.

- [ ] **Step 4: Implement admin interactions**

Extend state with `orderPage`, `orderTotalPages`, `ordersLoading`, and
`selectedOrderId`. Implement:

```js
loadMemberOrders()
renderMemberSummary(member)
renderOrders(result)
submitOrder()
openCancelOrderDialog(orderId, trigger)
confirmCancelOrder()
closeCancelOrderDialog()
```

Use `replaceChildren`, `createElement`, and `textContent`. Disable create/cancel
buttons while requests run. After mutations call `getMember` and
`listMemberOrders` again so the UI displays server-authoritative summary values.
Add messages for `ORDER_ALREADY_CANCELLED` and `MEMBER_SUSPENDED`.

- [ ] **Step 5: Run tests and manually inspect syntax**

Run: `npm.cmd test`

Expected: all tests pass, including no-`innerHTML` checks.

- [ ] **Step 6: Commit**

```powershell
git add src/Admin.html src/AdminScript.html src/Styles.html tests/static.test.js
git commit -m "feat: manage member orders in admin"
```

### Task 6: Member Points and Order History UI

**Files:**
- Modify: `src/Member.html`
- Modify: `src/MemberScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing member UI checks**

Assert IDs exist for `accountPoints`, `accountTier`, `tierBenefits`,
`tierProgress`, `tierProgressText`, `accountLastOrder`, `myOrderRows`,
`myOrderPreviousButton`, and `myOrderNextButton`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/static.test.js`

Expected: FAIL because the member points UI is absent.

- [ ] **Step 3: Add the points dashboard and history markup**

Add a prominent points card, Tier badge, benefit list, labelled native progress
element, latest order date, responsive order table, empty state, and pagination.
Keep profile and PIN forms unchanged.

- [ ] **Step 4: Render safe account data and paginated orders**

Extend `renderAccount()` to format points with Thai locale, render benefits by
creating `li` nodes, and calculate progress:

- Silver: current points / 30,000
- Gold: `(points - 30,000) / 70,000`
- Platinum: 100% and text `ระดับสูงสุด`

Implement `loadMyOrders(page)` using the session token. Render ACTIVE and CANCELLED
badges; cancelled amounts remain visible but include text that they are not counted.
Call history loading only after a valid account response and clear it on logout.

- [ ] **Step 5: Run all tests and commit**

Run: `npm.cmd test`

Expected: all tests pass.

```powershell
git add src/Member.html src/MemberScript.html src/Styles.html tests/static.test.js
git commit -m "feat: show points in member portal"
```

### Task 7: Reconciliation, Documentation, and Regression

**Files:**
- Modify: `tests/order-service.test.js`
- Modify: `tests/member-service.test.js`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Add failing edge and regression tests**

Add tests for decimal totals avoiding floating drift, cancelling the latest order
moving `lastOrderAt` backward, reconciliation skipping matching members, safe member
responses containing summary but no auth fields, and pagination clamping invalid pages.

- [ ] **Step 2: Run and verify RED where coverage exposes gaps**

Run: `node --test tests/points-core.test.js tests/order-service.test.js tests/member-service.test.js`

Expected: tests either pass because prior tasks already cover the behavior, or fail
with an assertion identifying one of the five listed edge contracts.

- [ ] **Step 3: Correct any exposed edge behavior**

If Step 2 fails, change the implementation so decimal totals are rounded after each
summary, `lastOrderAt` is the maximum ACTIVE `orderDate`, matching reconciliation
performs no member update or audit, public member data excludes `pinHash`, `pinSalt`,
and `sessionVersion`, and invalid pages clamp to the nearest valid page. If Step 2
passes, make no production change. Do not add redemption or order editing.

- [ ] **Step 4: Document operation and deployment**

Update README feature/file lists. In deployment documentation describe:

1. Push source with clasp.
2. Run `bootstrapTncMemberSystem()` as owner.
3. Verify the reconciliation trigger; run `installPointsReconciliationTrigger()`
   directly only if no trigger was created.
4. Verify Orders and new Members columns.
5. Create a new Apps Script deployment version for public and admin URLs.
6. Test one order, cancellation, Tier downgrade, and member visibility.

- [ ] **Step 5: Run full verification**

Run: `npm.cmd test`

Expected: all tests pass with zero failures.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git add src tests README.md docs/DEPLOYMENT.md
git commit -m "test: verify member points workflows"
```

### Task 8: Deploy and Production Smoke Test

**Files:**
- No source changes expected

- [ ] **Step 1: Confirm clean source and tests**

Run: `git status --short`

Expected: no output.

Run: `npm.cmd test`

Expected: all tests pass.

- [ ] **Step 2: Push Apps Script source**

Run: `clasp.cmd push`

Expected: all `src` files are pushed without errors.

- [ ] **Step 3: Run migration and install trigger**

From the Apps Script editor, run `bootstrapTncMemberSystem()` and authorize it.
Then inspect the spreadsheet for `Orders`, the three appended Members columns, and
both sequence settings. Inspect Apps Script Triggers and confirm exactly one daily
`reconcileAllMemberPoints` trigger.

- [ ] **Step 4: Create deployment versions**

Create new versions for the public deployment (execute as owner) and admin deployment
(execute as accessing user), preserving their existing access settings.

- [ ] **Step 5: Smoke test with a disposable order**

Using an active test member:

1. Add a 30,000-baht order and confirm Gold/30,000 in Admin.
2. Log in as the member and confirm points, benefits, progress, and order history.
3. Cancel the order with a reason and confirm Silver/0 in both views.
4. Confirm Orders keeps the CANCELLED row and AuditLog has both actions.
5. Confirm registration, login, profile update, status change, and temporary PIN still work.

- [ ] **Step 6: Publish repository changes**

Run:

```powershell
git push origin main
```

Expected: remote `main` contains all implementation commits.
