# Member Profile Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มหน้าข้อมูลส่วนตัวแบบอ่านก่อนแก้ไข บันทึกชื่อและข้อมูลองค์กรด้วยปุ่ม และแยกการเปลี่ยนเบอร์ที่ต้องยืนยัน PIN

**Architecture:** ใช้ API `updateMemberAccount(payload)` และ `MemberService.updateOwnProfile()` เดิมเพื่อรักษา session และ audit contract แต่เพิ่ม `operation` เป็น `PROFILE` หรือ `PHONE` เพื่อให้ server บังคับขอบเขตของแต่ละคำขอ Client แยก forms เป็น profile details กับ phone change เก็บสมาชิกเวอร์ชันล่าสุดใน state และฝั่ง server บังคับ PIN พร้อมเพิ่ม `sessionVersion` เฉพาะ `PHONE`

**Tech Stack:** Google Apps Script V8, HtmlService, Vanilla HTML/CSS/JavaScript, Google Sheets repository, Node.js test runner

---

### Task 1: Protect General Profile Updates On The Server

**Files:**
- Modify: `src/MemberService.js`
- Modify: `tests/member-service.test.js`

- [ ] **Step 1: Write failing service tests**

เพิ่ม tests ที่พิสูจน์ว่าข้อมูลทั่วไปอัปเดตได้โดยไม่ใช้ PIN และการพยายามเปลี่ยนเบอร์โดยไม่มี PIN ถูกปฏิเสธ:

```js
test("PROFILE operation updates details without changing phone or session", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const registered = service.register(validPayload);

  const result = service.updateOwnProfile(registered.memberId, {
    fullname: "สมชาย คนใหม่",
    phone: "0812345678",
    orgType: "อื่นๆ",
    orgName: "ร้านใหม่",
    currentPin: "",
    operation: "PROFILE"
  });

  assert.equal(result.ok, true);
  assert.equal(result.phoneChanged, false);
  assert.equal(result.member.fullname, "สมชาย คนใหม่");
  assert.equal(repository.members[0].sessionVersion, 1);
  assert.equal(repository.audits.at(-1).action, "MEMBER_UPDATE");
});

test("PROFILE operation rejects a changed phone even when a PIN is supplied", () => {
  const repository = createMemoryRepository();
  const service = createMemberService(repository);
  const registered = service.register(validPayload);

  const result = service.updateOwnProfile(registered.memberId, {
    ...validPayload,
    phone: "0899999999",
    currentPin: "123456",
    operation: "PROFILE"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_CREDENTIALS");
  assert.equal(repository.members[0].phone, "0812345678");
});
```

Update the existing `changing phone requires current PIN and invalidates sessions` test so both calls include:

```js
operation: "PHONE"
```

- [ ] **Step 2: Run tests and verify RED where behavior is incomplete**

Run:

```powershell
node --test tests/member-service.test.js
```

Expected: FAIL because `updateOwnProfile()` does not enforce `operation`.

- [ ] **Step 3: Make phone comparison explicit**

ใน `updateOwnProfile()` normalize both sides and enforce the operation:

```js
var currentPhone = core.normalizePhone(current.phone);
var nextPhone = core.normalizePhone(validation.value.phone);
var phoneChanged = nextPhone !== currentPhone;
var operation = core.normalizeText(payload && payload.operation).toUpperCase();
if (operation !== "PROFILE" && operation !== "PHONE") {
  return failure(core.ERROR_CODES.VALIDATION_ERROR);
}
if (operation === "PROFILE" && phoneChanged) {
  return failure(core.ERROR_CODES.VALIDATION_ERROR, {
    phone: "ไม่สามารถเปลี่ยนเบอร์ผ่านฟอร์มข้อมูลส่วนตัว"
  });
}
if (operation === "PHONE" && !phoneChanged) {
  return failure(core.ERROR_CODES.VALIDATION_ERROR, {
    phone: "กรุณากรอกเบอร์โทรใหม่"
  });
}
validation.value.phone = nextPhone;
```

Require PIN, duplicate-phone checks, and `sessionVersion` increment only for `operation === "PHONE"`. Keep the existing audit behavior for both operations.

- [ ] **Step 4: Run service tests**

```powershell
node --test tests/member-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/MemberService.js tests/member-service.test.js
git commit -m "fix: secure member profile updates"
```

### Task 2: Build Read-Only Profile Summary And Edit Mode

