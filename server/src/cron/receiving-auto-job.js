import pool from '../config/database.js';
import { autoReceivePendingItemsForNextDay } from '../models/order.model.js';
import { toBangkokDateKey } from '../utils/bangkok-date.js';
import { ensureReceivingNotificationTable, dispatchPendingReceivingNotifications } from '../services/receiving-notification-outbox.js';

// Run at startup and each minute. Locked order rows provide cross-instance
// idempotency; the model only settles dates whose Bangkok 23:30 cutoff elapsed.
export function initReceivingAutoJob() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      try { await autoReceivePendingItemsForNextDay({ date: toBangkokDateKey(now), scope: 'all', now }); }
      catch { console.warn('[receiving-auto] deferred'); }
      try {
        await ensureReceivingNotificationTable(pool);
        await dispatchPendingReceivingNotifications(pool);
      } catch { console.warn('[receiving-notify] reconciliation deferred'); }
    }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(tick, 60000); timer.unref();
  return () => clearInterval(timer);
}
