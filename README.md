# TNC Garment Member System

ระบบสมาชิกบน Google Apps Script และ Google Sheets สำหรับสมัครสมาชิก จัดการ PIN และสะสมแต้มจากยอดชำระ โดยใช้กติกา `1 บาท = 1 แต้ม`

## ความสามารถ

- สมัครสมาชิกและออกเลข `TNC-000001` ต่อเนื่องด้วย `LockService`
- ป้องกันเบอร์โทรซ้ำ และคืนรหัสเดิมโดยไม่เปิดเผยข้อมูลส่วนตัว
- เข้าสู่ระบบสมาชิกด้วยเบอร์โทร + PIN 6 หลัก
- แอดมินออก PIN ชั่วคราว และบังคับสมาชิกเปลี่ยนก่อนใช้งานต่อ
- แอดมินค้นหา แก้ไข ระงับ/เปิดใช้สมาชิก และส่งออก CSV
- แอดมินบันทึกออร์เดอร์ ยกเลิกพร้อมเหตุผล และปรับแต้มอัตโนมัติ
- ระดับสมาชิก: Silver `0-29,999`, Gold `30,000-99,999`, Platinum `100,000+`
- สมาชิกดูแต้ม ระดับ สิทธิประโยชน์ และประวัติออร์เดอร์แบบแบ่งหน้า
- งานตรวจสอบยอดแต้มรายวันซ่อม summary ที่ไม่ตรงกับออร์เดอร์
- บันทึกการสร้าง แก้ไข เปลี่ยนสถานะ ออร์เดอร์ และการซ่อมแต้มใน `AuditLog`
- ตรวจข้อมูลทั้ง client/server และไม่แทรกข้อมูลผู้ใช้ผ่าน `innerHTML`

## โครงสร้างสำคัญ

- `src/Core.js` validation, filtering, pagination และ CSV
- `src/PointsCore.js` กติกาแต้ม ระดับ สิทธิประโยชน์ และ order pagination
- `src/MemberService.js` กติกาสมาชิก การล็อกอิน และ PIN
- `src/OrderService.js` สร้าง/ยกเลิกออร์เดอร์และ reconciliation
- `src/SheetRepository.js` อ่านและเขียน Google Sheets
- `src/Auth.js` ตรวจสิทธิ์แอดมินและ session สมาชิก
- `src/Code.js` routing และ public/admin/member APIs
- `src/Setup.js` migration ชีต ค่าเริ่มต้น และ trigger
- `src/Public.html` หน้าสมัครสมาชิก
- `src/Member.html` หน้าบัญชีสมาชิกและแต้ม
- `src/Admin.html` หน้าจัดการสมาชิกและออร์เดอร์
- `docs/DEPLOYMENT.md` คู่มือติดตั้ง อัปเดต และตรวจสอบระบบ

## Google Sheets

ระบบใช้ชีตต่อไปนี้:

- `Members` ข้อมูลสมาชิกและ summary `points`, `tier`, `lastOrderAt`
- `Orders` ประวัติยอดชำระและการยกเลิก
- `AuditLog` ประวัติการเปลี่ยนแปลง
- `Settings` schema version และลำดับเลขสมาชิก/ออร์เดอร์

ห้ามแก้แต้มใน `Members` โดยตรง ให้เพิ่มหรือยกเลิกออร์เดอร์ผ่านหน้าแอดมิน

## ทดสอบ

ต้องใช้ Node.js 20 ขึ้นไป:

```powershell
npm.cmd test
```

## นำขึ้น Apps Script

```powershell
Copy-Item .clasp.json.example .clasp.json
# ใส่ Apps Script project ID ใน .clasp.json
clasp.cmd push
```

จากนั้นทำตาม [คู่มือ deployment](docs/DEPLOYMENT.md)
