import {loadConfig} from '../src/config.mjs';
import {createService} from '../src/service.mjs';

const config = loadConfig();
const client = config.clients.find(row => row.name === process.env.BUSINESS_VERIFY_CLIENT);
if (!client) throw new Error('BUSINESS_VERIFY_CLIENT must name a configured client');
const day = new Date(Date.now() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
const result = await createService(config, client).overview({branches: client.branches, from: process.env.BUSINESS_VERIFY_FROM || day, to: process.env.BUSINESS_VERIFY_TO || day});
const connected_all_sources = result.sources.length === client.branches.length * 4 && result.sources.every(row => row.status !== 'UNAVAILABLE');
const report = {generated_at: result.generated_at, status: result.status, connected_all_sources, requested: result.requested, sources: result.sources.map(row => ({source: row.source, branch: row.branch, status: row.status, reason: row.reason || null})), missing_coverage: result.missing_coverage};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!connected_all_sources) process.exitCode = 1;
