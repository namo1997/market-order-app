import * as model from '../models/receiving-documents.model.js';
import { ERROR_STATUS_BY_CODE } from '../services/receiving-ocr.service.js';

export const handleReceivingError = (error, res, next) => {
  if (!error) return;

  if (error.type === 'entity.too.large' || error.status === 413 || error.statusCode === 413) {
    return res.status(413).json({
      success: false,
      code: 'IMAGE_TOO_LARGE',
      message: error.message && error.code === 'IMAGE_TOO_LARGE'
        ? error.message
        : 'ขนาดรูปภาพเกิน 3 MB กรุณาย่อรูปก่อนส่ง'
    });
  }

  const code = error.code && ERROR_STATUS_BY_CODE[error.code]
    ? error.code
    : error.statusCode === 404
      ? 'NOT_FOUND'
      : error.statusCode === 403
        ? 'FORBIDDEN'
        : error.statusCode === 409
          ? 'NOT_DRAFT'
          : error.statusCode === 422 || error.statusCode === 400
            ? 'VALIDATION_FAILED'
            : error.statusCode === 503
              ? 'OCR_UNAVAILABLE'
              : 'INTERNAL_ERROR';

  const statusCode =
    ERROR_STATUS_BY_CODE[code] ||
    error.statusCode ||
    500;

  const message =
    error.message ||
    (statusCode === 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : 'คำขอไม่ถูกต้อง');

  return res.status(statusCode).json({
    success: false,
    code,
    message
  });
};

// 1. GET /expected?date=YYYY-MM-DD
export const getExpected = async (req, res, next) => {
  try {
    const data = await model.getExpectedItems({
      user: req.user,
      date: req.query?.date,
      branchId: req.query?.branch_id,
      departmentId: req.query?.department_id
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 2. POST /
export const createDocument = async (req, res, next) => {
  try {
    const { document, created } = await model.createReceivingDocument({
      user: req.user,
      body: req.body || {}
    });
    return res.status(created ? 201 : 200).json({
      success: true,
      data: document
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 3. POST /:id/images
export const uploadImage = async (req, res, next) => {
  try {
    const data = await model.uploadDocumentImage({
      user: req.user,
      documentId: req.params?.id,
      pageNo: req.body?.page_no,
      imageDataUrl: req.body?.image_data_url
    });
    return res.status(201).json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 4. POST /:id/ocr
export const runOcr = async (req, res, next) => {
  try {
    const data = await model.runDocumentOcr({
      user: req.user,
      documentId: req.params?.id
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 5a. GET /?date=&status=
export const listDocuments = async (req, res, next) => {
  try {
    const data = await model.listReceivingDocuments({
      user: req.user,
      date: req.query?.date,
      status: req.query?.status,
      branchId: req.query?.branch_id,
      departmentId: req.query?.department_id
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 5b. GET /:id
export const getDocumentById = async (req, res, next) => {
  try {
    const data = await model.getReceivingDocumentById({
      user: req.user,
      documentId: req.params?.id
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 6. PUT /:id
export const updateDocument = async (req, res, next) => {
  try {
    const data = await model.updateReceivingDocument({
      user: req.user,
      documentId: req.params?.id,
      body: req.body || {}
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 7. POST /:id/signatures
export const addSignature = async (req, res, next) => {
  try {
    const data = await model.saveDocumentSignature({
      user: req.user,
      documentId: req.params?.id,
      role: req.body?.role,
      imageDataUrl: req.body?.image_data_url,
      name: req.body?.name
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 8. POST /:id/confirm
export const confirmDocument = async (req, res, next) => {
  try {
    const data = await model.confirmReceivingDocument({
      user: req.user,
      documentId: req.params?.id,
      unmatchedOk: Boolean(req.body?.unmatched_ok)
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 9. POST /:id/void
export const voidDocument = async (req, res, next) => {
  try {
    const data = await model.voidReceivingDocument({
      user: req.user,
      documentId: req.params?.id,
      reason: req.body?.reason
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};

// 10. GET /:id/images/:imageId
export const getImageBinary = async (req, res, next) => {
  try {
    const image = await model.getDocumentImageBinary({
      user: req.user,
      documentId: req.params?.id,
      imageId: req.params?.imageId
    });
    res.set('Content-Type', image.mime);
    res.set('Content-Length', String(image.buffer.length));
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(image.buffer);
  } catch (error) {
    return handleReceivingError(error, res, next);
  }
};
