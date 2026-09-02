import 'dotenv/config';
import { initDatabase } from '../src/db.js';
import { rebuildCpAxtraMatches } from '../src/ai-worker.js';

const apply = process.argv.includes('--apply');

await initDatabase();
const result = await rebuildCpAxtraMatches({ apply });
console.log(JSON.stringify(result, null, 2));
