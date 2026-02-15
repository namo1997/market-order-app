import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './config/database.js';

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

// สร้าง Express app
const app = express();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/health/db', async (req, res) => {
  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    return res.json({
      success: true,
      message: 'Database is reachable',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: 'Database is unavailable',
      errorCode: error?.code || null,
      timestamp: new Date().toISOString()
    });
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
app.use('/api/department-products', departmentProductsRoutes);
app.use('/api/inventory', inventoryRoutes);

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

  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
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

// Start server
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on http://${HOST}:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
