// Error handling middleware
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // MySQL errors
  if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 400;
    message = 'Duplicate entry. This record already exists.';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    statusCode = 400;
    message = 'Invalid reference. Related record does not exist.';
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
