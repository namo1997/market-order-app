import * as model from '../models/receiving-documents.model.js';
import { createReceivingError, ERROR_STATUS_BY_CODE } from '../services/receiving-ocr.service.js';

const KNOWN_ERROR_CODES = new Set(Object.keys(ERROR_STATUS_BY_CODE));

// แก้ข้อ 6, R2-5, R2-10, R2-11:
// - แปลง JSON เสียจาก body-parser เป็น 422 VALIDATION_FAILED
// - แปลง ER_NO_SUCH_TABLE เป็น 503 RECEIVING_NOT_READY
// - แปลง RATE_LIMITED เป็น 429 RATE_LIMITED
// - ไม่ส่ง error.message ดิบเมื่อเกิด 500 และบันทึก docId + stack (โดยไม่ log body/base64)
export const handleReceivingError = (error, res, _next, req = null) => {
  if (!error) return;

  if (error.type === 'entity.too.large' || error.status === 413 || error.statusCode === 413) {
    return res.status(413).json({
      success: false,
      code: 'IMAGE_TOO_LARGE',
      message:
        error.code === 'IMAGE_TOO_LARGE' && error.message
          ? error.message
          : 'ขนาดรูปภาพเกิน 3 MB กรุณาย่อรูปก่อนส่ง'
    });
  }

  // R2-11: JSON เสียจาก body-parser -> 422 VALIDATION_FAILED
  if (
    error.type === 'entity.parse.failed' ||
    (error instanceof SyntaxError &&
      (error.status === 400 || error.statusCode === 400 || 'body' in error))
  ) {
    return res.status(422).json({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง'
    });
  }

  // R2-5: ตารางใหม่ยังไม่ถูกสร้างบนฐานข้อมูล -> 503 RECEIVING_NOT_READY
  if (
    error.code === 'ER_NO_SUCH_TABLE' ||
    error.errno === 1146 ||
    error.code === 'RECEIVING_NOT_READY'
  ) {
    return res.status(503).json({
      success: false,
      code: 'RECEIVING_NOT_READY',
      message:
        error.code === 'RECEIVING_NOT_READY' && error.message
          ? error.message
          : 'ระบบเอกสารรับสินค้ายังไม่พร้อมใช้งาน (ยังไม่ได้สร้างตารางฐานข้อมูล)'
    });
  }

  const isKnownApplicationError =
    Boolean(error.code && KNOWN_ERROR_CODES.has(error.code)) ||
    [401, 403, 404, 409, 413, 422, 429, 503].includes(Number(error.statusCode));

  if (!isKnownApplicationError) {
    console.error('[receiving-documents] Internal error:', {
      docId: req?.params?.id ?? null,
      code: error.code || null,
      name: error.name || 'Error',
      stack: error.stack || String(error)
    });
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง'
    });
  }

  const code =
    error.code && KNOWN_ERROR_CODES.has(error.code)
      ? error.code
      : error.statusCode === 401
        ? 'UNAUTHORIZED'
        : error.statusCode === 404
          ? 'NOT_FOUND'
          : error.statusCode === 403
            ? 'FORBIDDEN'
            : error.statusCode === 409
              ? 'NOT_DRAFT'
              : error.statusCode === 429
                ? 'RATE_LIMITED'
                : error.statusCode === 503
                  ? 'OCR_UNAVAILABLE'
                  : 'VALIDATION_FAILED';

  const statusCode = ERROR_STATUS_BY_CODE[code] || error.statusCode || 422;
  const message = String(error.message || 'คำขอไม่ถูกต้อง');

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
      departmentId: req.query?.department_id,
      scope: req.query?.scope
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
      departmentId: req.query?.department_id,
      scope: req.query?.scope
    });
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
  }
};

// GET /:id/signatures/:role — authenticated binary, never cached or logged.
export const getSignatureBinary = async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const { buffer } = await model.getDocumentSignatureBinary({
      user: req.user,
      documentId: req.params?.id,
      role: req.params?.role
    });
    res.set('Content-Type', 'image/png');
    res.set('Content-Length', String(buffer.length));
    return res.send(buffer);
  } catch (error) {
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    return handleReceivingError(error, res, next, req);
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
    res.set('Cache-Control', 'private, no-store');
    return res.send(image.buffer);
  } catch (error) {
    return handleReceivingError(error, res, next, req);
  }
};

export const saveCount = async (req, res, next) => {
  try { return res.json({ success: true, data: await model.saveBlindCount({ user: req.user,
    documentId: req.params?.id, body: req.body || {} }) }); }
  catch (error) { return handleReceivingError(error, res, next, req); }
};

// Read-only, authenticated, scope-filtered catalog for receipts without orders.
export const searchSuppliers = async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json({ success: true, data: await model.searchReceivingSuppliers({ user: req.user, filters: req.query }) }); }
  catch (error) { return handleReceivingError(error, res, next, req); }
};
export const supplierProducts = async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json({ success: true, data: await model.receivingSupplierProducts({ user: req.user, supplierKey: req.query?.supplier_key, filters: req.query }) }); }
  catch (error) { return handleReceivingError(error, res, next, req); }
};
