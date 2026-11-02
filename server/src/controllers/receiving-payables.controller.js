import pool from '../config/database.js';
import * as model from '../models/receiving-payables.model.js';
import { handleReceivingError } from './receiving-documents.controller.js';

// Owner 2026-11-02 ระบบรวบรวมเจ้าหนี้. Permission is checked before the lazy schema ensure so staff never trigger DDL.
const endpoint = (action, status = 200) => async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    model.assertPayablesUser(req.user);
    await model.ensurePayablesTables();
    return res.status(status).json({ success: true, data: await action(req) });
  } catch (error) { return handleReceivingError(error, res, next, req); }
};
const input = req => ({ user: req.user, id: req.params.id });
export const summary = endpoint(req => model.summary(pool, { user: req.user, query: req.query }));
export const list = endpoint(req => model.listBills(pool, { user: req.user, query: req.query }));
export const detail = endpoint(req => model.getBill(pool, input(req)));
export const create = endpoint(req => model.createBill(pool, { user: req.user, body: req.body }), 201);
export const upload = endpoint(req => model.uploadPage(pool, { ...input(req), body: req.body }), 201);
export const read = endpoint(req => model.readBill(pool, input(req)));
export const update = endpoint(req => model.updateBill(pool, { ...input(req), body: req.body }));
export const remove = endpoint(req => model.voidBill(pool, input(req)));
export const image = async (req, res, next) => {
  try {
    model.assertPayablesUser(req.user);
    await model.ensurePayablesTables();
    const { mime, data } = await model.pageImage(pool, { ...input(req), page: req.params.page });
    res.set('Cache-Control', 'private, no-store');
    res.set('Content-Type', mime);
    return res.send(data);
  } catch (error) { return handleReceivingError(error, res, next, req); }
};
