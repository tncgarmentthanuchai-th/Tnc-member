const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

function loadSource(filename, context = {}) {
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(sourceDirectory, filename), "utf8"),
    context
  );
  return context;
}

test("all server JavaScript files have valid syntax", () => {
  const files = fs.readdirSync(sourceDirectory)
    .filter((file) => file.endsWith(".js"));

  files.forEach((file) => {
    const source = fs.readFileSync(path.join(sourceDirectory, file), "utf8");
    assert.doesNotThrow(
      () => new Function(source),
      `${file} should contain valid JavaScript`
    );
  });
});

test("client scripts have valid syntax and do not use innerHTML", () => {
  ["PublicScript.html", "AdminScript.html", "MemberScript.html"].forEach((file) => {
    const html = fs.readFileSync(path.join(sourceDirectory, file), "utf8");
    const script = html.replace(/^\s*<script>\s*/, "").replace(/\s*<\/script>\s*$/, "");

    assert.doesNotThrow(
      () => new Function(script),
      `${file} should contain valid JavaScript`
    );
    assert.equal(
      script.includes("innerHTML"),
      false,
      `${file} must use safe DOM APIs for user data`
    );
  });
});

test("Apps Script manifest uses the required minimal scopes", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(sourceDirectory, "appsscript.json"), "utf8")
  );

  assert.deepEqual(manifest.oauthScopes, [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]);
  assert.deepEqual(manifest.webapp, {
    access: "ANYONE_ANONYMOUS",
    executeAs: "USER_DEPLOYING"
  });
});

