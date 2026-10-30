import { isDatabaseUnavailableError } from '../config/database.js';

// Error handling middleware
export const errorHandler = (err, req, res, next) => {
  console.error(`Error: ${req.method} ${req.originalUrl}`, err);

  if (res.headersSent) {
    return next(err);
  }

  // Default error
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Body parser errors (JSON เสีย / payload ใหญ่เกิน)
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON body';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body too large';
  }

  // MySQL errors
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 400;
    message = 'Duplicate entry. This record already exists.';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Invalid reference. Related record does not exist.';
  } else if (isDatabaseUnavailableError(err)) {
    // DB ล่ม / pool เต็ม / query timeout -> 503 ให้ client retry ได้ แทน 500
    statusCode = 503;
    message = 'ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง';
    res.set('Retry-After', '5');
  } else if (statusCode >= 500 && (err.sqlMessage || err.sql) && process.env.NODE_ENV === 'production') {
    // ไม่ส่งรายละเอียด SQL/schema ออกไปให้ client ใน production
    message = 'Internal Server Error';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// 404 handler
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};
