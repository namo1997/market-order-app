// Isolated, read-only preview of the new report using the configured Railway
// service. Never import server.js: its startup maintenance would mutate data.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOverviewHandler } from '../server/src/receiptsOverview.js';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const vars = service => JSON.parse(execFileSync('railway', ['variables','--service',service,'--environment','production','--json'], { encoding:'utf8' }));
const appVars = vars('general-cashflow');
const dbVars = vars('MySQL-rluT');
const dbUrl = new URL(dbVars.MYSQL_PUBLIC_URL); dbUrl.pathname = `/${appVars.CASHFLOW_DB_NAME}`;
const pool = mysql.createPool({ uri:dbUrl.toString(), dateStrings:true, connectionLimit:3 });
const app = express();
const upstream = 'https://general-cashflow-production.up.railway.app';
app.use(express.json());
app.get('/health', (_req,res) => res.json({ ready:true, success:true, build:{commit:process.env.CASHFLOW_BUILD_COMMIT || 'development'} }));
app.get('/api/reports/receipts-overview', (req,res,next) => {
  try { const user=jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /,''),appVars.CASHFLOW_JWT_SECRET || 'cashflow-local-secret');
    if(!['admin','auditor','recorder'].includes(user.role)) return res.sendStatus(403);
    next();
  } catch { res.sendStatus(401); }
}, createOverviewHandler(pool));
app.use('/api', async (req,res) => {
  const read = req.method === 'GET' && /^\/(auth\/|branches|payment-channels|receiving-accounts|daily-receipts|attachments)/.test(req.url);
  const login = req.method === 'POST' && req.path === '/auth/login';
  if(!read && !login) return res.status(403).json({ message:'Read-only preview: writes disabled' });
  try { const response=await fetch(`${upstream}/api${req.url}`,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.authorization ? {Authorization:req.headers.authorization} : {})},body:login?JSON.stringify(req.body):undefined,signal:AbortSignal.timeout(30000)});
    res.status(response.status); for(const key of ['content-type','content-disposition']) if(response.headers.has(key)) res.set(key,response.headers.get(key));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch { res.status(502).json({message:'Preview source unavailable'}); }
});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client/dist');
app.use(express.static(root)); app.get('*',(_req,res)=>res.sendFile(path.join(root,'index.html')));
app.use((err,_req,res,_next)=>res.status(err.statusCode || 500).json({message:err.message}));
const server=app.listen(8111,'127.0.0.1',()=>console.log('Read-only overview preview: http://127.0.0.1:8111/?view=overview'));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close();pool.end().finally(()=>process.exit());});
