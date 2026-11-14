// ลองทำงานทั้งก้อน (transaction เดียว) ใหม่เมื่อ MySQL แจ้ง deadlock (ER_LOCK_DEADLOCK / 1213)
//
// เมื่อเกิด deadlock InnoDB จะ rollback transaction ที่ถูกเลือกเป็นเหยื่อทั้งก้อนแล้ว
// งานที่ส่งเข้ามาต้อง "ขอ connection ใหม่ -> BEGIN -> อ่านแถวใหม่ -> COMMIT / ROLLBACK -> release"
// ทั้งหมดภายใน work() เพื่อให้รอบใหม่เริ่มจากสถานะเดิมของฐานข้อมูลจริง ๆ
// งานนอก transaction (แจ้งเตือน, outbox, ตอบ response) ต้องอยู่หลัง withDeadlockRetry เท่านั้น
//
// ไม่รวม ER_LOCK_WAIT_TIMEOUT (1205) โดยตั้งใจ: timeout แปลว่ามีคนถือ lock นาน ไม่ใช่วงล็อกกัน
// การลองซ้ำจะรออีก innodb_lock_wait_timeout (ค่าเริ่มต้น 50 วินาที) ต่อรอบ ทำให้คำขอค้างเกิน
// timeout ของเครือข่าย/ผู้ใช้กดซ้ำ และค่าเริ่มต้น MySQL ยกเลิกแค่คำสั่งเดียว ไม่ใช่ทั้ง transaction

export const DEADLOCK_MAX_ATTEMPTS = 3;
const DEADLOCK_BASE_DELAY_MS = 40;

export const isDeadlockError = (error) =>
  Boolean(error) && (error.code === 'ER_LOCK_DEADLOCK' || Number(error.errno) === 1213);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const withDeadlockRetry = async (work, {
  attempts = DEADLOCK_MAX_ATTEMPTS,
  baseDelayMs = DEADLOCK_BASE_DELAY_MS,
  sleep = defaultSleep,
  random = Math.random,
  label = 'transaction',
  onRetry = ({ attempt, maxAttempts, waitMs }) => {
    console.warn(`[deadlock retry] ${label} ${attempt}/${maxAttempts} รอ ${waitMs}ms แล้วลองใหม่`);
  }
} = {}) => {
  const maxAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      if (!isDeadlockError(error) || attempt >= maxAttempts) throw error;
      // jitter 0.5x–1.5x ของ base * 2^(attempt-1) กันสองคำขอชนกันซ้ำในจังหวะเดิม
      const waitMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + random()));
      onRetry({ attempt, maxAttempts, waitMs, error });
      await sleep(waitMs);
    }
  }
};