**Files:**
- Modify: `src/Member.html`
- Modify: `src/MemberScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing structure tests**

เพิ่ม static test:

```js
test("member profile starts read-only and has explicit edit controls", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");

  assert.match(html, /id="profileSummary"/);
  assert.match(html, /id="profileEditButton"/);
  assert.match(html, /id="profileEditForm"[^>]*hidden/);
  assert.match(html, /id="profileCancelButton"/);
  assert.match(html, /id="profileSaveButton"/);
  assert.doesNotMatch(
    html.match(/id="profileEditForm"[\s\S]*?<\/form>/)[0],
    /accountPhone|profileCurrentPin/
  );
});
```

- [ ] **Step 2: Run static test and verify RED**

```powershell
node --test tests/static.test.js
```

Expected: FAIL because the summary/edit controls do not exist.

- [ ] **Step 3: Replace the existing combined profile form**

ใน `Member.html` create:

```html
<section id="profileSection" class="account-section" aria-labelledby="profileTitle">
  <div class="section-heading-actions">
    <h2 id="profileTitle">ข้อมูลส่วนตัว</h2>
    <button id="profileEditButton" class="button button-secondary" type="button">
      แก้ไข
    </button>
  </div>

  <dl id="profileSummary" class="profile-summary">
    <div><dt>ชื่อ-นามสกุล</dt><dd id="profileFullnameValue"></dd></div>
    <div><dt>ประเภทองค์กร</dt><dd id="profileOrgTypeValue"></dd></div>
    <div><dt>ชื่อองค์กร</dt><dd id="profileOrgNameValue"></dd></div>
  </dl>

  <form id="profileEditForm" hidden novalidate>
    <!-- accountFullname, accountOrgType, accountOrgName -->
    <div class="form-actions">
      <button id="profileCancelButton" class="button button-secondary" type="button">
        ยกเลิก
      </button>
      <button id="profileSaveButton" class="button button-primary" type="submit">
        บันทึกข้อมูล
      </button>
    </div>
  </form>
</section>
```

- [ ] **Step 4: Add profile state and mode helpers**

ใน `MemberScript.html` add:

```js
var currentMember = null;

function fillProfile(member) {
  currentMember = Object.assign({}, member);
  document.getElementById("profileFullnameValue").textContent = member.fullname;
  document.getElementById("profileOrgTypeValue").textContent = member.orgType;
  document.getElementById("profileOrgNameValue").textContent = member.orgName;
  document.getElementById("accountFullname").value = member.fullname;
  document.getElementById("accountOrgType").value = member.orgType;
  document.getElementById("accountOrgName").value = member.orgName;
}

