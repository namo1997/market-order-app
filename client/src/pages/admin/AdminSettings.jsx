import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { stockCheckAPI } from '../../api/stock-check';

export const AdminSettings = () => {
    const navigate = useNavigate();
    const [stockCheckEnabled, setStockCheckEnabled] = useState(true);
    const [stockCheckLoading, setStockCheckLoading] = useState(true);
    const [stockCheckSaving, setStockCheckSaving] = useState(false);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                setStockCheckLoading(true);
                const data = await stockCheckAPI.getStockCheckStatus();
                setStockCheckEnabled(Boolean(data?.is_enabled));
            } catch (error) {
                console.error('Error fetching stock check status:', error);
            } finally {
                setStockCheckLoading(false);
            }
        };

        fetchStatus();
    }, []);

    const handleToggleStockCheck = async () => {
        const nextState = !stockCheckEnabled;
        const label = nextState ? 'เปิด' : 'ปิด';
        if (!confirm(`ต้องการ${label}ฟังก์ชั่นเช็คสต็อกใช่หรือไม่?`)) {
            return;
        }

        try {
            setStockCheckSaving(true);
            await stockCheckAPI.updateStockCheckStatus(nextState);
            setStockCheckEnabled(nextState);
        } catch (error) {
            console.error('Error updating stock check status:', error);
            const message = error.response?.data?.message || 'เกิดข้อผิดพลาดในการอัปเดตสถานะ';
            alert(message);
        } finally {
            setStockCheckSaving(false);
        }
    };

    const importTemplates = [
        {
            id: 'users',
            title: 'นำเข้าผู้ใช้งาน',
            description: 'username, password, name, role, department_id',
            filename: 'users_template.csv',
            headers: ['username', 'password', 'name', 'role', 'department_id'],
            sampleRows: [
                ['user_demo', 'password123', 'Demo User', 'user', '1']
            ]
        },
        {
            id: 'products',
            title: 'นำเข้าสินค้า',
            description: 'name, code, default_price, unit_id, supplier_id',
            filename: 'products_template.csv',
            headers: ['name', 'code', 'default_price', 'unit_id', 'supplier_id'],
            sampleRows: [
                ['Rice', 'GE001', '35.00', '1', '1']
            ]
        },
        {
            id: 'suppliers',
            title: 'นำเข้าซัพพลายเออร์',
            description: 'name, code, contact_person, phone, address, line_id',
            filename: 'suppliers_template.csv',
            headers: ['name', 'code', 'contact_person', 'phone', 'address', 'line_id'],
            sampleRows: [
                ['Fresh Co.', 'SUP001', 'Somchai', '0890000000', 'Bangkok', 'somchai_line']
            ]
        },
        {
            id: 'units',
            title: 'นำเข้าหน่วยนับ',
            description: 'name, abbreviation',
            filename: 'units_template.csv',
            headers: ['name', 'abbreviation'],
            sampleRows: [
                ['kilogram', 'kg']
            ]
        },
        {
            id: 'branches',
            title: 'นำเข้าสาขา',
            description: 'name, code',
            filename: 'branches_template.csv',
            headers: ['name', 'code'],
            sampleRows: [
                ['Bangkok Branch', 'BKK']
            ]
        },
        {
            id: 'departments',
            title: 'นำเข้าแผนก',
            description: 'branch_id, name, code',
            filename: 'departments_template.csv',
            headers: ['branch_id', 'name', 'code'],
            sampleRows: [
                ['1', 'Kitchen', 'KITCH']
            ]
        },
        {
            id: 'stock-templates',
            title: 'นำเข้ารายการของประจำ',
            description: 'department_id, product_id, required_quantity',
            filename: 'stock_templates.csv',
            headers: ['department_id', 'product_id', 'required_quantity'],
            sampleRows: [
                ['1', '1', '10']
            ]
        }
    ];

    const templateById = importTemplates.reduce((acc, template) => {
        acc[template.id] = template;
        return acc;
    }, {});

    const menus = [
        {
            title: 'จัดการผู้ใช้งาน',
            description: 'เพิ่ม ลบ แก้ไข ข้อมูลผู้ใช้งานในระบบ',
            icon: 'users',
            path: '/admin/settings/users',
            color: 'bg-blue-100 text-blue-600',
            templateId: 'users'
        },
        {
            title: 'จัดการสินค้า',
            description: 'เพิ่ม ลบ แก้ไข ข้อมูลสินค้าและราคา',
            icon: 'box',
            path: '/admin/settings/products',
            color: 'bg-green-100 text-green-600',
            templateId: 'products'
        },
        {
            title: 'จัดการ Suppliers',
            description: 'ข้อมูลคู่ค้าและผู้จัดจำหน่าย',
            icon: 'truck',
            path: '/admin/settings/suppliers',
            color: 'bg-purple-100 text-purple-600',
            templateId: 'suppliers'
        },
        {
            title: 'จัดการหน่วยนับ',
            description: 'หน่วยนับสินค้า (เช่น กก., แพ็ค)',
            icon: 'scale',
            path: '/admin/settings/units',
            color: 'bg-yellow-100 text-yellow-600',
            templateId: 'units'
        },
        {
            title: 'จัดการสาขา',
            description: 'ข้อมูลสาขา (Branch)',
            icon: 'home',
            path: '/admin/settings/branches',
            color: 'bg-orange-100 text-orange-600',
            templateId: 'branches'
        },
        {
            title: 'จัดการแผนก',
            description: 'ข้อมูลแผนกภายในสาขา (Kitchen, Bar)',
            icon: 'briefcase',
            path: '/admin/settings/departments',
            color: 'bg-pink-100 text-pink-600',
            templateId: 'departments'
        },
        {
            title: 'รายการของประจำแต่ละแผนก',
            description: 'ตั้งค่ารายการสินค้าที่แต่ละแผนกต้องสั่งเป็นประจำ',
            icon: 'clipboard',
            path: '/admin/settings/stock-templates',
            color: 'bg-indigo-100 text-indigo-600',
            templateId: 'stock-templates'
        }
    ];

    const escapeCsv = (value) => {
        const stringValue = value === null || value === undefined ? '' : String(value);
        if (/[",\n]/.test(stringValue)) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    };

    const downloadTemplate = (template) => {
        const rows = [
            template.headers.join(','),
            ...template.sampleRows.map((row) =>
                row.map((cell) => escapeCsv(cell)).join(',')
            )
        ];
        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = template.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">ตั้งค่าระบบ</h1>

                <p className="text-sm text-gray-500 mb-6">
                    ดาวน์โหลดเทมเพลตนำเข้า ใช้ไฟล์ CSV สำหรับเตรียมข้อมูลนำเข้า โดยระบุ ID ที่อ้างอิงให้ถูกต้อง
                </p>

                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <p className="text-xs text-gray-500">ฟังก์ชั่นเช็คสต็อก</p>
                        <p
                            className={`text-lg font-semibold ${
                                stockCheckEnabled ? 'text-emerald-600' : 'text-gray-500'
                            }`}
                        >
                            {stockCheckLoading ? 'กำลังโหลดสถานะ...' : stockCheckEnabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
                        </p>
                    </div>
                    <button
                        onClick={handleToggleStockCheck}
                        disabled={stockCheckSaving || stockCheckLoading}
                        className={`px-4 py-2 rounded-lg text-white ${
                            stockCheckEnabled ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'
                        } disabled:opacity-60`}
                    >
                        {stockCheckSaving
                            ? 'กำลังอัปเดต...'
                            : stockCheckEnabled
                                ? 'ปิดฟังก์ชั่นเช็คสต็อก'
                                : 'เปิดฟังก์ชั่นเช็คสต็อก'}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {menus.map((menu) => {
                        const template = templateById[menu.templateId];
                        return (
                        <Card
                            key={menu.path}
                            onClick={() => navigate(menu.path)}
                            className="cursor-pointer hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1"
                        >
                            <div className="flex items-start space-x-4">
                                <div className={`p-3 rounded-lg ${menu.color}`}>
                                    {/* Icons placeholder - reusing existing SVGs or simple shapes if no lib */}
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900 text-lg mb-1">
                                        {menu.title}
                                    </h3>
                                    <p className="text-gray-500 text-sm">
                                        {menu.description}
                                    </p>
                                </div>
                            </div>
                            {template && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <p className="text-xs font-semibold text-gray-700">
                                        {template.title}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {template.description}
                                    </p>
                                    <div className="mt-3">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                downloadTemplate(template);
                                            }}
                                        >
                                            ดาวน์โหลดเทมเพลต
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </Card>
                        );
                    })}
                </div>
            </div>
        </Layout>
    );
};
