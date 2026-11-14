import cron from 'node-cron';
import { syncUsageToInventory } from '../controllers/recipe.controller.js';
import * as settingsModel from '../models/settings.model.js';

const SALES_SYNC_TIMEZONE = process.env.SALES_SYNC_TIMEZONE || 'Asia/Bangkok';
const SALES_SYNC_CRON = process.env.SALES_SYNC_CRON || '30 23 * * *';
const SALES_SYNC_RETRY_CRON = process.env.SALES_SYNC_RETRY_CRON || '0,30 0-5 * * *';
const SALES_SYNC_RETRY_FINAL_CRON = process.env.SALES_SYNC_RETRY_FINAL_CRON || '0 6 * * *';
const SALES_SYNC_STATUS_KEY = 'sales_sync_retry_status';

const getDateStringInTimezone = (date, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return `${year}-${month}-${day}`;
};

const getPreviousDateStringInTimezone = (timeZone) => {
    const now = new Date();
    const localDate = getDateStringInTimezone(now, timeZone);
    const [y, m, d] = localDate.split('-').map(Number);
    const localMidnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0);
    const prev = new Date(localMidnightUtcMs - 24 * 60 * 60 * 1000);
    return getDateStringInTimezone(prev, timeZone);
};

const getCronUserId = () => {
    const raw = process.env.SALES_SYNC_USER_ID ?? process.env.CRON_USER_ID ?? '';
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const parseStatus = (raw) => {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
};

const readStatus = async () => {
    const raw = await settingsModel.getSetting(SALES_SYNC_STATUS_KEY, '');
    return parseStatus(raw);
};

const writeStatus = async (status) => {
    await settingsModel.setSetting(SALES_SYNC_STATUS_KEY, JSON.stringify(status));
};

// เขียนสถานะไม่สำเร็จต้องไม่ทำให้การตัดสต็อกที่ commit แล้วถูกนับว่าล้ม (เคยทำให้ retry 14 ครั้ง/วัน)
const writeStatusSafely = async (status) => {
    try {
        await writeStatus(status);
        return true;
    } catch (error) {
        console.error('[Cron] Sales sync status write failed:', error?.message || error);
        return false;
    }
};

// ผลซิงค์เต็มมีรายการเมนูไม่มีสูตรเป็นพันแถว เกิน TEXT 64KB ของ system_settings → เก็บแค่ตัวเลขสรุป
const MAX_STATUS_SAMPLES = 5;
export const summarizeSyncResult = (result) => {
    // controller ตอบ { success, data: {...} } → สรุปจาก data
    const raw = result && typeof result === 'object' ? result : {};
    const data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
    const count = (value) => (Array.isArray(value) ? value.length : 0);
    const number = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const sampleNames = (list) =>
        Array.from(
            new Set(
                (Array.isArray(list) ? list : [])
                    .map((row) => String(row?.name || row?.menu_name || row?.product_name || '').trim().slice(0, 60))
                    .filter(Boolean)
            )
        ).slice(0, MAX_STATUS_SAMPLES);
    return {
        start: data.start ?? null,
        end: data.end ?? null,
        planned_deductions: number(data.planned_deductions),
        applied_deductions: number(data.applied_deductions),
        applied_quantity: number(data.applied_quantity),
        skipped_existing: number(data.skipped_existing),
        skipped_legacy_daily: number(data.skipped_legacy_daily),
        unresolved_count: count(data.unresolved_items),
        missing_recipes_count: count(data.missing_recipes),
        missing_recipe_samples: sampleNames(data.missing_recipes),
        missing_conversions_count: count(data.missing_conversions),
        missing_branch_mapping_count: count(data.missing_branch_mapping)
    };
};

const runSyncForDate = async ({ dateString, userId, source }) => {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        const req = {
            body: {
                date: dateString,
                start: dateString,
                end: dateString,
                dry_run: false
            },
            query: {},
            user: {
                id: userId
            }
        };

        const res = {
            status: (code) => ({
                json: (data) => {
                    const payload = { code, data };
                    if (code >= 400) {
                        finish(
                            reject,
                            new Error(data?.message || `HTTP ${code} from syncUsageToInventory`)
                        );
                    } else {
                        finish(resolve, payload);
                    }
                }
            }),
            json: (data) => finish(resolve, { code: 200, data })
        };

        const next = (error) => {
            if (!error) return;
            finish(reject, error instanceof Error ? error : new Error(String(error)));
        };

        syncUsageToInventory(req, res, next)
            .then(() => {
                if (!settled) {
                    finish(resolve, { code: 200, data: { success: true } });
                }
            })
            .catch((error) => finish(reject, error));
    }).then((result) => {
        console.log(
            `[Cron] Sales sync success (${source}) date=${dateString}`,
            JSON.stringify(result?.data || {})
        );
        return result?.data || {};
    });
};

const buildStatusBase = ({
    state,
    targetDate,
    source,
    message,
    failureCount = 0,
    lastError = null,
    lastResult = null,
    nextRetryAt = null
}) => ({
    state,
    target_date: targetDate,
    source,
    timezone: SALES_SYNC_TIMEZONE,
    last_attempt_at: new Date().toISOString(),
    failure_count: failureCount,
    last_error: lastError,
    message,
    next_retry_at: nextRetryAt,
    last_result: lastResult
});

// ถ้าเขียนสถานะสำเร็จแบบมีสรุปไม่ได้ ลองเขียนสถานะสำเร็จแบบสั้นที่สุดอีกครั้ง
// (สต็อกถูกตัดแล้ว ห้ามปล่อยให้สถานะค้าง pending จน retry ซ้ำ)
const writeMinimalSuccessStatus = async ({ targetDate, source }) =>
    writeStatusSafely(
        buildStatusBase({
            state: 'success',
            targetDate,
            source,
            message: `ตัดสต็อกขายอัตโนมัติสำเร็จ (${source}) — บันทึกสรุปผลไม่ได้`,
            failureCount: 0,
            lastError: null,
            lastResult: null,
            nextRetryAt: null
        })
    );

