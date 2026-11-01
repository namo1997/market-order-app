// ลองใหม่เมื่อ MySQL ตัดสินให้ transaction นี้แพ้ deadlock / รอ lock นานเกิน
// ใช้ได้กับฟังก์ชันที่ทำงานทั้งหมดใน transaction เดียว (rollback แล้วไม่มีผลค้าง)
const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

export const isRetryableLockError = (error) => Boolean(error && RETRYABLE_CODES.has(error.code));

export const withDeadlockRetry = (fn, { attempts = 3, baseDelayMs = 40 } = {}) =>
  async (...args) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fn(...args);
      } catch (error) {
        if (!isRetryableLockError(error) || attempt >= attempts) throw error;
        const delay = baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  };
