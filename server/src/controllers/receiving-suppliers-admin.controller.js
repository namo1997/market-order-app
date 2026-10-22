import * as products from '../models/receiving-supplier-products.model.js';
import pool from '../config/database.js';
import * as model from '../models/receiving-suppliers-admin.model.js';
import * as customers from '../models/receiving-supplier-customers.model.js';
import { ensureReceivingDocumentsTables } from '../models/receiving-documents-schema.js';
import { handleReceivingError } from './receiving-documents.controller.js';

// Permission is checked before the lazy schema ensure so staff never trigger DDL.
const endpoint = (action, status = 200) => async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    model.assertSupplierManager(req.user);
    await ensureReceivingDocumentsTables();
    return res.status(status).json({ success: true, data: await action(req) });
  } catch (error) { return handleReceivingError(error, res, next, req); }
};
const input = req => ({ db: pool, user: req.user, key: req.params.key, aliasId: req.params.aliasId });
export const list = endpoint(req => model.listSuppliers(pool, { user: req.user, query: req.query }));
export const detail = endpoint(req => model.supplierDetail(pool, input(req)));
export const productSearch = endpoint(req => model.searchSupplierProducts(pool, { ...input(req), query: req.query }));
export const saveProfile = endpoint(req => model.updateSupplierProfile(pool, { ...input(req), body: req.body }));
export const createAlias = endpoint(req => model.createSupplierAlias(pool, { ...input(req), body: req.body }), 201);
export const updateAlias = endpoint(req => model.updateSupplierAlias(pool, { ...input(req), body: req.body }));
export const disableAlias = endpoint(req => model.setSupplierAliasActive(pool, { ...input(req), active: false }));
export const enableAlias = endpoint(req => model.setSupplierAliasActive(pool, { ...input(req), active: true }));
export const listCustomerNames = endpoint(req => customers.listCustomerNames(pool, input(req)));
export const createCustomerName = endpoint(req => customers.createCustomerName(pool, { ...input(req), body: req.body }), 201);
export const disableCustomerName = endpoint(req => customers.setCustomerNameActive(pool, { ...input(req), id: req.params.id, active: false }));
export const enableCustomerName = endpoint(req => customers.setCustomerNameActive(pool, { ...input(req), id: req.params.id, active: true }));
// Body-parser failures (bad JSON, too large) become the standard 422/413 envelope.
export const safeError = (error, req, res, next) => handleReceivingError(error, res, next, req);

export const productOptions = endpoint(req => products.supplierProductOptions(pool, input(req)));
export const previewProducts = endpoint(req => products.previewSupplierProducts(pool, { ...input(req), body: req.body }));
export const createProducts = endpoint(async req => {
  await products.prepareSupplierProducts();
  return products.importSupplierProducts(pool, { ...input(req), body: req.body });
}, 201);
