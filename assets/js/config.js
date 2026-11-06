/**
 * ไฟล์ตั้งค่าการเชื่อมต่อฐานข้อมูลคลาวด์ (Supabase) และกฎการคำนวณค่าแรง
 * สามารถใส่ค่าตรงนี้ หรือตั้งค่าผ่านปุ่ม "⚙️ ตั้งค่าฐานข้อมูล" บนหน้าเว็บได้เลย
 */
window.WAGE_CONFIG = {
  // 1. ค่าเริ่มต้น Supabase (หากเว้นว่าง ระบบจะอ่านจากการตั้งค่าบนหน้าเว็บ หรือทำงานในโหมดฐานข้อมูลในเครื่องอัตโนมัติ)
  SUPABASE_URL: localStorage.getItem('WAGE_SUPABASE_URL') || '',
  SUPABASE_ANON_KEY: localStorage.getItem('WAGE_SUPABASE_KEY') || '',
  STORAGE_BUCKET: 'wage-images',

  // 2. กฎการคำนวณค่าแรง (ตรงตามระบบเดิม 100%)
  MARKUP_RATE: 1.2,      // คิดบวกเพิ่ม +20% (×1.2)
  HOURLY_DIVISOR: 8,     // 1 วันทำงานปกติ = 8 ชั่วโมง
  EXEMPT_WORKER: 'เฟิร์น' // ชื่อคนงานที่ยกเว้นการบวก +20% ทุกกรณี
};
