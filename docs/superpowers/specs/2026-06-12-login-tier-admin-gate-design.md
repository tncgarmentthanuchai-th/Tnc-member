# TNC Login, Tier Card, and Admin Gate Design

## Summary

ปรับประสบการณ์เข้าสู่ระบบสมาชิกและหลังบ้านโดยไม่เพิ่มระบบบัญชีหรือฐานข้อมูลใหม่:

- หน้า Login สมาชิกแสดง prefix `+66` คงที่ และรับเลขโทรศัพท์ 9 หลักโดยไม่ใส่ `0` แรก
- Rewards card ทั้งใบเปลี่ยนกรอบและพื้นหลังตามระดับ Silver, Gold และ Platinum
- หน้าเข้าสู่ระบบหลังบ้านอธิบายว่าต้องใช้ Google Account ที่กำหนด และนำผู้ใช้เข้าสู่ Google authorization ของ Admin deployment
- อนุญาตหลังบ้านเฉพาะ `tncgarment.thanuchai@gmail.com`

## Member Phone Login

ช่องเบอร์โทรใน `Member.html` จะแยกเป็น:

- prefix ที่มองเห็นและแก้ไม่ได้: `+66`
- input สำหรับเลข 9 หลัก เช่น `812345678`

ข้อกำหนด:

- รับเฉพาะตัวเลข 9 หลัก
- แสดงตัวอย่าง `81 234 5678`
- ก่อนเรียก `loginMember` ให้แปลงเป็นรูปแบบในประเทศ `0812345678`
- หากไม่ครบ 9 หลัก ให้แสดงข้อความภาษาไทยและไม่เรียก server
- การสมัครสมาชิกและแก้ไขโปรไฟล์ยังใช้รูปแบบเดิม
- server ยังคง normalize และตรวจเบอร์อีกชั้นตามเดิม

## Tier Rewards Card

เปลี่ยน class บน rewards card ตาม `member.tier`:

- `Silver`: พื้นสี navy เดิม พร้อมกรอบ silver ที่เห็นชัด
- `Gold`: พื้นสี navy เดิม พร้อมกรอบและเงา gold
- `Platinum`: พื้นหลัง gradient indigo และกรอบ gold พร้อม highlight แบบพรีเมียม

สีครอบทั้งการ์ด “แต้มสะสมของคุณ” ไม่ใช่เฉพาะ badge ระดับ โดยยังคง contrast ของข้อความและ progress bar ให้อ่านง่ายบนมือถือและ desktop

## Admin Login Gate

สร้างหน้า `AdminLogin.html` สำหรับ URL หลังบ้านเมื่อ session ยังไม่มีอีเมลที่อนุญาต หน้าแสดง:

- ชื่อ TNC Garment Admin
- ข้อความว่าใช้ Google Account สำหรับเข้าหลังบ้าน
- อีเมลที่อนุญาต `tncgarment.thanuchai@gmail.com`
- ปุ่ม “เข้าสู่ระบบด้วย Google” ที่เปิด Admin deployment URL เดิม

Google Apps Script เป็นผู้ทำ authorization และเลือกบัญชี ระบบไม่รับหรือเก็บรหัสผ่าน Google

เมื่อเปิด `?page=admin`:

- ถ้า `Session.getActiveUser().getEmail()` ตรงกับอีเมลที่กำหนด ให้แสดง `Admin.html`
- ถ้าอีเมลว่าง ให้แสดงหน้า Admin Login
- ถ้ามีอีเมลแต่ไม่ตรง ให้แสดงหน้าไม่มีสิทธิ์ พร้อมปุ่มกลับไปเข้าสู่ระบบด้วยบัญชีที่ถูกต้อง
- API หลังบ้านทุกคำสั่งยังตรวจสิทธิ์ผ่าน `withAdmin` เหมือนเดิม

`ADMIN_EMAILS` จะกำหนดให้มีเฉพาะ `tncgarment.thanuchai@gmail.com` ใน Script Properties ระหว่าง deployment

## Security and Performance

- ไม่สร้าง password database, admin session table หรือ OAuth service เพิ่ม
- ไม่ส่ง Google password ผ่าน HTML หรือ Apps Script
- ใช้ Google authorization และ server-side allowlist ที่มีอยู่
- ไม่ใช้ `innerHTML` กับข้อมูลผู้ใช้
- การแปลง `+66` เป็น `0` ทำฝั่ง client เพื่อลด request ที่ผิดรูปแบบ แต่ server validation ยังคงเป็นแหล่งตัดสินสุดท้าย

## Testing

- Static test ตรวจ prefix `+66`, input 9 หลัก และ error element
- Client script syntax test และข้อห้าม `innerHTML`
- Test ตรวจการแปลง `812345678` เป็น `0812345678` และปฏิเสธค่าที่ไม่ครบ 9 หลัก
- Static test ตรวจ class rewards card ทั้ง Silver, Gold และ Platinum
- Authorization tests ตรวจเฉพาะอีเมลที่กำหนดผ่าน
- Routing tests ตรวจ admin login, unauthorized และ admin view
- Browser smoke test หน้า Member และ Admin deployment หลัง deploy

## Out of Scope

- เปลี่ยนช่องโทรศัพท์หน้าสมัครสมาชิกหรือแก้ไขโปรไฟล์
- รหัสผ่านแอดมินแบบกำหนดเอง
- รองรับหลายอีเมลแอดมินในงานรอบนี้
- เปลี่ยนกติกาแต้ม สิทธิประโยชน์ หรือระดับสมาชิก