test("member and order schemas match version 3 contracts", () => {
  const repositorySource = fs.readFileSync(
    path.join(sourceDirectory, "SheetRepository.js"),
    "utf8"
  );
  const setupSource = fs.readFileSync(path.join(sourceDirectory, "Setup.js"), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(repositorySource, context);

  const memberHeaders = vm.runInContext("MEMBER_HEADERS", context);
  const orderHeaders = vm.runInContext("ORDER_HEADERS", context);
  assert.deepEqual(Array.from(memberHeaders).slice(-3), [
    "points",
    "tier",
    "lastOrderAt"
  ]);
  assert.deepEqual(Array.from(orderHeaders), [
    "orderId",
    "memberId",
    "memberName",
    "orderDate",
    "amount",
    "note",
    "status",
    "createdAt",
    "createdBy",
    "cancelledAt",
    "cancelledBy",
    "cancellationReason"
  ]);
  assert.match(setupSource, /SYSTEM_SCHEMA_VERSION"\s*,\s*"3"/);
  assert.match(setupSource, /===\s*"3"/);
});

test("setup provisions Orders, both sequences, and blank-only member summaries", () => {
  const setupSource = fs.readFileSync(path.join(sourceDirectory, "Setup.js"), "utf8");

  assert.match(setupSource, /ensureSheet\(spreadsheet,\s*"Orders",\s*ORDER_HEADERS\)/);
  assert.match(setupSource, /LAST_MEMBER_SEQUENCE/);
  assert.match(setupSource, /LAST_ORDER_SEQUENCE/);
  assert.match(setupSource, /setNumberFormat\("#,##0\.00"\)/);
  assert.match(setupSource, /fillBlankMemberSummaries/);
  assert.match(setupSource, /members\.autoResizeColumns\(1,\s*MEMBER_HEADERS\.length\)/);
  assert.match(setupSource, /sheets:\s*\["Members",\s*"AuditLog",\s*"Settings",\s*"Orders"\]/);
});

test("fillBlankMemberSummaries batches blank points and tiers without overwriting formulas", () => {
  const writes = [];
  const rangeListCalls = [];
  const values = [
    ["", "", ""],
    [125, "Gold", "2026-06-01"],
    ["", "", ""]
  ];
  const formulas = [
    ["", "", ""],
    ["", "", ""],
    ['=SUM(A1:A2)', '="Silver"', '=""']
  ];
  const members = {
    getLastRow() {
      return 4;
    },
    getRange(row, column, rowCount, columnCount) {
      assert.equal(row, 2);
      assert.equal(column, 3);
      assert.equal(rowCount, 3);
      assert.equal(columnCount, 3);
      return {
        getValues() {
          return values;
        },
        getFormulas() {
          return formulas;
        },
      };
    },
    getRangeList(addresses) {
      rangeListCalls.push(Array.from(addresses));
      return {
        setValue(value) {
          writes.push({ addresses: Array.from(addresses), value });
        }
      };
    }
  };
  const context = loadSource("Setup.js", {
    MEMBER_HEADERS: ["memberId", "fullname", "points", "tier", "lastOrderAt"]
  });

  context.fillBlankMemberSummaries(members);

  assert.deepEqual(writes, [
    { addresses: ["C2"], value: 0 },
    { addresses: ["D2"], value: "Silver" }
  ]);
  assert.deepEqual(rangeListCalls, [["C2"], ["D2"]]);
  assert.ok(rangeListCalls.length <= 2);
});

test("ensureSetting adds a missing key once and preserves an existing value", () => {
  const appended = [];
  const settings = {
    getDataRange() {
      return {
        getValues() {
          return [
            ["key", "value"],
            ["EXISTING", 99]
          ].concat(appended);
        }
      };
    },
    appendRow(row) {
      appended.push(row);
    }
  };
  const context = loadSource("Setup.js");

  context.ensureSetting(settings, "EXISTING", 0);
  context.ensureSetting(settings, "MISSING", 7);
  context.ensureSetting(settings, "MISSING", 7);

  assert.deepEqual(
    Array.from(appended, (row) => Array.from(row)),
    [["MISSING", 7]]
  );
});

test("ensureSheet freezes the header and extends an existing schema", () => {
  const calls = [];
  const sheet = {
    getLastRow() {
      return 2;
    },
    getLastColumn() {
      return 2;
    },
    getRange(row, column, rowCount, columnCount) {
      calls.push(["getRange", row, column, rowCount, columnCount]);
      if (row === 1 && column === 1 && columnCount === 2) {
        return {
          getValues() {
            return [["id", "name"]];
          }
        };
      }
      return {
        setValues(value) {
          calls.push(["setValues", value]);
          return this;
        },
        setBackground(value) {
          calls.push(["setBackground", value]);
          return this;
        },
        setFontColor(value) {
          calls.push(["setFontColor", value]);
          return this;
        },
        setFontWeight(value) {
          calls.push(["setFontWeight", value]);
          return this;
        }
      };
    },
    setFrozenRows(count) {
      calls.push(["setFrozenRows", count]);
    }
  };
  const spreadsheet = {
    getSheetByName(name) {
      assert.equal(name, "Members");
      return sheet;
    },
    insertSheet() {
      assert.fail("existing sheet should be reused");
    }
  };
  const context = loadSource("Setup.js");

  assert.equal(
    context.ensureSheet(spreadsheet, "Members", ["id", "name", "points"]),
    sheet
  );
  assert.ok(calls.some((call) =>
    call[0] === "setValues" && call[1][0][0] === "points"
  ));
  assert.ok(calls.some((call) =>
    call[0] === "setFrozenRows" && call[1] === 1
  ));
});

test("reconciliation trigger is installed manually by bootstrap only", () => {
  const setupSource = fs.readFileSync(path.join(sourceDirectory, "Setup.js"), "utf8");
  const setupBody = setupSource.match(
    /function setupTncMemberSystem\(\)\s*\{([\s\S]*?)\n\}/
  )[1];
  const readyBody = setupSource.match(
    /function ensureSystemReady_\(\)\s*\{([\s\S]*?)\n\}/
  )[1];
  const bootstrapBody = setupSource.match(
    /function bootstrapTncMemberSystem\(\)\s*\{([\s\S]*?)\n\}/
  )[1];

  assert.match(setupSource, /function installPointsReconciliationTrigger\(\)/);
  assert.match(setupSource, /getHandlerFunction\(\)\s*===\s*"reconcileAllMemberPoints_"/);
  assert.match(setupSource, /\.timeBased\(\)\s*\.everyDays\(1\)/);
  assert.doesNotMatch(setupBody, /installPointsReconciliationTrigger/);
  assert.doesNotMatch(readyBody, /installPointsReconciliationTrigger/);
  assert.doesNotMatch(setupBody, /reconcileAllMemberPoints_?\s*\(/);
  assert.doesNotMatch(readyBody, /reconcileAllMemberPoints_?\s*\(/);
  assert.match(bootstrapBody, /setupTncMemberSystem\(\)/);
  assert.match(bootstrapBody, /installPointsReconciliationTrigger\(\)/);
});

function createScriptProperties(values = {}) {
  return {
    values: { ...values },
    getProperty(key) {
      return this.values[key] || "";
    },
    setProperty(key, value) {
      this.values[key] = value;
    }
  };
}

function createSetupAuthorizationContext(activeEmail, properties, extra = {}) {
  return loadSource("Setup.js", {
    Session: {
      getActiveUser() {
        return {
          getEmail: () => typeof activeEmail === "function"
            ? activeEmail()
            : activeEmail
        };
      },
      getEffectiveUser() {
        return {
          getEmail: () => properties.getProperty("SETUP_OWNER_EMAIL") ||
            (typeof activeEmail === "function" ? activeEmail() : activeEmail)
        };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return properties;
      }
    },
    ...extra
  });
}

test("setup owner guard denies a missing SETUP_OWNER_EMAIL property", () => {
  const context = createSetupAuthorizationContext(
    "owner@example.com",
    createScriptProperties()
  );

  assert.throws(() => context.assertInteractiveScriptOwner_(), /unauthorized setup/i);
});

test("setup owner guard denies a blank active user including public anonymous access", () => {
  ["", "   ", null].forEach((activeEmail) => {
    const context = createSetupAuthorizationContext(
      activeEmail,
      createScriptProperties({ SETUP_OWNER_EMAIL: "owner@example.com" })
    );

    assert.throws(() => context.assertInteractiveScriptOwner_(), /unauthorized setup/i);
  });
});

test("bootstrap and trigger installation deny a different editor", () => {
  const properties = createScriptProperties({
    SETUP_OWNER_EMAIL: "owner@example.com"
  });
  const context = createSetupAuthorizationContext(
    "other@example.com",
    properties,
    {
      LockService: {
        getScriptLock() {
          return { waitLock() {}, releaseLock() {} };
        }
      },
      ScriptApp: {
        getProjectTriggers() {
          return [];
        }
      }
    }
  );
  context.getMemberSessionSecret_ = () => "secret";
  context.setupTncMemberSystem = () => ({ ok: true });

  assert.throws(() => context.bootstrapTncMemberSystem(), /unauthorized setup/i);
  assert.throws(
    () => context.installPointsReconciliationTrigger(),
    /unauthorized setup/i
  );
});

test("setup owner guard allows a trimmed case-insensitive owner match", () => {
  const context = createSetupAuthorizationContext(
    "  Owner@Example.COM ",
    createScriptProperties({
      SETUP_OWNER_EMAIL: " owner@example.com "
    })
  );

  assert.equal(context.assertInteractiveScriptOwner_(), "owner@example.com");
});

test("bootstrap seeds ADMIN_EMAILS only after a valid owner check", () => {
  let activeEmail = "other@example.com";
  const calls = [];
  const properties = createScriptProperties({
    SETUP_OWNER_EMAIL: " Owner@Example.com "
  });
  const context = createSetupAuthorizationContext(
    () => activeEmail,
    properties
  );
  context.getMemberSessionSecret_ = () => calls.push("secret");
  context.setupTncMemberSystem = () => {
    calls.push("setup");
    return { ok: true };
  };
  context.installPointsReconciliationTrigger = () => calls.push("trigger");

  assert.throws(() => context.bootstrapTncMemberSystem(), /unauthorized setup/i);
  assert.equal(properties.values.ADMIN_EMAILS, undefined);
  assert.deepEqual(calls, []);

  activeEmail = "OWNER@example.COM";
  assert.deepEqual(context.bootstrapTncMemberSystem(), { ok: true });
  assert.equal(properties.values.ADMIN_EMAILS, "owner@example.com");
  assert.deepEqual(calls, ["secret", "setup", "trigger"]);
});

test("bootstrap preserves an existing ADMIN_EMAILS value for a valid owner", () => {
  const properties = createScriptProperties({
    SETUP_OWNER_EMAIL: "owner@example.com",
    ADMIN_EMAILS: "admin@example.com"
  });
  const context = createSetupAuthorizationContext(
    "owner@example.com",
    properties
  );
  context.getMemberSessionSecret_ = () => {};
  context.setupTncMemberSystem = () => ({ ok: true });
  context.installPointsReconciliationTrigger = () => {};

  assert.deepEqual(context.bootstrapTncMemberSystem(), { ok: true });
  assert.equal(properties.values.ADMIN_EMAILS, "admin@example.com");
});

function runTriggerInstaller(triggers) {
  const deleted = [];
  const created = [];
  const lockCalls = [];
  const builder = {
    timeBased() {
      created.push("timeBased");
      return this;
    },
    everyDays(days) {
      created.push(["everyDays", days]);
      return this;
    },
    create() {
      created.push("create");
      return { id: "new" };
    }
  };
  const context = createSetupAuthorizationContext(
    "owner@example.com",
    createScriptProperties({ SETUP_OWNER_EMAIL: "owner@example.com" }),
    {
      LockService: {
        getScriptLock() {
          return {
            waitLock(milliseconds) {
              lockCalls.push(["waitLock", milliseconds]);
            },
            releaseLock() {
              lockCalls.push(["releaseLock"]);
            }
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() {
          return triggers;
        },
        deleteTrigger(trigger) {
          deleted.push(trigger.id);
        },
        newTrigger(handler) {
          created.push(["newTrigger", handler]);
          return builder;
        }
      }
    }
  );

  context.installPointsReconciliationTrigger();
  return { deleted, created, lockCalls };
}

test("trigger installer retains a sole valid trigger and preserves unrelated triggers", () => {
  const result = runTriggerInstaller([
    { id: "valid", getHandlerFunction: () => "reconcileAllMemberPoints_" },
    { id: "unrelated", getHandlerFunction: () => "sendDigest" }
  ]);

  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.lockCalls, [
    ["waitLock", 30000],
    ["releaseLock"]
  ]);
});

test("trigger installer retains one valid trigger and deletes only duplicates", () => {
  const result = runTriggerInstaller([
    { id: "first", getHandlerFunction: () => "reconcileAllMemberPoints_" },
    { id: "unrelated", getHandlerFunction: () => "sendDigest" },
    { id: "second", getHandlerFunction: () => "reconcileAllMemberPoints_" }
  ]);

  assert.deepEqual(result.deleted, ["second"]);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.lockCalls, [
    ["waitLock", 30000],
    ["releaseLock"]
  ]);
});

test("trigger installer creates a daily trigger when none exists", () => {
  const result = runTriggerInstaller([
    { id: "unrelated", getHandlerFunction: () => "sendDigest" }
  ]);

  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.created, [
    ["newTrigger", "reconcileAllMemberPoints_"],
    "timeBased",
    ["everyDays", 1],
    "create"
  ]);
  assert.deepEqual(result.lockCalls, [
    ["waitLock", 30000],
    ["releaseLock"]
  ]);
});

test("Orders amount formatting inserts row 2 when the sheet has only a header", () => {
  const calls = [];
  const orders = {
    getMaxRows() {
      return 1;
    },
    insertRowsAfter(afterPosition, howMany) {
      calls.push(["insertRowsAfter", afterPosition, howMany]);
    },
    getRange(row, column, rowCount, columnCount) {
      calls.push(["getRange", row, column, rowCount, columnCount]);
      return {
        setNumberFormat(format) {
          calls.push(["setNumberFormat", format]);
        }
      };
    }
  };
  const context = loadSource("Setup.js");

  context.formatOrdersAmountColumn_(orders);

  assert.deepEqual(calls, [
    ["insertRowsAfter", 1, 1],
    ["getRange", 2, 5, 1, 1],
    ["setNumberFormat", "#,##0.00"]
  ]);
});

test("safeAdminMember_ includes summary defaults without authentication fields", () => {
  const context = loadSource("Code.js");
  const safe = context.safeAdminMember_({
    memberId: "TNC-0001",
    fullname: "Member",
    phone: "0812345678",
    pinHash: "secret",
    pinSalt: "salt",
    sessionVersion: 8,
    mustChangePin: true
  });

  assert.equal(safe.points, 0);
  assert.equal(safe.tier, "Silver");
  assert.equal(safe.lastOrderAt, "");
  assert.equal(safe.hasPin, true);
  assert.equal(safe.mustChangePin, true);
  assert.equal("pinHash" in safe, false);
  assert.equal("pinSalt" in safe, false);
  assert.equal("sessionVersion" in safe, false);
});

test("safeAdminMember_ normalizes non-finite points to zero", () => {
  const context = loadSource("Code.js");

  [NaN, Infinity, -Infinity, "not-a-number"].forEach((points) => {
    assert.equal(context.safeAdminMember_({ points }).points, 0);
  });
  assert.equal(context.safeAdminMember_({ points: "125.5" }).points, 125.5);
});

test("MemberService Apps Script core adapter exposes phone normalization", () => {
  const coreSource = fs.readFileSync(path.join(sourceDirectory, "Core.js"), "utf8");
  const serviceSource = fs.readFileSync(
    path.join(sourceDirectory, "MemberService.js"),
    "utf8"
  );
  const context = {};
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  vm.runInContext(serviceSource, context);

  const adapter = vm.runInContext("getTncCore()", context);
  assert.equal(typeof adapter.normalizePhone, "function");
});

test("order admin APIs pass the authenticated actor to the service", () => {
  const context = loadSource("Code.js");
  const calls = [];
  context.withAdmin = (callback) => callback("admin@example.com");
  context.getOrderService = () => ({
    createOrder(payload, actor) {
      calls.push(["create", payload, actor]);
      return { ok: true };
    },
    cancelOrder(payload, actor) {
      calls.push(["cancel", payload, actor]);
      return { ok: true };
    },
    listMemberOrders(memberId, query) {
      calls.push(["list", memberId, query]);
      return { ok: true, items: [] };
    },
    rebuildMemberPoints(memberId, actor) {
      calls.push(["rebuild", memberId, actor]);
      return { ok: true };
    }
  });

  context.createOrder({ memberId: "TNC-000001" });
  context.cancelOrder({ orderId: "ORD-000001" });
  context.listMemberOrders({ memberId: "TNC-000001", page: 2 });
  context.rebuildMemberPoints("TNC-000001");

  assert.deepEqual(calls, [
    ["create", { memberId: "TNC-000001" }, "admin@example.com"],
    ["cancel", { orderId: "ORD-000001" }, "admin@example.com"],
    ["list", "TNC-000001", { memberId: "TNC-000001", page: 2 }],
    ["rebuild", "TNC-000001", "admin@example.com"]
  ]);
});

test("member order history uses the session member and requires changed PIN", () => {
  const context = loadSource("Code.js");
  const captured = {};
  context.withMemberSession_ = (token, allowMustChangePin, callback) => {
    captured.token = token;
    captured.allowMustChangePin = allowMustChangePin;
    return callback({ memberId: "TNC-000001" });
  };
  context.getOrderService = () => ({
    listMemberOrders(memberId, query) {
      captured.memberId = memberId;
      captured.query = query;
      return { ok: true, items: [] };
    }
  });

  const result = context.getMyOrders({
    token: "signed-token",
    memberId: "TNC-999999",
    page: 2,
    pageSize: 10
  });

  assert.equal(result.ok, true);
  assert.equal(captured.token, "signed-token");
  assert.equal(captured.allowMustChangePin, false);
  assert.equal(captured.memberId, "TNC-000001");
  assert.equal(captured.query.page, 2);
  assert.equal(captured.query.pageSize, 10);
  assert.equal("memberId" in captured.query, false);
});

test("member account includes tier benefits and reconciliation uses SYSTEM actor", () => {
  const context = loadSource("Code.js");
  let reconcileActor = "";
  context.withMemberSession_ = (token, allowMustChangePin, callback) => callback({
    memberId: "TNC-000001",
    tier: "Gold",
    mustChangePin: false
  });
  context.getService = () => ({
    publicMember(member) {
      return { memberId: member.memberId, tier: member.tier };
    }
  });
  context.getTierBenefits = (tier) => ({ tier, discount: 8 });
  context.getOrderService = () => ({
    reconcileAllMemberPoints(actor) {
      reconcileActor = actor;
      return { ok: true, updated: 0 };
    }
  });

  const account = context.getMemberAccount("token");
  const reconciliation = context.reconcileAllMemberPoints_();

  assert.deepEqual(account.benefits, { tier: "Gold", discount: 8 });
  assert.equal(reconciliation.ok, true);
  assert.equal(reconcileActor, "SYSTEM");
});

test("admin page contains accessible order management controls", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Admin.html"), "utf8");
  [
    "memberPoints",
    "memberTier",
    "memberLastOrder",
    "orderForm",
    "orderDate",
    "orderAmount",
    "orderNote",
    "orderRows",
    "orderPreviousButton",
    "orderNextButton",
    "cancelOrderModal",
    "cancelOrderReason",
    "confirmCancelOrderButton"
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  });
  const editForm = html.match(/<form[^>]*id="editForm"[\s\S]*?<\/form>/);
  assert.ok(editForm, "missing #editForm");
  assert.equal(
    editForm[0].includes('id="orderForm"'),
    false,
    "orderForm must not be nested inside editForm"
  );
});

test("member page contains points dashboard and order history controls", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");
  [
    "accountPoints",
    "accountTier",
    "tierBenefits",
    "tierProgress",
    "tierProgressText",
    "accountLastOrder",
    "myOrderRows",
    "myOrderPreviousButton",
    "myOrderNextButton"
  ].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  });
  assert.match(
    html,
    /<progress[^>]*id="tierProgress"[^>]*>/,
    "tier progress must use a native progress element"
  );
});

