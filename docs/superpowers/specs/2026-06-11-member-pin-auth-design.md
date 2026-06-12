# TNC Member PIN Authentication Design

## Summary

เพิ่ม Member Portal ให้สมาชิกเข้าสู่ระบบด้วยเบอร์โทรศัพท์และ PIN ตัวเลข 6 หลัก เพื่อดูรหัสสมาชิก สถานะ และข้อมูลส่วนตัว รวมถึงแก้ไขข้อมูล เปลี่ยนเบอร์ และเปลี่ยน PIN

## Authentication

- สมาชิกใหม่กำหนด PIN และยืนยัน PIN ระหว่างสมัคร
- เก็บเฉพาะ `pinHash` และ `pinSalt`; ไม่เก็บ PIN จริง
- signed session token มีอายุ 24 ชั่วโมงและเก็บใน browser `sessionStorage`
- token มี `memberId`, `sessionVersion`, `issuedAt`, `expiresAt` และ HMAC signature
- login ผิด 5 ครั้งภายใน 15 นาทีจะถูกระงับ 30 นาทีผ่าน `CacheService`
- ข้อความผิดพลาดไม่แยกกรณีไม่พบเบอร์กับ PIN ผิด
- การเปลี่ยน PIN, เปลี่ยนเบอร์ และออก PIN ชั่วคราวเพิ่ม `sessionVersion`

## Member Portal

- Route `?page=member`
- ดูรหัสสมาชิก สถานะ ชื่อ เบอร์ ประเภทองค์กร และชื่อองค์กร
- แก้ชื่อและข้อมูลองค์กรได้
- เปลี่ยนเบอร์ต้องยืนยัน PIN ปัจจุบัน แล้วออกจากระบบทุก session
- เปลี่ยน PIN ต้องยืนยัน PIN ปัจจุบัน
- ผู้ใช้ PIN ชั่วคราวต้องเปลี่ยน PIN ก่อนใช้งานส่วนอื่น

## Admin And Migration

- Admin ออก PIN ชั่วคราว 6 หลักได้ และ PIN แสดงครั้งเดียว
- บันทึก `RESET_PIN` โดยไม่บันทึก PIN/hash/salt ใน `AuditLog`
- เพิ่มคอลัมน์ `pinHash`, `pinSalt`, `sessionVersion`, `mustChangePin`
- migration รักษาข้อมูลเดิมทั้งหมด สมาชิกเดิมต้องรับ PIN ชั่วคราวก่อนล็อกอิน
- ไม่ส่ง auth fields ไปหน้า Admin, CSV หรือ Member Portal

## Testing

- ทดสอบ PIN hashing/verification, token signing/expiry/version และ rate limiting
- ทดสอบ registration ที่ต้องมี PIN และไม่คืน PIN/hash
- ทดสอบ login, forced PIN change, profile update, phone change และ session invalidation
- ทดสอบ admin temporary PIN reset และ schema migration
