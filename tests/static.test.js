const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceDirectory = path.join(__dirname, "..", "src");

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
    "https://www.googleapis.com/auth/userinfo.email"
  ]);
  assert.deepEqual(manifest.webapp, {
    access: "ANYONE_ANONYMOUS",
    executeAs: "USER_DEPLOYING"
  });
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