function createMemberLoginHarness() {
  const elements = new Map();
  const serverCalls = [];
  let successHandler = () => {};
  let failureHandler = () => {};
  let renderAccount = () => {};

  function createClassList() {
    const classes = new Set();
    return {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) {
          classes.add(name);
          return true;
        }
        classes.delete(name);
        return false;
      }
    };
  }

  function getElement(id) {
    if (!elements.has(id)) {
      const listeners = {};
      elements.set(id, {
        id,
        value: "",
        textContent: "",
        className: "",
        classList: createClassList(),
        disabled: false,
        hidden: false,
        listeners,
        addEventListener(type, handler) {
          listeners[type] = handler;
        },
        appendChild() {},
        replaceChildren() {},
        reset() {},
        focus() {},
        setAttribute(name, value) {
          if (name === "aria-invalid") {
            this.ariaInvalid = value;
          }
        }
      });
    }
    return elements.get(id);
  }

  const scriptRun = {
    withSuccessHandler(handler) {
      successHandler = handler;
      return this;
    },
    withFailureHandler(handler) {
      failureHandler = handler;
      return this;
    },
    loginMember(payload) {
      serverCalls.push({ name: "loginMember", payload });
      successHandler({ ok: false });
    }
  };
  const storage = new Map();
  const context = {
    console,
    Intl,
    Promise,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    document: {
      body: { classList: createClassList() },
      getElementById: getElement,
      createElement() {
        return getElement(`created-${elements.size}`);
      }
    },
    google: {
      script: {
        run: scriptRun
      }
    },
    captureRenderAccount(handler) {
      renderAccount = handler;
    }
  };
  const html = fs.readFileSync(
    path.join(sourceDirectory, "MemberScript.html"),
    "utf8"
  );
  const script = html
    .replace(/^\s*<script>\s*/, "")
    .replace(/\s*<\/script>\s*$/, "")
    .replace("    loadAccount();", "    captureRenderAccount(renderAccount);\n    loadAccount();");
  vm.createContext(context);
  vm.runInContext(script, context);

  return {
    elements,
    getElement,
    renderAccount(result) {
      renderAccount(result);
    },
    serverCalls,
    failureHandler,
    async submit() {
      await getElement("loginForm").listeners.submit({
        preventDefault() {}
      });
    }
  };
}

