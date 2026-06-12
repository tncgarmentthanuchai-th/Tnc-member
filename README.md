# TNC Garment Member System

ระบบสมัครและจัดการสมาชิกด้วย Google Apps Script + Google Sheets

## ความสามารถ

- สมัครสมาชิกและออกเลข `TNC-000001` ต่อเนื่องด้วย `LockService`
- ใช้เบอร์โทรศัพท์เป็นข้อมูลไม่ซ้ำ และคืนรหัสเดิมเมื่อสมัครซ้ำ
- หน้าหลังบ้านค้นหา กรอง แบ่งหน้า แก้ไข ระงับ/เปิดใช้งาน และส่งออก CSV
- Member Portal เข้าสู่ระบบด้วยเบอร์โทร + PIN 6 หลัก ดูและแก้ข้อมูลส่วนตัว
- แอดมินออก PIN ชั่วคราวให้สมาชิกเดิม โดยบังคับเปลี่ยนหลังล็อกอิน
- ตรวจสิทธิ์แอดมินด้วยบัญชี Google และ `ADMIN_EMAILS`
- บันทึกการสร้าง แก้ไข และเปลี่ยนสถานะลง `AuditLog`
- ตรวจข้อมูลทั้ง browser และ server พร้อมป้องกัน XSS/CSV formula injection

## โครงสร้าง

- `src/Core.js` validation, filtering, pagination และ CSV
- `src/MemberService.js` กติกาทางธุรกิจของสมาชิก
- `src/SheetRepository.js` อ่านและเขียน Google Sheets
- `src/Auth.js` ตรวจบัญชี Google ของแอดมิน
- `src/Code.js` web routing และ public/admin APIs
- `src/Setup.js` สร้างชีตและ header
- `src/Public.html`, `src/Admin.html` หน้าใช้งาน
- `src/Member.html` หน้าเข้าสู่ระบบและบัญชีสมาชิก
- `docs/DEPLOYMENT.md` คู่มือติดตั้งและเผยแพร่

## ทดสอบ

ต้องมี Node.js 20 ขึ้นไป:

```powershell
npm.cmd test
```

## นำขึ้น Apps Script

ใช้ `clasp` หรือสร้างไฟล์ใน Apps Script editor ตามชื่อในโฟลเดอร์ `src`

```powershell
Copy-Item .clasp.json.example .clasp.json
# ใส่ Apps Script project ID ใน .clasp.json
clasp push
```

จากนั้นทำตาม [คู่มือ deployment](docs/DEPLOYMENT.md)
