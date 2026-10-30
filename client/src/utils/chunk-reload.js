const CHUNK_RELOAD_KEY = 'chunk_reload_at';
const CHUNK_RELOAD_COOLDOWN_MS = 30000;

// ไฟล์ JS ของหน้าเก่าหายหลัง deploy เวอร์ชันใหม่ (แท็บที่เปิดค้างไว้)
export const isChunkLoadError = (error) => {
  const message = String(error?.message || error || '');
  return (
    error?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
};

// reload ครั้งเดียวต่อช่วงเวลา กัน reload วนไม่รู้จบถ้า server มีปัญหาจริง
export const reloadForNewVersion = () => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage ใช้ไม่ได้ ก็ยัง reload ได้
  }
  window.location.reload();
  return true;
};