test("member rewards card uses normalized tier themes and defaults to Silver", () => {
  const cases = [
    [" silver ", "Silver", "rewards-tier-silver"],
    ["GOLD", "Gold", "rewards-tier-gold"],
    ["platinum", "Platinum", "rewards-tier-platinum"],
    ["Diamond", "Silver", "rewards-tier-silver"],
    [null, "Silver", "rewards-tier-silver"]
  ];

  cases.forEach(([inputTier, expectedTier, expectedClass]) => {
    const harness = createMemberLoginHarness();
    const member = {
      memberId: "TNC-000001",
      fullname: "Member",
      phone: "0812345678",
      status: "Active",
      points: 50000,
      tier: inputTier,
      lastOrderAt: "",
      orgType: "",
      orgName: ""
    };

    harness.renderAccount({
      member,
      benefits: {},
      mustChangePin: false
    });

    assert.equal(harness.getElement("accountTier").textContent, expectedTier);
    assert.equal(
      harness.getElement("accountTier").className,
      `tier-badge tier-${expectedTier.toLowerCase()}`
    );
    assert.equal(
      harness.getElement("rewardsSection").className,
      `rewards-section ${expectedClass}`
    );
  });
});

test("member rewards tier themes provide distinct readable card treatments", () => {
  const styles = fs.readFileSync(path.join(sourceDirectory, "Styles.html"), "utf8");

  assert.match(
    styles,
    /\.rewards-tier-silver\s*\{[^}]*background:[^}]*var\(--navy\)[^}]*border:[^}]*silver[^}]*box-shadow:/i
  );
  assert.match(
    styles,
    /\.rewards-tier-gold\s*\{[^}]*background:[^}]*var\(--navy\)[^}]*border:[^}]*gold[^}]*box-shadow:/i
  );
  assert.match(
    styles,
    /\.rewards-tier-platinum\s*\{[^}]*background:[^}]*linear-gradient[^}]*indigo[^}]*border:[^}]*gold[^}]*box-shadow:/i
  );
  assert.match(
    styles,
    /@media \(max-width: 520px\)[\s\S]*\.rewards-hero\s*\{\s*flex-direction:\s*column/
  );
});

