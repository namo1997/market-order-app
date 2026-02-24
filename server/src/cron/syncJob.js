import cron from 'node-cron';
import { syncUsageToInventory } from '../controllers/recipe.controller.js';

export const initSyncJob = () => {
    // schedule time to run at 01:00 AM every day
    // Syntax: minute hour dayOfMonth month dayOfWeek
    cron.schedule('0 1 * * *', async () => {
        console.log(`[Cron] Executing daily sales sync to inventory at ${new Date().toISOString()}`);

        // Create a date representing yesterday since we want to sync yesterday's sales
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateString = yesterday.toISOString().split('T')[0];

        // Mock Express req and res objects
        const req = {
            body: {
                date: dateString,
                start: dateString,
                end: dateString,
                dry_run: false
            },
            query: {},
            user: {
                id: 'system_cron' // Identifying the user as a system process
            }
        };

        const res = {
            status: (code) => {
                return {
                    json: (data) => {
                        console.log(`[Cron] Sync Completed with status: ${code}`, JSON.stringify(data));
                    }
                };
            },
            json: (data) => {
                console.log(`[Cron] Sync Completed successfully.`, JSON.stringify(data));
            }
        };

        const next = (error) => {
            console.error(`[Cron] Sync failed with error:`, error);
        };

        try {
            await syncUsageToInventory(req, res, next);
        } catch (error) {
            console.error(`[Cron] Unexpected error during sync:`, error);
        }
    });

    console.log('[Cron] Daily sales sync job scheduled (01:00 AM).');
};
