# Login, Tier Card, and Admin Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปรับหน้า Login สมาชิกให้ใช้ `+66`, เปลี่ยน rewards card ตาม tier และเพิ่มหน้าเข้าสู่ระบบหลังบ้านที่อนุญาตเฉพาะ Google Account ของ TNC

**Architecture:** ใช้ Vanilla HTML/CSS/JS และ Apps Script authorization เดิม เพิ่ม helper ฝั่ง client สำหรับแปลงเบอร์ไทย และแยก routing state ของ admin เป็น blank session, unauthorized และ authorized โดย API หลังบ้านยังตรวจ `withAdmin` ทุกครั้ง

**Tech Stack:** Google Apps Script V8, HtmlService, Session API, Vanilla HTML/CSS/JavaScript, Node.js test runner

---

### Task 1: Member Login With Fixed +66 Prefix

**Files:**
- Modify: `src/Member.html`
- Modify: `src/MemberScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing static and client behavior tests**

เพิ่ม test ใน `tests/static.test.js` ที่ตรวจว่า:

```js
test("member login uses a fixed Thai country prefix and nine digit input", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");
  assert.match(html, /class="phone-prefix"[^>]*>\+66</);
  assert.match(html, /id="loginPhone"[^>]*maxlength="9"/);
  assert.match(html, /id="loginPhoneError"/);
});