const salesSyncInFlight = new Map();
const attemptSalesSync = ({ targetDate, ...options }) => {
    const current = salesSyncInFlight.get(targetDate);
    if (current) {
        // A final retry can overlap an unusually slow earlier attempt. Keep one
        // stock operation, while retaining the final retry's failure-window gate.
        if (options.finalizeOnFail) Object.assign(current.attempt, options);
        return current.pending;
    }
    const attempt = { targetDate, ...options };
    const pending = runSalesSyncAttempt(attempt).finally(() => salesSyncInFlight.delete(targetDate));
    salesSyncInFlight.set(targetDate, { attempt, pending });
    return pending;
};

const runSalesSyncAttempt = async (attempt) => {
    const { targetDate, source } = attempt;
    const currentStatus = await readStatus();
    const previousFailureCount =
        currentStatus?.target_date === targetDate ? Number(currentStatus.failure_count || 0) : 0;
    const userId = getCronUserId();

    try {
        const result = await runSyncForDate({
            dateString: targetDate,
            userId,
            source
        });
        await writeStatusSafely(
            buildStatusBase({
                state: 'success',
                targetDate,
                source,
                message: `ตัดสต็อกขายอัตโนมัติสำเร็จ (${source})`,
                failureCount: 0,
                lastError: null,
                lastResult: summarizeSyncResult(result),
                nextRetryAt: null
            })
        ) || (await writeMinimalSuccessStatus({ targetDate, source }));
        return { success: true, result };
    } catch (error) {
        const { finalizeOnFail = false } = attempt;
        const failureCount = previousFailureCount + 1;
        const statusState = finalizeOnFail ? 'failed_window' : 'pending';
        const nextRetryAt = finalizeOnFail
            ? null
            : `อีก 30 นาที (จนถึง 06:00 ${SALES_SYNC_TIMEZONE})`;
        await writeStatusSafely(
            buildStatusBase({
                state: statusState,
                targetDate,
                source: attempt.source,
                message: finalizeOnFail
                    ? 'ดึงตัดสต็อกขายอัตโนมัติไม่สำเร็จภายในช่วง retry'
                    : 'ดึงตัดสต็อกขายอัตโนมัติไม่สำเร็จ กำลัง retry ทุก 30 นาที',
                failureCount,
                lastError: error?.message || String(error),
                lastResult: null,
                nextRetryAt
            })
        );
        console.error(`[Cron] Sales sync failed (${source}) date=${targetDate}:`, error);
        return { success: false, error };
    }
};

const shouldRunRetry = (status, targetDate) => {
    if (!status) return false;
    if (String(status.target_date || '') !== String(targetDate)) return false;
    return status.state === 'pending';
};

export const initSyncJob = () => {
    const tasks = [];
    // Primary: run at 23:30 (default) in Asia/Bangkok
    tasks.push(cron.schedule(SALES_SYNC_CRON, async () => {
        console.log(`[Cron] Executing primary sales sync at ${new Date().toISOString()}`);
        try {
            const targetDate = getDateStringInTimezone(new Date(), SALES_SYNC_TIMEZONE);
            await attemptSalesSync({
                targetDate,
                source: 'primary',
                finalizeOnFail: false
            });
        } catch (error) {
            console.error('[Cron] Unexpected error in primary sales sync:', error);
        }
    }, {
        timezone: SALES_SYNC_TIMEZONE
    }));

    // Retry window: every 30 mins from 00:00-05:30 (Thai time) if previous day is pending.
    tasks.push(cron.schedule(SALES_SYNC_RETRY_CRON, async () => {
        try {
            const retryTargetDate = getPreviousDateStringInTimezone(SALES_SYNC_TIMEZONE);
            const status = await readStatus();
            if (!shouldRunRetry(status, retryTargetDate)) return;
            console.log(`[Cron] Retry sales sync (window) for date=${retryTargetDate}`);
            await attemptSalesSync({
                targetDate: retryTargetDate,
                source: 'retry-window',
                finalizeOnFail: false
            });
        } catch (error) {
            console.error('[Cron] Unexpected error in retry-window sales sync:', error);
        }
    }, {
        timezone: SALES_SYNC_TIMEZONE
    }));

    // Final retry at 06:00 (Thai time). If still fail, mark as failed_window for dashboard alert.
    tasks.push(cron.schedule(SALES_SYNC_RETRY_FINAL_CRON, async () => {
        try {
            const retryTargetDate = getPreviousDateStringInTimezone(SALES_SYNC_TIMEZONE);
            const status = await readStatus();
            if (!shouldRunRetry(status, retryTargetDate)) return;
            console.log(`[Cron] Final retry sales sync for date=${retryTargetDate}`);
            await attemptSalesSync({
                targetDate: retryTargetDate,
                source: 'retry-final',
                finalizeOnFail: true
            });
        } catch (error) {
            console.error('[Cron] Unexpected error in retry-final sales sync:', error);
        }
    }, {
        timezone: SALES_SYNC_TIMEZONE
    }));

    console.log(
        `[Cron] Sales sync schedules: primary=${SALES_SYNC_CRON}, retry=${SALES_SYNC_RETRY_CRON}, final=${SALES_SYNC_RETRY_FINAL_CRON}, timezone=${SALES_SYNC_TIMEZONE}`
    );
    return () => { for (const task of tasks) task?.stop(); };
};
