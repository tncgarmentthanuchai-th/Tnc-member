# คู่มือติดตั้ง TNC Garment Member System

## 1. เตรียม Google Sheet

1. สร้าง Google Spreadsheet หรือใช้ไฟล์เดิม
2. คัดลอก Spreadsheet ID จาก URL `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
3. ไม่ต้องสร้างชีตย่อยเอง ระบบจะจัดเตรียม `Members`, `Orders`, `AuditLog` และ `Settings`

## 2. ตั้งค่า Apps Script

1. เปิด Apps Script project และตั้ง time zone เป็น `Asia/Bangkok`
2. Push source:

   ```powershell
   clasp.cmd push
   ```

3. เปิด **Project Settings > Script Properties**
4. ตั้งค่าดังนี้:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | ID ของ Google Spreadsheet |
| `SETUP_OWNER_EMAIL` | อีเมลเจ้าของที่มีสิทธิ์รัน bootstrap และติดตั้ง trigger |
| `ADMIN_EMAILS` | อีเมลแอดมิน คั่นหลายบัญชีด้วย comma |

ตัวอย่าง:

```text
SETUP_OWNER_EMAIL=tncgarment.thanuchai@gmail.com
ADMIN_EMAILS=tncgarment.thanuchai@gmail.com
```

`SETUP_OWNER_EMAIL` ต้องตรงกับ `Session.getActiveUser().getEmail()` จึงควรรันคำสั่งติดตั้งจากบัญชีเจ้าของเดียวกัน

## 3. ติดตั้งหรืออัปเกรด schema

1. ใน Apps Script editor เลือก `bootstrapTncMemberSystem`
2. กด **Run** และอนุญาตสิทธิ์ Google
3. ตรวจ Spreadsheet:
   - มีชีต `Orders`
   - `Members` มีคอลัมน์ `points`, `tier`, `lastOrderAt`
   - `Settings` มี `MEMBER_SEQUENCE`, `ORDER_SEQUENCE` และ schema version ล่าสุด
4. เปิดหน้า **Triggers** และยืนยันว่ามี daily trigger ของ `reconcileAllMemberPoints_`
5. หาก bootstrap ไม่สร้าง trigger ให้รัน `installPointsReconciliationTrigger` โดยตรงหนึ่งครั้ง

ควรมี reconciliation trigger เพียงหนึ่งรายการ ระบบติดตั้งจะลบเฉพาะ trigger ซ้ำของ handler เดียวกัน

## 4. สิทธิ์แอดมิน

Admin deployment ทำงานภายใต้บัญชีผู้เปิดเว็บ:

1. แชร์ Spreadsheet เป็น **Editor** ให้ทุกอีเมลใน `ADMIN_EMAILS`
2. ห้ามแชร์ Spreadsheet แบบ public หรือ anyone-with-link
3. แอดมินแต่ละคนต้อง authorize Apps Script ครั้งแรก

## 5. Public deployment

1. เลือก **Deploy > New deployment > Web app**
2. Description: `TNC Member - Public`
3. Execute as: **Me**
4. Who has access: **Anyone**

URL:

- สมัครสมาชิก: `PUBLIC_URL`
- เข้าสู่ระบบสมาชิก: `PUBLIC_URL?page=member`

## 6. Admin deployment

1. เลือก **Deploy > New deployment > Web app**
2. Description: `TNC Member - Admin`
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone with Google account**

URL หลังบ้าน: `ADMIN_DEPLOYMENT_URL?page=admin`

ห้ามใช้ `PUBLIC_URL?page=admin` เป็น URL หลังบ้าน เพราะ public deployment ทำงานในสิทธิ์เจ้าของและไม่ได้ใช้สำหรับยืนยันผู้ดูแลแต่ละบัญชี

## 7. อัปเดต deployment เดิม

หลังแก้ source:

1. รัน `npm.cmd test`
2. รัน `clasp.cmd push`
3. รัน `bootstrapTncMemberSystem()` เป็นเจ้าของเมื่อมี schema/trigger ใหม่
4. เลือก **Deploy > Manage deployments**
5. แก้ Public และ Admin deployment ให้ใช้ version ใหม่ โดยคง execute/access settings เดิม

## 8. Production smoke test

ทำตามลำดับนี้หลังสร้าง version ใหม่:

1. สมัครสมาชิกหนึ่งรายและตรวจว่าเกิดแถวใน `Members`
2. ล็อกอินด้วยเบอร์โทร + PIN
3. เปิดหน้าแอดมินและเพิ่มออร์เดอร์ `30,000` บาท
4. ตรวจว่าแต้มเป็น `30,000` และระดับเปลี่ยนเป็น `Gold`
5. เปิดหน้าสมาชิกและตรวจแต้ม ระดับ สิทธิประโยชน์ และประวัติออร์เดอร์
6. ยกเลิกออร์เดอร์พร้อมเหตุผล
7. ตรวจว่าแต้มลดลง ระดับกลับเป็น `Silver` และรายการแสดงสถานะยกเลิก
8. ตรวจ `AuditLog` ว่ามีการสร้างและยกเลิกออร์เดอร์
9. เปิดหน้า Triggers และตรวจว่ามี reconciliation trigger เพียงหนึ่งรายการ

## ข้อจำกัด

- Google Apps Script และ Google Sheets มี quota เหมาะกับระบบขนาดเล็กถึงกลาง
- อย่าแก้ `memberId`, `orderId`, `points` หรือ `tier` โดยตรงใน Sheet
- การแก้ยอดย้อนหลังให้ยกเลิกออร์เดอร์เดิม แล้วบันทึกออร์เดอร์ใหม่
- ระบบยังไม่มีการแลกแต้ม และไม่รองรับการแก้ไขออร์เดอร์เดิม