test("member login uses a fixed Thai country prefix and nine digit input", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");
  const loginPhone = html.match(/<input[^>]*id="loginPhone"[^>]*>/);
  const loginPhoneHelp = html.match(/<p[^>]*id="loginPhoneHelp"[^>]*>[\s\S]*?<\/p>/);
  const profilePhone = html.match(/<input[^>]*id="accountPhone"[^>]*>/);

  assert.match(html, /class="phone-prefix"[^>]*aria-hidden="true"[^>]*>\+66</);
  assert.ok(loginPhone, "missing #loginPhone");
  assert.match(loginPhone[0], /maxlength="9"/);
  assert.match(loginPhone[0], /inputmode="numeric"/);
  assert.match(loginPhone[0], /autocomplete="off"/);
  assert.match(loginPhone[0], /placeholder="81 234 5678"/);
  assert.match(
    loginPhone[0],
    /aria-describedby="loginPhoneHelp loginPhoneError"/
  );
  assert.ok(loginPhoneHelp, "missing #loginPhoneHelp");
  assert.match(loginPhoneHelp[0], /\+66/);
  assert.match(html, /id="loginPhoneError"[^>]*class="field-error"/);
  assert.ok(profilePhone, "missing #accountPhone");
  assert.match(profilePhone[0], /maxlength="14"/);
});

