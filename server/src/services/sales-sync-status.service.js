import { randomUUID } from 'node:crypto';

export const SALES_SYNC_STATUS_KEY = 'sales_sync_retry_status';

const boundedText = (value, limit) => value == null ? null : String(value).slice(0, limit);
const finiteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

// Keep the existing response envelope, but never copy unbounded result arrays into TEXT.
export const summarizeSalesSyncResult = (result) => {
    const data = result?.data || {};
    const summary = {
        start: boundedText(data.start, 32),
        end: boundedText(data.end, 32),
        branch_id: data.branch_id == null ? null : finiteNumber(data.branch_id),
        dry_run: data.dry_run === true
    };
    for (const key of [
        'planned_deductions', 'planned_quantity', 'applied_deductions',
        'applied_quantity', 'skipped_existing', 'skipped_legacy_daily'
    ]) {
        summary[key] = finiteNumber(data[key]);
    }
    for (const key of [
        'unresolved_items', 'missing_recipes', 'missing_conversions', 'missing_branch_mapping'
    ]) {
        summary[`${key}_count`] = Array.isArray(data[key]) ? data[key].length : 0;
    }
    return { success: result?.success === true, data: summary };
};

export const parseSalesSyncStatus = (raw) => {
    try {
        const status = JSON.parse(String(raw || ''));
        return status && typeof status === 'object' && !Array.isArray(status) ? status : null;
    } catch {
        return null;
    }
};

export const shouldRunSalesSyncRetry = (status, targetDate) =>
    status?.target_date === targetDate && status.state === 'pending';

// Dependencies are explicit so failures can be exercised without connecting to production.
export const createSalesSyncRunner = ({
    runSync, settings, runs, timezone, logger = console,
    now = () => new Date(), createRunId = randomUUID
}) => {
    const inFlight = new Map();

    const readStatus = async () => parseSalesSyncStatus(
        await settings.getSetting(SALES_SYNC_STATUS_KEY, '')
    );

    const buildStatus = ({ targetDate, source, state, runId = null,
        result = null, failureCount = 0, error = null, finalizeOnFail = false }) => ({
        state,
        target_date: targetDate,
        source: boundedText(source, 32),
        timezone,
        last_attempt_at: now().toISOString(),
        failure_count: failureCount,
        last_error: boundedText(error?.message || (error ? String(error) : null), 512),
        message: state === 'success'
            ? 'ตัดสต็อกขายอัตโนมัติสำเร็จ'
            : finalizeOnFail
                ? 'ดึงตัดสต็อกขายอัตโนมัติไม่สำเร็จภายในช่วง retry'
                : 'ดึงตัดสต็อกขายอัตโนมัติไม่สำเร็จ กำลัง retry ทุก 30 นาที',
        next_retry_at: state === 'pending' ? `อีก 30 นาที (จนถึง 06:00 ${timezone})` : null,
        run_id: runId,
        last_result: result
    });

    const writeStatus = (status) => settings.setSetting(
        SALES_SYNC_STATUS_KEY, JSON.stringify(status)
    );

    const finishSuccess = async ({ targetDate, source, completion, result = null }) => {
        // Completion is durable before these best-effort writes. Neither failure is a sync failure.
        const persistenceErrors = [];
        if (result) {
            try {
                await runs.archiveResult(completion.run_id, result);
            } catch (error) {
                persistenceErrors.push('result');
                logger.error(`[Cron] Sales sync result archive failed date=${targetDate} run=${completion.run_id} code=${error.code || 'UNKNOWN'}`);
            }
        }
        try {
            await writeStatus(buildStatus({
                targetDate, source, state: 'success', runId: completion.run_id,
                result: completion.summary
            }));
        } catch (error) {
            persistenceErrors.push('status');
            logger.error(`[Cron] Sales sync status write failed after success date=${targetDate} run=${completion.run_id} code=${error.code || 'UNKNOWN'}`);
        }
        return { success: true, result: result || completion.summary,
            runId: completion.run_id, persistenceErrors };
    };

    const execute = async ({ targetDate, source, userId, finalizeOnFail = false }) => {
        await runs.ensureTable();
        // Check the journal even when the old setting still says pending (including after restart).
        const completed = await runs.findCompletion(targetDate);
        if (completed) return finishSuccess({ targetDate, source, completion: completed });

        const currentStatus = await readStatus();
        const previousFailureCount = currentStatus?.target_date === targetDate
            ? finiteNumber(currentStatus.failure_count) : 0;
        const runId = createRunId();
        let result;
        let completionRecorded = false;
        try {
            result = await runSync({
                dateString: targetDate, userId, source,
                recordCompletion: async (connection, fullResult) => {
                    await runs.recordCompletion(connection, {
                        runId, targetDate, source, result: fullResult
                    });
                    completionRecorded = true;
                }
            });
            if (result?.success !== true) throw new Error('Sales sync did not return success');
            if (!completionRecorded) throw new Error('Sales sync completion was not recorded');
        } catch (error) {
            // A lost response after COMMIT must not change an already completed day to pending.
            // If this read fails, propagate it and leave the retry state untouched.
            const recovered = await runs.findCompletion(targetDate);
            if (recovered) return finishSuccess({ targetDate, source, completion: recovered });
            logger.error(`[Cron] Sales sync failed (${source}) date=${targetDate} code=${error.code || 'SYNC_FAILED'}`);
            await writeStatus(buildStatus({
                targetDate, source, state: finalizeOnFail ? 'failed_window' : 'pending',
                failureCount: previousFailureCount + 1, error, finalizeOnFail
            }));
            return { success: false, error };
        }

        const completion = { run_id: runId, summary: summarizeSalesSyncResult(result) };
        logger.log(`[Cron] Sales sync success (${source}) date=${targetDate} run=${runId}`,
            JSON.stringify(completion.summary));
        return finishSuccess({ targetDate, source, completion, result });
    };

    const attempt = (options) => {
        if (inFlight.has(options.targetDate)) return inFlight.get(options.targetDate);
        const promise = execute(options).finally(() => inFlight.delete(options.targetDate));
        inFlight.set(options.targetDate, promise);
        return promise;
    };

    return { attempt, readStatus };
};
