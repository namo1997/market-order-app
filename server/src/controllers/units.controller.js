import * as unitModel from '../models/unit.model.js';
import {
    normalizeUnitInput, findUnitNameConflict, buildUnitNameConflictMessage,
    buildUnitDeleteBlockedMessage
} from '../utils/unit-master-rules.js';

const notFound = (res) => res.status(404).json({ success: false, message: 'ไม่พบหน่วยนับที่ต้องการ' });
const sendConflict = (res, unit) => res.status(409).json({
    success: false,
    code: Number(unit?.is_active) === 0 ? 'UNIT_NAME_INACTIVE' : 'UNIT_NAME_EXISTS',
    message: unit ? buildUnitNameConflictMessage(unit) : 'มีชื่อหน่วยนับนี้อยู่แล้ว กรุณาตรวจสอบรายการอีกครั้ง',
    unit: unit || null
});

const handleError = async (res, error, name, excludeId) => {
    if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
        // ป้องกันการเพิ่ม/แก้ไขชื่อเดียวกันพร้อมกัน รวมการเทียบชื่อด้วย collation ของ MySQL
        try {
            const matches = await unitModel.findUnitsByName(name);
            return sendConflict(res, matches.find((unit) => String(unit.id) !== String(excludeId)));
        } catch {
            return sendConflict(res, null);
        }
    }
    return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาดในการจัดการหน่วยนับ กรุณาลองอีกครั้ง' });
};

export const getAllUnits = async (req, res) => {
    const includeInactive = req.query.include_inactive === '1';
    if (includeInactive && !['admin', 'super_admin'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่ดูหน่วยที่ลบแล้วได้' });
    }
    try {
        const units = req.query.with_usage === '1' || includeInactive
            ? await unitModel.listUnitsWithUsage({ includeInactive })
            : await unitModel.getAllUnits();
        res.json({ success: true, data: units });
    } catch (error) {
        return handleError(res, error);
    }
};

export const createUnit = async (req, res) => {
    const { value, error: validationError } = normalizeUnitInput(req.body);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    try {
        const matches = await unitModel.findUnitsByName(value.name);
        const conflict = findUnitNameConflict(matches, value.name) || matches[0];
        if (conflict) return sendConflict(res, conflict);
        const unit = await unitModel.createUnit(value);
        res.status(201).json({ success: true, data: unit });
    } catch (error) {
        return handleError(res, error, value.name);
    }
};

export const updateUnit = async (req, res) => {
    const { value, error: validationError } = normalizeUnitInput(req.body);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const { id } = req.params;
    try {
        if (!await unitModel.getUnitById(id)) return notFound(res);
        const matches = await unitModel.findUnitsByName(value.name);
        const conflict = findUnitNameConflict(matches, value.name, id)
            || matches.find((unit) => String(unit.id) !== String(id));
        if (conflict) return sendConflict(res, conflict);
        const unit = await unitModel.updateUnit(id, value);
        if (!unit) return notFound(res);
        res.json({ success: true, data: unit });
    } catch (error) {
        return handleError(res, error, value.name, id);
    }
};

export const deleteUnit = async (req, res) => {
    try {
        const { id } = req.params;
        const unit = await unitModel.getUnitById(id);
        if (!unit) return notFound(res);
        const usage = await unitModel.countUnitReferences(id);
        const message = buildUnitDeleteBlockedMessage(unit.name, usage);
        if (message) return res.status(409).json({ success: false, code: 'UNIT_IN_USE', message, usage });
        await unitModel.deleteUnit(id);
        res.json({ success: true, message: 'ลบหน่วยนับแล้ว' });
    } catch (error) {
        return handleError(res, error);
    }
};

export const restoreUnit = async (req, res) => {
    let name;
    try {
        const { id } = req.params;
        const unit = await unitModel.getUnitById(id);
        if (!unit) return notFound(res);
        name = unit.name;
        const matches = (await unitModel.findUnitsByName(name)).filter((item) => Number(item.is_active) === 1);
        const conflict = findUnitNameConflict(matches, name, id)
            || matches.find((item) => String(item.id) !== String(id));
        if (conflict) return sendConflict(res, conflict);
        const restored = await unitModel.restoreUnit(id);
        if (!restored) return notFound(res);
        res.json({ success: true, data: restored, message: 'กู้คืนหน่วยนับแล้ว' });
    } catch (error) {
        return handleError(res, error, name, req.params.id);
    }
};
