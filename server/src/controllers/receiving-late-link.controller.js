import { lateLinkProductSearch, linkReceivedLineProduct } from '../models/receiving-late-link.js';
import { handleReceivingError } from './receiving-documents.controller.js';

// Owner 2026-10-24 "รับไปก่อนแล้วตามหลัง": accounting links a product to a line received before it existed.
const endpoint = action => async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json({ success: true, data: await action(req) }); }
  catch (error) { return handleReceivingError(error, res, next, req); }
};
export const productSearch = endpoint(req => lateLinkProductSearch({ user: req.user, documentId: req.params.id, q: req.query?.q }));
export const linkProduct = endpoint(req => linkReceivedLineProduct({ user: req.user, documentId: req.params.id, lineId: req.params.lineId, body: req.body || {} }));
