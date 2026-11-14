/**
 * ไฟล์ตั้งค่าการเชื่อมต่อฐานข้อมูลคลาวด์ (Supabase) และกฎการคำนวณค่าแรง
 * สามารถใส่ค่าตรงนี้ หรือตั้งค่าผ่านปุ่ม "⚙️ ตั้งค่าฐานข้อมูล" บนหน้าเว็บได้เลย
 */
window.WAGE_CONFIG = {
  // 1. ค่าเริ่มต้น Supabase
  SUPABASE_URL: localStorage.getItem('WAGE_SUPABASE_URL') || 'https://mtghykjrttqruqdznyyl.supabase.co',
  SUPABASE_ANON_KEY: localStorage.getItem('WAGE_SUPABASE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10Z2h5a2pydHRxcnVxZHpueXlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MTU1NzIsImV4cCI6MjExMDE5MTU3Mn0.mzra-buiPFqOyz7ez7WIeT8IqtM8g6OiKRCw0p9Br-4',
  STORAGE_BUCKET: 'wage-images',

  // 2. กฎการคำนวณค่าแรง (ตรงตามระบบเดิม 100%)
  MARKUP_RATE: 1.2,      // คิดบวกเพิ่ม +20% (×1.2)
  HOURLY_DIVISOR: 8,     // 1 วันทำงานปกติ = 8 ชั่วโมง
  EXEMPT_WORKER: 'เฟิร์น' // ชื่อคนงานที่ยกเว้นการบวก +20% ทุกกรณี
};
