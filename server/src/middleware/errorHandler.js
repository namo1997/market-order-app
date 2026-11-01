// Error handling middleware
export const errorHandler = (err, req, res, next) => {
  // stack trace เก็บไว้ใน log ฝั่ง server เท่านั้น ไม่ส่งกลับไปให้ client
  console.error('Error:', err);

  // Default error (รองรับทั้ง err.statusCode และ err.status)
  const rawStatus = Number(err?.statusCode ?? err?.status);
  let statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  let message = err?.message || 'Internal Server Error';

  // MySQL errors
  if (err?.code === 'ER_DUP_ENTRY') {
    statusCode = 400;
    message = 'Duplicate entry. This record already exists.';
  } else if (err?.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Invalid reference. Related record does not exist.';
  } else if (err?.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON body';
  }

  // JWT errors
  if (err?.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err?.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // ไม่เปิดเผยรายละเอียด SQL/ภายในให้ client เมื่อเป็น error 500 จากฐานข้อมูล
  if (statusCode >= 500 && (err?.sqlMessage || err?.sql)) {
    message = 'Internal Server Error';
  }

  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json({
    success: false,
    message
  });
};

// 404 handler
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
};
