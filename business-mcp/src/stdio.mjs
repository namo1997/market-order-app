import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {loadConfig} from './config.mjs';
import {createBusinessServer} from './server.mjs';

const config = loadConfig();
const client = config.clients.find(item => item.name === process.env.BUSINESS_STDIO_CLIENT);
if (!client) throw new Error('BUSINESS_STDIO_CLIENT must name a configured client');
await serveStdio(() => createBusinessServer(config, client));
