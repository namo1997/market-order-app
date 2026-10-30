import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { getPoolStats } from './config/database.js';

// โหลด environment variables
dotenv.config();

// Import routes
import authRoutes from './routes/auth.routes.js';
import productsRoutes from './routes/products.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import adminRoutes from './routes/admin.routes.js';
import usersRoutes from './routes/users.routes.js';
import unitsRoutes from './routes/units.routes.js';
import suppliersRoutes from './routes/suppliers.routes.js';
import productGroupsRoutes from './routes/product-groups.routes.js';
import supplierMastersRoutes from './routes/supplier-masters.routes.js';
import branchesRoutes from './routes/branches.routes.js';
import departmentsRoutes from './routes/departments.routes.js';
import stockCheckRoutes from './routes/stock-check.routes.js';
import recipesRoutes from './routes/recipes.routes.js';
import unitConversionsRoutes from './routes/unit-conversions.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import aiRoutes from './routes/ai.routes.js';
import departmentProductsRoutes from './routes/department-products.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import withdrawRoutes from './routes/withdraw.routes.js';
import purchaseOrderRoutes from './routes/purchase-order.routes.js';
import productUnitSettingsRoutes from './routes/product-unit-settings.routes.js';
import generalPurchaseRoutes from './routes/general-purchase.routes.js';
import generalPurchaseAuthRoutes from './routes/general-purchase-auth.routes.js';
import accountingExportRoutes from './routes/accounting-export.routes.js';
import employeeRefsRoutes from './routes/employee-refs.routes.js';
import discordRoutes from './routes/discord.routes.js';
import lineChatbotRoutes from './routes/line-chatbot.routes.js';
import publicRoutes from './routes/public.routes.js';
import { initSyncJob } from './cron/syncJob.js';

// สร้าง Express app
const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOriginSet = new Set(corsOrigins);
const allowLanCors =
  process.env.ALLOW_LAN_CORS === 'true' || process.env.NODE_ENV !== 'production';

const isPrivateLanOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    if (!host) return false;
    return (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch (error) {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Requests from tools (curl/postman) may not send origin
      if (!origin) {
        callback(null, true);
        return;
      }

      if (corsOriginSet.has(origin) || (allowLanCors && isPrivateLanOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true
  })
);

// Discord interactions must read raw body for signature verification.
app.use('/api/discord', discordRoutes);
// LINE webhook must read raw body for signature verification.
app.use('/api/line', lineChatbotRoutes);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

const HEALTH_DB_TIMEOUT_MS = Number(process.env.HEALTH_DB_TIMEOUT_MS || 5000);

app.get('/health/db', async (req, res) => {
  const startedAt = Date.now();
  let timer;
  try {
    // health check ต้องตอบเร็วเสมอ แม้ DB ค้างหรือ pool เต็ม
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Health check timed out');
          error.code = 'HEALTH_CHECK_TIMEOUT';
          reject(error);
        }, HEALTH_DB_TIMEOUT_MS);
      })
    ]);
    return res.json({
      success: true,
      message: 'Database is reachable',
      latencyMs: Date.now() - startedAt,
      pool: getPoolStats(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: 'Database is unavailable',
      errorCode: error?.code || null,
      pool: getPoolStats(),
      timestamp: new Date().toISOString()
    });
  } finally {
    clearTimeout(timer);
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stock-check', stockCheckRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/unit-conversions', unitConversionsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/department-products', departmentProductsRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/product-unit-settings', productUnitSettingsRoutes);
app.use('/api/general-purchase-auth', generalPurchaseAuthRoutes);
app.use('/api/general-purchase', generalPurchaseRoutes);
app.use('/api/accounting-export', accountingExportRoutes);
app.use('/api/employee-refs', employeeRefsRoutes);

// Master Data Routes (Admin Only checks inside routes)
app.use('/api/users', usersRoutes);
app.use('/api/units', unitsRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/product-groups', productGroupsRoutes);
app.use('/api/supplier-masters', supplierMastersRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/departments', departmentsRoutes);

const serveClient = process.env.SERVE_CLIENT === 'true';

if (serveClient) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.join(__dirname, '../../client/dist');
  const clientAssets = path.join(clientDist, 'assets');

  // Serve hashed build assets with long cache
  app.use('/assets', express.static(clientAssets, {
    immutable: true,
    maxAge: '1y'
  }));

  // Serve other static files (do not auto-serve index.html)
  app.use(express.static(clientDist, {
    index: false,
    maxAge: '1h'
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    // For unknown file paths (e.g. stale chunk names), return 404 instead of index.html
    if (path.extname(req.path)) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Prevent stale shell after deployment
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Fresh Market Ordering System API',
      endpoints: {
        health: '/health',
        docs: 'See README.md'
      }
    });
  });
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize scheduled cron jobs
initSyncJob();

// Start server
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// keep-alive ต้องนานกว่า idle timeout ของ proxy/load balancer (เช่น Railway) ไม่งั้นจะเจอ 502 เป็นระยะ
server.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 65000);
server.headersTimeout = server.keepAliveTimeout + 5000;

// ---- Process-level safety net ----
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);

const shutdown = (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal} received, closing HTTP server...`);

  const forceExit = setTimeout(() => {
    console.error('[Shutdown] Timed out waiting for in-flight requests, forcing exit');
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // หยุดรับ request ใหม่ รอ request ที่กำลังทำ (เช่น transaction รับของ) ให้เสร็จก่อนปิด DB
  server.close(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error('[Shutdown] Failed to close DB pool:', error?.message || error);
    }
    console.log('[Shutdown] Completed');
    process.exit(exitCode);
  });
  server.closeIdleConnections?.();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Promise ที่ reject โดยไม่มีใคร catch (เช่น แจ้งเตือน LINE/Discord แบบ fire-and-forget)
// Node 15+ จะ kill process ทันที -> log ไว้แล้วให้ระบบทำงานต่อ
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// exception ที่หลุดถึงระดับ process หมายถึง state อาจเสียหาย -> ปิดอย่างนุ่มนวลแล้วให้ platform restart
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
  shutdown('uncaughtException', 1);
});

export default app;
