import cron from 'node-cron';
import { syncUsageToInventory } from '../controllers/recipe.controller.js';
import * as settingsModel from '../models/settings.model.js';
import * as salesSyncRuns from '../models/sales-sync-run.model.js';
import { createSalesSyncRunner, shouldRunSalesSyncRetry } from '../services/sales-sync-status.service.js';

const SALES_SYNC_TIMEZONE = process.env.SALES_SYNC_TIMEZONE || 'Asia/Bangkok';
const SALES_SYNC_CRON = process.env.SALES_SYNC_CRON || '30 23 * * *';
const SALES_SYNC_RETRY_CRON = process.env.SALES_SYNC_RETRY_CRON || '0,30 0-5 * * *';
const SALES_SYNC_RETRY_FINAL_CRON = process.env.SALES_SYNC_RETRY_FINAL_CRON || '0 6 * * *';

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

const runSyncForDate = async ({ dateString, userId, recordCompletion }) => {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        const req = {
            // Internal callback only; never accepted from HTTP body/query.
            recordSalesSyncCompletion: recordCompletion,
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
                    finish(reject, new Error('Sales sync returned without a response'));
                }
            })
            .catch((error) => finish(reject, error));
    }).then((result) => result?.data || {});
};

const syncRunner = createSalesSyncRunner({
    runSync: runSyncForDate,
    settings: settingsModel,
    runs: salesSyncRuns,
    timezone: SALES_SYNC_TIMEZONE
});
const readStatus = syncRunner.readStatus;
const attemptSalesSync = (options) => syncRunner.attempt({ ...options, userId: getCronUserId() });

export const initSyncJob = () => {
    // Primary: run at 23:30 (default) in Asia/Bangkok
    cron.schedule(SALES_SYNC_CRON, async () => {
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
    });

    // Retry window: every 30 mins from 00:00-05:30 (Thai time) if previous day is pending.
    cron.schedule(SALES_SYNC_RETRY_CRON, async () => {
        try {
            const retryTargetDate = getPreviousDateStringInTimezone(SALES_SYNC_TIMEZONE);
            const status = await readStatus();
            if (!shouldRunSalesSyncRetry(status, retryTargetDate)) return;
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
    });

    // Final retry at 06:00 (Thai time). If still fail, mark as failed_window for dashboard alert.
    cron.schedule(SALES_SYNC_RETRY_FINAL_CRON, async () => {
        try {
            const retryTargetDate = getPreviousDateStringInTimezone(SALES_SYNC_TIMEZONE);
            const status = await readStatus();
            if (!shouldRunSalesSyncRetry(status, retryTargetDate)) return;
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
    });

    console.log(
        `[Cron] Sales sync schedules: primary=${SALES_SYNC_CRON}, retry=${SALES_SYNC_RETRY_CRON}, final=${SALES_SYNC_RETRY_FINAL_CRON}, timezone=${SALES_SYNC_TIMEZONE}`
    );
};
