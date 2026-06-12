# คู่มือติดตั้ง TNC Garment Member System

## 1. เตรียม Google Sheet

1. สร้าง Google Spreadsheet ใหม่
2. คัดลอก Spreadsheet ID จาก URL:

   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

3. ไม่ต้องสร้างชีตย่อยเอง ระบบจะสร้าง `Members`, `AuditLog` และ `Settings`

## 2. เตรียม Apps Script

1. สร้าง standalone Apps Script project ที่ [script.google.com](https://script.google.com)
2. นำไฟล์ทั้งหมดใน `src` ขึ้นโปรเจกต์ โดยใช้ชื่อเดิม
3. ตรวจว่า project time zone เป็น `Asia/Bangkok`
4. เปิด **Project Settings > Script Properties**
5. เพิ่มค่า:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | ID ของ Google Spreadsheet (เว้นว่างได้เมื่อ Script ผูกกับ Sheet โดยตรง) |
| `ADMIN_EMAILS` | อีเมล Gmail แอดมิน คั่นด้วย comma เช่น `admin1@gmail.com,admin2@gmail.com` |

6. เปิด editor เลือก `setupTncMemberSystem` แล้วกด **Run**
7. อนุญาตสิทธิ์ Google และตรวจว่า Sheet ทั้งสามถูกสร้างครบ

## 3. แชร์สิทธิ์ให้แอดมิน

Admin deployment ทำงานภายใต้บัญชีผู้เปิดเว็บ จึงต้องแชร์ Spreadsheet เป็น **Editor** ให้ทุกอีเมลใน `ADMIN_EMAILS`

อย่าแชร์ Spreadsheet แบบ public หรือ anyone-with-link

## 4. สร้าง Public deployment

1. เลือก **Deploy > New deployment > Web app**
2. Description: `TNC Member - Public`
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Deploy และเก็บ URL เป็น `PUBLIC_URL`

หน้าใช้งาน:

`PUBLIC_URL`

หน้าบัญชีสมาชิก:

`PUBLIC_URL?page=member`

Public deployment เขียนข้อมูลด้วยสิทธิ์เจ้าของ Script ผู้สมัครจึงไม่ต้องเข้าสู่ระบบ Google

## 5. สร้าง Admin deployment

1. เลือก **Deploy > New deployment > Web app**
2. Description: `TNC Member - Admin`
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone with Google account**
5. Deploy และเก็บ URL เป็น `ADMIN_DEPLOYMENT_URL`

หน้าใช้งาน:

`ADMIN_DEPLOYMENT_URL?page=admin`

แอดมินแต่ละคนต้องเข้าสู่ระบบและอนุญาต scopes ครั้งแรก ระบบจะตรวจอีเมลกับ `ADMIN_EMAILS` ซ้ำใน server ทุกคำสั่ง

> ห้ามใช้ `PUBLIC_URL?page=admin` เป็น URL หลังบ้าน เพราะ public deployment รันภายใต้เจ้าของ Script และไม่ได้ออกแบบให้ยืนยันตัวตนแอดมินทั่วไป

## 6. Checklist หลัง deploy

- เปิด `PUBLIC_URL` ในหน้าต่างไม่ระบุตัวตนและสมัครสมาชิกได้
- ตรวจว่าได้เลข `TNC-000001` และมีหนึ่งแถวใน `Members`
- สมัครด้วยเบอร์เดิมแล้วได้รหัสเดิมโดยไม่มีแถวเพิ่ม
- เปิด Admin URL ด้วยบัญชีที่ไม่อยู่ใน allowlist แล้วถูกปฏิเสธ
- เปิด Admin URL ด้วยบัญชีที่อนุญาตแล้วเห็นตารางสมาชิก
- ค้นหา กรอง เปิดรายละเอียด และแก้ไขข้อมูลได้
- ระงับโดยไม่กรอกเหตุผลไม่ได้
- ระงับ/เปิดใช้งานแล้วมีรายการใหม่ใน `AuditLog`
- ส่งออก CSV แล้วเปิดภาษาไทยใน Excel/Google Sheets ได้
- ทดสอบหน้า Public และ Admin บนมือถือ

## 7. การอัปเดตระบบ

หลังแก้ source:

1. Push หรือคัดลอกไฟล์เวอร์ชันใหม่
2. เลือก **Deploy > Manage deployments**
3. แก้ Public และ Admin deployment ให้ใช้ version ใหม่
4. ทำ checklist เฉพาะ workflow ที่ได้รับผลกระทบ

## ข้อจำกัด

- Google Apps Script และ Google Sheets มี quota จึงเหมาะกับระบบสมาชิกขนาดเล็กถึงกลาง
- Admin ที่ใช้ Gmail ทั่วไปต้อง authorize Apps Script และมีสิทธิ์แก้ไข Spreadsheet
- การเปลี่ยน `memberId` โดยตรงใน Sheet อาจทำให้ลำดับไม่สอดคล้อง จึงควรแก้ผ่านระบบหลังบ้านเท่านั้น
