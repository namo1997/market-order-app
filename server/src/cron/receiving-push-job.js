import pool from '../config/database.js';
import { createFcm } from '../services/receiving-fcm.js';
import { createPushDispatcher } from '../services/receiving-push.js';
import { ensurePushTables } from '../models/receiving-push-schema.js';
import { getExpectedItems } from '../models/receiving-documents.model.js';

export function initReceivingPushJob() {
  const dispatcher = createPushDispatcher({ db: pool, fcm: createFcm(),
    discoverOverdue: () => getExpectedItems({ user: { role: 'super_admin', name: 'ระบบตามของ' } }) });
  const tick = async () => {
    try { await ensurePushTables(pool); await dispatcher.tick(); }
    catch { console.warn('[receiving-push] deferred'); } // No provider/SQL/token details.
  };
  void tick();
  const timer = setInterval(tick, 60000); timer.unref();
  return () => clearInterval(timer);
}
