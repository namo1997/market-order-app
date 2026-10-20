import { LEGACY_RECEIVING_WRITES_ENABLED } from '../config/legacy-receiving.js';

export const LEGACY_RECEIVING_DISABLED_MESSAGE =
  'เมนูรับสินค้าแบบเดิมปิดการใช้งานแล้ว กรุณาใช้ระบบรับสินค้าใหม่ (รับสินค้า / อ่านบิล)';

// Guard for the legacy receiving write endpoints. Logs only method, route path (no query string,
// no body, no headers) and numeric user id/role, so no secrets or bill data reach the logs.
export function createLegacyReceivingWriteGuard({ enabled = LEGACY_RECEIVING_WRITES_ENABLED, logger = console } = {}) {
  return function legacyReceivingWriteGuard(req, res, next) {
    const path = String(req.baseUrl || '') + String(req.path || '');
    const who = `user=${Number.isInteger(Number(req.user?.id)) ? Number(req.user.id) : 'unknown'} role=${String(req.user?.role ?? 'unknown').replace(/[^\w-]/g, '')}`;
    if (!enabled) {
      logger.warn(`[LEGACY-RECEIVING] blocked (410) ${req.method} ${path} ${who}`);
      return res.status(410).json({
        success: false,
        code: 'LEGACY_RECEIVING_DISABLED',
        message: LEGACY_RECEIVING_DISABLED_MESSAGE
      });
    }
    logger.warn(`[LEGACY-RECEIVING] DEPRECATED write ${req.method} ${path} ${who}; use the new receiving system (/api/receiving-documents)`);
    return next();
  };
}

export const legacyReceivingWriteGuard = createLegacyReceivingWriteGuard();