function setProfileEditing(editing) {
  document.getElementById("profileSummary").hidden = editing;
  document.getElementById("profileEditForm").hidden = !editing;
  document.getElementById("profileEditButton").hidden = editing;
}
```

Call `fillProfile(member)` from `renderAccount()`. Edit opens the form. Cancel calls `fillProfile(currentMember)` and closes edit mode without calling the server.

- [ ] **Step 5: Save only general profile fields**

Submit:

```js
var result = await callServer("updateMemberAccount", {
  token: token,
  fullname: document.getElementById("accountFullname").value.trim(),
  phone: currentMember.phone,
  orgType: document.getElementById("accountOrgType").value,
  orgName: document.getElementById("accountOrgName").value.trim(),
  currentPin: "",
  operation: "PROFILE"
});
```

On success call `fillProfile(result.member)`, update greeting, close edit mode, and announce `บันทึกข้อมูลแล้ว`. During the request disable `profileSaveButton`; restore it in `finally`. On error leave the form and entered values visible.

- [ ] **Step 6: Add responsive styles**

Add `.section-heading-actions`, `.profile-summary`, `.profile-summary dt`, `.profile-summary dd`, and `.form-actions`. On screens below `520px`, stack `.form-actions` and make buttons full width.

- [ ] **Step 7: Run tests and commit**

```powershell
npm.cmd test
git add src/Member.html src/MemberScript.html src/Styles.html tests/static.test.js
git commit -m "feat: add editable member profile summary"
```

Expected: all tests pass.

### Task 3: Separate And Secure Phone Change Flow

**Files:**
- Modify: `src/Member.html`
- Modify: `src/MemberScript.html`
- Modify: `src/Styles.html`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Write failing phone-flow tests**

Add:

```js
test("member phone change is isolated from general profile editing", () => {
  const html = fs.readFileSync(path.join(sourceDirectory, "Member.html"), "utf8");
  const phoneForm = html.match(/<form[^>]*id="phoneChangeForm"[\s\S]*?<\/form>/);

  assert.match(html, /id="currentPhoneValue"/);
  assert.match(html, /id="phoneChangeButton"/);
  assert.ok(phoneForm);
  assert.match(phoneForm[0], /id="newPhone"/);
  assert.match(phoneForm[0], /id="phoneCurrentPin"/);
  assert.match(phoneForm[0], /id="phoneChangeCancelButton"/);
  assert.match(phoneForm[0], /ยืนยันเปลี่ยนเบอร์/);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/static.test.js
```

Expected: FAIL because the dedicated phone controls do not exist.

- [ ] **Step 3: Add the phone summary and hidden form**

Below the general profile:

```html
<section id="phoneSection" class="account-section" aria-labelledby="phoneTitle">
  <div class="section-heading-actions">
    <div>
      <h2 id="phoneTitle">เบอร์โทรศัพท์</h2>
      <p id="currentPhoneValue" class="profile-primary-value"></p>
    </div>
    <button id="phoneChangeButton" class="button button-secondary" type="button">
      เปลี่ยนเบอร์โทร
    </button>
  </div>
  <form id="phoneChangeForm" hidden novalidate>
    <div class="field">
      <label for="newPhone">เบอร์โทรใหม่</label>
      <input id="newPhone" type="tel" maxlength="14" inputmode="numeric" required>
    </div>
    <div class="field">
      <label for="phoneCurrentPin">PIN ปัจจุบัน</label>
      <input id="phoneCurrentPin" type="password" maxlength="6"
        inputmode="numeric" autocomplete="current-password" required>
    </div>
    <div class="form-actions">
      <button id="phoneChangeCancelButton" class="button button-secondary"
        type="button">ยกเลิก</button>
      <button id="phoneChangeSaveButton" class="button button-primary"
        type="submit">ยืนยันเปลี่ยนเบอร์</button>
    </div>
  </form>
</section>
```

- [ ] **Step 4: Add phone form behavior**

Open/Cancel only toggle the form and clear PIN. Submit sends the current general fields plus the new phone:

```js
var result = await callServer("updateMemberAccount", {
  token: token,
  fullname: currentMember.fullname,
  phone: document.getElementById("newPhone").value.trim(),
  orgType: currentMember.orgType,
  orgName: currentMember.orgName,
  currentPin: document.getElementById("phoneCurrentPin").value,
  operation: "PHONE"
});
```

Map errors:

```js
var message = result && result.code === "DUPLICATE_PHONE"
  ? "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว"
  : result && result.code === "INVALID_CREDENTIALS"
    ? "PIN ปัจจุบันไม่ถูกต้อง"
    : "กรุณาตรวจสอบเบอร์โทรศัพท์และลองใหม่";
```

If `result.phoneChanged` is true, call:

```js
logout("เปลี่ยนเบอร์สำเร็จ กรุณาเข้าสู่ระบบด้วยเบอร์ใหม่");
```

Disable `phoneChangeSaveButton` during the request and preserve entered values after server failure.

- [ ] **Step 5: Run all tests and commit**

```powershell
npm.cmd test
git add src/Member.html src/MemberScript.html src/Styles.html tests/static.test.js
git commit -m "feat: separate member phone changes"
```

Expected: all tests pass.

### Task 4: Browser Verification, Deployment, And GitHub

**Files:**
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Document member profile behavior**

Add to the production smoke test:

```markdown
- ข้อมูลส่วนตัวเริ่มในโหมดอ่านอย่างเดียว
- แก้ชื่อหรือข้อมูลองค์กรแล้วกดบันทึก จากนั้นตรวจแถวเดิมใน `Members`
- กดยกเลิกแล้วต้องไม่มีการเปลี่ยน Sheet
- เปลี่ยนเบอร์ต้องใช้ PIN ปัจจุบันและออกจากระบบเมื่อสำเร็จ
- session เดิมใช้ต่อไม่ได้ และล็อกอินด้วยเบอร์ใหม่ได้
```

- [ ] **Step 2: Run final verification**

```powershell
npm.cmd test
git diff --check
git status --short
```

Expected: zero failures and no whitespace errors.

- [ ] **Step 3: Commit documentation**

```powershell
git add docs/DEPLOYMENT.md
git commit -m "docs: add member profile smoke tests"
```

- [ ] **Step 4: Push Apps Script and update both deployments**

```powershell
clasp.cmd push --force
$versionOutput = clasp.cmd create-version "Member profile edit and secure phone change"
$version = [regex]::Match($versionOutput, "\d+").Value
if (-not $version) { throw "Apps Script version was not created" }
clasp.cmd update-deployment AKfycbzf83l9-u4E2_fBZTiCjkYsxOS8zTVDxg_wPIF534s4cSf4l4e6gvgxg3-dgjb1UPuJBw --versionNumber $version --description "Member profile editing"
clasp.cmd update-deployment AKfycbzFrjvBGN1bG9HRVCF1lz2fiXGg0_A8nXBrRpo8u3mtAl9vj7A75WDm12Hvbp5aLUv6TQ --versionNumber $version --description "Member profile API update"
```

- [ ] **Step 5: Browser smoke test**

Using the member deployment:

1. Log in with an active member.
2. Verify the summary is read-only initially.
3. Edit general profile, save, reload, and confirm values persist.
4. Edit then cancel and confirm no values change.
5. Try a duplicate phone and verify a specific error.
6. Try a wrong PIN and verify a specific error.
7. Change phone with the correct PIN, confirm logout, and confirm the old session is invalid.
8. Log in using the new phone.
9. Verify keyboard navigation, mobile layout, and no console errors.

- [ ] **Step 6: Merge and push GitHub**

```powershell
git switch main
git merge --ff-only codex/member-profile-edit
npm.cmd test
git push origin main
```

Expected: GitHub `main`, local `main`, and Apps Script deployments contain the same source.
