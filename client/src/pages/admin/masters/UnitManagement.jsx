import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { DataTable } from '../../../components/common/DataTable';
import { Modal } from '../../../components/common/Modal';
import { Input } from '../../../components/common/Input';
import { BackToSettings } from '../../../components/common/BackToSettings';
import { masterAPI } from '../../../api/master';
import { downloadCsv } from '../../../utils/csv';
import {
    isUnitInactive, normalizeUnitText, unitNameKey, unitErrorMessage,
    unitUsageItems, unitDeleteReason, parseUnitImportCsv
} from '../../../utils/unit-management';

export const UnitManagement = () => {
    const [units, setUnits] = useState([]);
    const [includeInactive, setIncludeInactive] = useState(false);
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ name: '', abbreviation: '' });
    const [selectedId, setSelectedId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [listLoading, setListLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [pageError, setPageError] = useState('');
    const [formError, setFormError] = useState('');
    const [importResult, setImportResult] = useState(null);
    const fileInputRef = useRef(null);
    const requestRef = useRef(0);
    const includeInactiveRef = useRef(includeInactive);
    includeInactiveRef.current = includeInactive;
    const busy = loading || importing;

    const fetchUnits = async () => {
        const request = ++requestRef.current;
        setListLoading(true);
        setPageError('');
        try {
            const data = await masterAPI.getUnitsWithUsage({ includeInactive: includeInactiveRef.current });
            if (request === requestRef.current) setUnits(data);
        } catch (error) {
            if (request === requestRef.current) {
                setUnits([]);
                setPageError(unitErrorMessage(error, 'โหลดข้อมูลหน่วยนับไม่สำเร็จ'));
            }
        } finally {
            if (request === requestRef.current) setListLoading(false);
        }
    };

    useEffect(() => {
        fetchUnits();
        return () => { requestRef.current += 1; };
    }, [includeInactive]);

    const resetForm = () => {
        setFormData({ name: '', abbreviation: '' });
        setSelectedId(null);
        setFormError('');
    };
    const closeModal = () => { if (!loading) setIsModalOpen(false); };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setFormError('');
        try {
            if (selectedId) await masterAPI.updateUnit(selectedId, formData);
            else await masterAPI.createUnit(formData);
            setIsModalOpen(false);
            resetForm();
            await fetchUnits();
        } catch (error) {
            const conflict = error?.response?.data;
            if (!selectedId && conflict?.code === 'UNIT_NAME_INACTIVE' && conflict.unit?.id
                && confirm(`${conflict.message}\nต้องการกู้คืนหน่วยเดิมหรือไม่?`)) {
                try {
                    await masterAPI.restoreUnit(conflict.unit.id);
                    setIsModalOpen(false);
                    resetForm();
                    await fetchUnits();
                } catch (restoreError) {
                    setFormError(unitErrorMessage(restoreError, 'กู้คืนหน่วยนับไม่สำเร็จ'));
                }
            } else setFormError(unitErrorMessage(error, 'บันทึกหน่วยนับไม่สำเร็จ'));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (row) => {
        if (unitDeleteReason(row) || busy || !confirm(`คุณต้องการลบหน่วยนับ "${row.name}" ใช่หรือไม่?`)) return;
        setLoading(true);
        try {
            await masterAPI.deleteUnit(row.id);
        } catch (error) {
            alert(unitErrorMessage(error, 'ลบหน่วยนับไม่สำเร็จ'));
        } finally {
            await fetchUnits();
            setLoading(false);
        }
    };

    const handleRestore = async (row) => {
        if (busy || !confirm(`ต้องการกู้คืนหน่วยนับ "${row.name}" หรือไม่?`)) return;
        setLoading(true);
        try {
            await masterAPI.restoreUnit(row.id);
            await fetchUnits();
        } catch (error) {
            setPageError(unitErrorMessage(error, 'กู้คืนหน่วยนับไม่สำเร็จ'));
        } finally {
            setLoading(false);
        }
    };

    const openEdit = (row) => {
        setFormData({ name: row.name, abbreviation: row.abbreviation });
        setSelectedId(row.id);
        setFormError('');
        setIsModalOpen(true);
    };

    const handleDownloadData = () => {
        downloadCsv('units_data.csv', ['name', 'abbreviation'], units.map((unit) => [unit.name, unit.abbreviation]));
    };

    const handleImportFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || busy) return;
        setImporting(true);
        setImportResult(null);
        const result = { success: 0, skipped: 0, failed: 0, details: [] };
        try {
            const records = parseUnitImportCsv(await file.text());
            // โหลดรายการใหม่ก่อนนำเข้า ไม่ใช้ข้อมูลเก่าที่อาจค้างอยู่บนหน้า
            const activeUnits = await masterAPI.getUnits();
            const existing = new Set(activeUnits.map((unit) => unitNameKey(unit.name)));
            const seen = new Set();
            for (const { row, line } of records) {
                const payload = { name: normalizeUnitText(row.name), abbreviation: normalizeUnitText(row.abbreviation) };
                const key = unitNameKey(payload.name);
                const record = (status, reason) => {
                    result[status] += 1;
                    result.details.push({ line, name: payload.name, status, reason });
                };
                if (key && seen.has(key)) { record('skipped', 'ชื่อซ้ำในไฟล์'); continue; }
                if (existing.has(key)) { record('skipped', 'มีชื่อหน่วยนี้อยู่แล้ว'); continue; }
                if (key) seen.add(key);
                if (!payload.name || !payload.abbreviation) { record('failed', 'ต้องกรอกชื่อหน่วยนับและตัวย่อ'); continue; }
                if ([...payload.name].length > 50) { record('failed', 'ชื่อหน่วยนับเกิน 50 ตัวอักษร'); continue; }
                if ([...payload.abbreviation].length > 10) { record('failed', 'ตัวย่อเกิน 10 ตัวอักษร'); continue; }
                try {
                    await masterAPI.createUnit(payload);
                    existing.add(key);
                    record('success', 'เพิ่มหน่วยนับแล้ว');
                } catch (error) {
                    const data = error?.response?.data;
                    if (data?.code === 'UNIT_NAME_EXISTS') {
                        existing.add(key);
                        record('skipped', data.message);
                    } else record('failed', unitErrorMessage(error, 'เพิ่มหน่วยนับไม่สำเร็จ'));
                }
            }
            setImportResult({ ...result, message: records.length ? '' : 'ไม่พบแถวข้อมูลในไฟล์' });
        } catch (error) {
            setImportResult({ ...result, message: unitErrorMessage(error, 'นำเข้าไม่สำเร็จ') });
        } finally {
            await fetchUnits();
            setImporting(false);
        }
    };

    const query = search.trim().toLowerCase();
    const visibleUnits = units.filter((unit) => !query || [unit.name, unit.abbreviation]
        .some((value) => String(value || '').toLowerCase().includes(query)));
    const faded = (row) => isUnitInactive(row) ? 'opacity-50' : '';
    const columns = [
        { header: 'ชื่อหน่วยนับ', accessor: 'name', render: (row) => <span className={faded(row)}>{row.name}</span> },
        { header: 'ตัวย่อ', accessor: 'abbreviation', render: (row) => <span className={faded(row)}>{row.abbreviation}</span> },
        { header: 'ใช้อยู่', accessor: 'usage', wrap: true, render: (row) => {
            const items = unitUsageItems(row);
            return <div className={faded(row)}>
                {items.length ? <>
                    <div>{items[0].label} {items[0].count}</div>
                    {items.length > 1 && <div className="text-xs text-gray-500 mt-1">{items.slice(1).map(({ label, count }) => `${label} ${count}`).join(' · ')}</div>}
                </> : <span className="text-gray-400">ยังไม่มีการใช้</span>}
            </div>;
        } },
        ...(includeInactive ? [{ header: 'สถานะ', accessor: 'is_active', render: (row) =>
            <span className={isUnitInactive(row) ? 'text-gray-400' : 'text-green-700'}>{isUnitInactive(row) ? 'ลบแล้ว' : 'ใช้งาน'}</span>
        }] : [])
    ];

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <div className="mb-3"><BackToSettings /></div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <h1 className="text-2xl font-bold text-gray-900">จัดการหน่วยนับ</h1>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleDownloadData} disabled={busy || listLoading} className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">ดาวน์โหลดข้อมูล</button>
                        <button onClick={() => fileInputRef.current?.click()} disabled={busy || listLoading} className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">{importing ? 'กำลังนำเข้า...' : 'นำเข้า CSV'}</button>
                        <button onClick={() => { resetForm(); setIsModalOpen(true); }} disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">เพิ่มหน่วยนับ</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm mb-4">
                    <Link to="/admin/settings/product-units" className="text-blue-600 hover:underline">ตั้งค่าหน่วยสินค้า</Link>
                    <Link to="/admin/settings/unit-conversions" className="text-blue-600 hover:underline">ตั้งค่าแปลงหน่วย</Link>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
                    <div className="w-full sm:max-w-sm"><Input aria-label="ค้นหาชื่อหน่วยหรือตัวย่อ" placeholder="ค้นหาชื่อหน่วยหรือตัวย่อ" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" role="switch" checked={includeInactive} disabled={busy} onChange={(event) => setIncludeInactive(event.target.checked)} />
                        แสดงหน่วยที่ลบแล้ว
                    </label>
                </div>
                <p className="text-sm text-gray-500 mb-1">{listLoading ? 'กำลังโหลด...' : `แสดง ${visibleUnits.length} จาก ${units.length} หน่วย`}</p>
                <p className="text-sm text-gray-500 mb-3">ลบได้เฉพาะหน่วยที่ยังไม่มีการใช้ ถ้าต้องการเลิกใช้ ให้เปลี่ยนหน่วยของสินค้าก่อน</p>
                {pageError && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg mb-4">{pageError} <button onClick={fetchUnits} disabled={busy} className="underline">ลองอีกครั้ง</button></div>}
                {importResult && <div role="status" className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4 text-sm">
                    <p className="font-medium">ผลนำเข้า: สำเร็จ {importResult.success} · ข้าม {importResult.skipped} · ล้มเหลว {importResult.failed}</p>
                    {importResult.message && <p className="text-red-700 mt-2">{importResult.message}</p>}
                    {importResult.details.length > 0 && <details className="mt-2" open={importResult.failed > 0}>
                        <summary className="cursor-pointer">รายละเอียดแต่ละแถว</summary>
                        <ul className="mt-2 max-h-64 overflow-y-auto space-y-1 break-words">
                            {importResult.details.map((item) => <li key={item.line} className={item.status === 'failed' ? 'text-red-700' : 'text-gray-700'}>
                                แถว {item.line} {item.name ? `(${item.name})` : ''}: {item.status === 'success' ? 'สำเร็จ' : item.status === 'skipped' ? 'ข้าม' : 'ล้มเหลว'} — {item.reason}
                            </li>)}
                        </ul>
                    </details>}
                </div>}
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
                <DataTable columns={columns} data={visibleUnits} renderActions={(row) => {
                    const reason = unitDeleteReason(row);
                    const deleteDisabled = Boolean(reason) || busy || listLoading;
                    return isUnitInactive(row)
                        ? <button onClick={() => handleRestore(row)} disabled={busy || listLoading} className="text-blue-600 hover:text-blue-900 disabled:opacity-50">กู้คืน</button>
                        : <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                            <button onClick={() => openEdit(row)} disabled={busy || listLoading} className="text-blue-600 hover:text-blue-900 disabled:opacity-50">แก้ไข</button>
                            <span title={reason || 'ลบหน่วยนับ'}><button onClick={() => handleDelete(row)} disabled={deleteDisabled} aria-disabled={deleteDisabled} aria-label={reason ? `ลบหน่วย ${row.name}: ${reason}` : `ลบหน่วย ${row.name}`} title={reason || 'ลบหน่วยนับ'} className="text-red-600 hover:text-red-900 disabled:text-gray-400 disabled:cursor-not-allowed">ลบ</button></span>
                        </div>;
                }} />
                <Modal isOpen={isModalOpen} onClose={closeModal} title={selectedId ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ'}>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input label="ชื่อหน่วยนับ (สูงสุด 50 ตัวอักษร)" maxLength={50} value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} required disabled={loading} />
                        <Input label="ตัวย่อ (สูงสุด 10 ตัวอักษร)" maxLength={10} value={formData.abbreviation} onChange={(event) => setFormData({ ...formData, abbreviation: event.target.value })} required disabled={loading} />
                        {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
                        <div className="flex justify-end gap-2 mt-6">
                            <button type="button" onClick={closeModal} disabled={loading} className="px-4 py-2 border rounded-lg hover:bg-gray-50">ยกเลิก</button>
                            <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300">{loading ? 'กำลังบันทึก...' : 'บันทึก'}</button>
                        </div>
                    </form>
                </Modal>
            </div>
        </Layout>
    );
};