test("member login paste accepts formatted national and domestic phone numbers", () => {
  [
    ["81 234 5678", "812345678"],
    ["081-234-5678", "812345678"]
  ].forEach(([clipboardText, expectedValue]) => {
    const harness = createMemberLoginHarness();
    const phoneInput = harness.getElement("loginPhone");
    let defaultPrevented = false;

    phoneInput.listeners.paste.call(phoneInput, {
      preventDefault() {
        defaultPrevented = true;
      },
      clipboardData: {
        getData(type) {
          assert.equal(type, "text");
          return clipboardText;
        }
      }
    });

    assert.equal(defaultPrevented, true);
    assert.equal(phoneInput.value, expectedValue);
  });
});

test("member login rejects invalid national numbers before calling the server", async () => {
  for (const value of ["12345678", "012345678", "12345678a"]) {
    const harness = createMemberLoginHarness();
    harness.getElement("loginPhone").value = value;
    harness.getElement("loginPin").value = "123456";

    await harness.submit();

    assert.equal(harness.serverCalls.length, 0, `server called for ${value}`);
    assert.match(harness.getElement("loginPhoneError").textContent, /9 หลัก/);
    assert.equal(
      harness.getElement("loginPhoneError").classList.contains("visible"),
      true
    );
    assert.equal(harness.getElement("loginPhone").ariaInvalid, "true");
    assert.equal(harness.getElement("loginButton").disabled, false);
  }
});