test("member login converts a nine digit national number before server call", () => {
  const script = fs.readFileSync(
    path.join(sourceDirectory, "MemberScript.html"),
    "utf8"
  );
  assert.match(script, /function toDomesticPhone/);
  assert.match(script, /"0" \+ digits/);
  assert.match(script, /phone:\s*domesticPhone/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/static.test.js
```

Expected: FAIL because `phone-prefix`, `loginPhoneError` and `toDomesticPhone` do not exist.

- [ ] **Step 3: Add the +66 field and minimal conversion**

ใน `Member.html` เปลี่ยนช่อง Login เท่านั้นเป็น:

```html
<div class="phone-input-group">
  <span class="phone-prefix" aria-hidden="true">+66</span>
  <input id="loginPhone" type="tel" maxlength="9" inputmode="numeric"
    autocomplete="tel-national" placeholder="81 234 5678"
    aria-describedby="loginPhoneHelp loginPhoneError" required>
</div>
<p id="loginPhoneHelp" class="field-help">กรอก 9 หลักโดยไม่ใส่เลข 0 ด้านหน้า</p>
<p id="loginPhoneError" class="field-error"></p>
```

ใน `MemberScript.html` เพิ่ม:

```js
function toDomesticPhone(value) {
  var digits = String(value || "").replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? "0" + digits : "";
}
```

ก่อนเรียก server:

```js
var domesticPhone = toDomesticPhone(
  document.getElementById("loginPhone").value
);
if (!domesticPhone) {
  var phoneError = document.getElementById("loginPhoneError");
  phoneError.textContent = "กรุณากรอกเบอร์โทรศัพท์ 9 หลัก";
  phoneError.classList.add("visible");
  button.disabled = false;
  return;
}
```

ส่ง `phone: domesticPhone` โดยไม่เปลี่ยนฟอร์มสมัครหรือ profile form

- [ ] **Step 4: Style and verify**

เพิ่ม `.phone-input-group`, `.phone-prefix` และ `.field-help` ใน `Styles.html` โดย prefix มีพื้นสี soft, border ร่วมกับ input และ focus state ที่อ่านง่าย

Run:

```powershell
node --test tests/static.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/Member.html src/MemberScript.html src/Styles.html tests/static.test.js
git commit -m "feat: use country code in member login"
```

### Task 2: Tier Styling Across the Whole Rewards Card

**Files:**
- Modify: `src/Member.html`
- Modify: `src/MemberScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing rewards-card tests**

เพิ่ม test:

```js
test("member rewards card supports silver gold and platinum themes", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");
  const script = fs.readFileSync(
    path.join(sourceDirectory, "MemberScript.html"),
    "utf8"
  );
  const styles = fs.readFileSync(path.join(sourceDirectory, "Styles.html"), "utf8");
  assert.match(html, /id="rewardsSection"/);
  assert.match(script, /rewards-tier-/);
  assert.match(styles, /\.rewards-tier-silver/);
  assert.match(styles, /\.rewards-tier-gold/);
  assert.match(styles, /\.rewards-tier-platinum/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/static.test.js
```

Expected: FAIL because card-level tier themes are absent.

- [ ] **Step 3: Apply the tier class during account rendering**

ใน `renderAccount()`:

```js
var rewardsSection = document.getElementById("rewardsSection");
rewardsSection.className =
  "rewards-section rewards-tier-" + tier.toLowerCase();
```

เก็บ badge class เดิมไว้สำหรับข้อความระดับ

- [ ] **Step 4: Add visual themes**

เพิ่ม CSS:

```css
.rewards-tier-silver {
  border: 2px solid #c7ccd6;
  box-shadow: 0 14px 32px rgba(177, 184, 198, 0.2);
}
.rewards-tier-gold {
  border: 2px solid #d8ad42;
  box-shadow: 0 14px 34px rgba(216, 173, 66, 0.28);
}
.rewards-tier-platinum {
  border: 2px solid #e0b84f;
  background: linear-gradient(135deg, #171337, #312e81 54%, #15152b);
  box-shadow: 0 16px 38px rgba(49, 46, 129, 0.34),
    inset 0 0 0 1px rgba(255, 223, 128, 0.2);
}
```

ตรวจ contrast ของ progress panel และ benefits panel บนทั้งสาม theme

- [ ] **Step 5: Run and commit**

```powershell
npm.cmd test
git add src/Member.html src/MemberScript.html src/Styles.html tests/static.test.js
git commit -m "feat: theme member rewards by tier"
```

Expected: all tests pass.

### Task 3: Google Admin Login Gate

**Files:**
- Create: `src/AdminLogin.html`
- Modify: `src/Unauthorized.html`
- Modify: `src/Code.js`
- Modify: `src/Auth.js`
- Modify: `src/Styles.html`
- Modify: `tests/auth.test.js`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing authorization and routing tests**

เพิ่มใน `tests/auth.test.js`:

```js
test("authorizer distinguishes missing Google identity from denied identity", () => {
  const missing = createAuthorizer(() => "", () => "tncgarment.thanuchai@gmail.com");
  const denied = createAuthorizer(
    () => "other@gmail.com",
    () => "tncgarment.thanuchai@gmail.com"
  );
  assert.equal(missing.requireAdmin().code, "LOGIN_REQUIRED");
  assert.equal(denied.requireAdmin().code, ERROR_CODES.UNAUTHORIZED);
});
```

เพิ่ม static test ที่ตรวจ:

```js
assert.equal(fs.existsSync(path.join(sourceDirectory, "AdminLogin.html")), true);
assert.match(codeSource, /renderTemplate\("AdminLogin"/);
assert.match(adminLoginHtml, /tncgarment\.thanuchai@gmail\.com/);
assert.match(adminLoginHtml, /เข้าสู่ระบบด้วย Google/);
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
node --test tests/auth.test.js tests/static.test.js
```

Expected: FAIL because `LOGIN_REQUIRED` and `AdminLogin.html` do not exist.

- [ ] **Step 3: Distinguish blank and denied Google sessions**

ใน `Auth.js`:

```js
if (!email) return { ok: false, code: "LOGIN_REQUIRED" };
if (allowed.indexOf(email) === -1) {
  return { ok: false, code: errorCodes.UNAUTHORIZED };
}
```

ใน `Code.js` routing:

```js
if (!session.ok) {
  return session.code === "LOGIN_REQUIRED"
    ? renderTemplate("AdminLogin", "TNC Garment - เข้าสู่ระบบหลังบ้าน")
    : renderTemplate("Unauthorized", "ไม่มีสิทธิ์เข้าถึง");
}
```

- [ ] **Step 4: Build AdminLogin and denied views**

สร้าง `AdminLogin.html` ด้วย brand, lock icon, allowlisted email และ:

```html
<a class="button button-primary button-block" href="?page=admin">
  เข้าสู่ระบบด้วย Google
</a>
```

หน้า `Unauthorized.html` แสดงอีเมลที่อนุญาตและลิงก์กลับ `?page=admin` โดยไม่มีช่องรับ password

เพิ่ม `.admin-login-page`, `.admin-login-card`, `.google-login-mark` และ responsive styles ใน `Styles.html`

- [ ] **Step 5: Verify API authorization remains enforced**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass, including existing admin API tests.

- [ ] **Step 6: Commit**

```powershell
git add src/AdminLogin.html src/Unauthorized.html src/Code.js src/Auth.js src/Styles.html tests/auth.test.js tests/static.test.js
git commit -m "feat: add Google admin login gate"
```

### Task 4: Deploy, Configure, and Browser Verify

**Files:**
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Document the fixed admin account and member phone format**

เพิ่มคู่มือว่า:

- Member Login รับเลข 9 หลักหลัง `+66`
- `ADMIN_EMAILS` ต้องเป็น `tncgarment.thanuchai@gmail.com`
- Admin deployment ต้อง execute as **User accessing the web app**

- [ ] **Step 2: Run final verification**

```powershell
npm.cmd test
git diff --check
git status --short
```

Expected: zero test failures and no whitespace errors.

- [ ] **Step 3: Push Apps Script source**

```powershell
clasp.cmd push --force
clasp.cmd deploy --deploymentId AKfycbzf83l9-u4E2_fBZTiCjkYsxOS8zTVDxg_wPIF534s4cSf4l4e6gvgxg3-dgjb1UPuJBw --description "TNC Member +66 and tier themes"
clasp.cmd deploy --deploymentId AKfycbzFrjvBGN1bG9HRVCF1lz2fiXGg0_A8nXBrRpo8u3mtAl9vj7A75WDm12Hvbp5aLUv6TQ --description "TNC Admin Google login gate"
```

- [ ] **Step 4: Set and verify Script Property**

ใน Apps Script Project Settings ตั้ง:

```text
ADMIN_EMAILS=tncgarment.thanuchai@gmail.com
```

อย่าใส่อีเมลอื่น

- [ ] **Step 5: Browser smoke test**

ตรวจ:

1. Member Login แสดง `+66`, รับ 9 หลัก และเข้าสู่ระบบด้วยสมาชิกเดิมได้
2. Silver, Gold และ Platinum เปลี่ยน theme ทั้ง rewards card
3. Admin URL แสดง Google authorization/login เมื่อยังไม่ระบุตัวตน
4. บัญชี `tncgarment.thanuchai@gmail.com` เข้า Admin ได้
5. บัญชีอื่นถูกปฏิเสธ
6. Console ไม่มี JavaScript error

- [ ] **Step 6: Commit docs and push GitHub**

```powershell
git add docs/DEPLOYMENT.md
git commit -m "docs: update login deployment guide"
git push origin main
```
