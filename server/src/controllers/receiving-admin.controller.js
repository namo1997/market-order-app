import pool from '../config/database.js';
import { listLedger, ledgerOptions, ledgerDetail } from '../models/receiving-admin.model.js';
import { handleReceivingError } from './receiving-documents.controller.js';
const endpoint = action => async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json({ success: true, data: await action(req) }); }
  catch (error) { return handleReceivingError(error, res, next, req); }
};
export const list = endpoint(req => listLedger(pool, { user: req.user, query: req.query }));
export const options = endpoint(req => ledgerOptions(pool, { user: req.user }));
export const detail = endpoint(req => ledgerDetail(pool, { user: req.user, id: req.params.id }));