test("member login converts and sends a valid national number", async () => {
  const harness = createMemberLoginHarness();
  harness.getElement("loginPhone").value = "81 234 5678";
  harness.getElement("loginPin").value = "123456";

  await harness.submit();

  assert.equal(harness.serverCalls.length, 1);
  assert.equal(harness.serverCalls[0].name, "loginMember");
  assert.equal(harness.serverCalls[0].payload.phone, "0812345678");
  assert.equal(harness.serverCalls[0].payload.pin, "123456");
  assert.equal(harness.getElement("loginPhoneError").textContent, "");
  assert.equal(
    harness.getElement("loginPhoneError").classList.contains("visible"),
    false
  );
  assert.equal(harness.getElement("loginPhone").ariaInvalid, "false");
  assert.equal(harness.getElement("loginButton").disabled, false);
});

test("member login script defines domestic phone conversion without innerHTML", () => {
  const script = fs.readFileSync(
    path.join(sourceDirectory, "MemberScript.html"),
    "utf8"
  );

  assert.match(script, /function toDomesticPhone\(value\)/);
  assert.match(script, /"0" \+ digits/);
  assert.match(script, /phone:\s*domesticPhone/);
  assert.equal(script.includes("innerHTML"), false);
});

test("member login country prefix styles are responsive and accessible", () => {
  const styles = fs.readFileSync(path.join(sourceDirectory, "Styles.html"), "utf8");

  assert.match(styles, /\.phone-input-group/);
  assert.match(styles, /\.phone-prefix/);
  assert.match(styles, /\.field-help/);
  assert.match(styles, /\.phone-input-group:focus-within/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.phone-input-group/);
});
