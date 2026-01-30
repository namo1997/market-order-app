import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';
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

    const iconPaths = {
        users: [
            'M17 20h5v-2a4 4 0 00-4-4h-1',
            'M9 20H4v-2a4 4 0 014-4h1',
            'M12 8a4 4 0 10-8 0 4 4 0 008 0z',
            'M20 8a4 4 0 10-8 0 4 4 0 008 0z'
        ],
        box: [
            'M21 8l-9-5-9 5 9 5 9-5z',
            'M3 8v8l9 5 9-5V8',
            'M12 13v8'
        ],
        truck: [
            'M3 7h11v7H3z',
            'M14 10h4l3 3v1h-7',
            'M7 17a2 2 0 104 0 2 2 0 00-4 0z',
            'M17 17a2 2 0 104 0 2 2 0 00-4 0z'
        ],
        scale: [
            'M12 4v16',
            'M6 6h12',
            'M6 6l-3 6h6l-3-6z',
            'M18 6l-3 6h6l-3-6z',
            'M8 20h8'
        ],
        home: [
            'M3 10l9-7 9 7',
            'M5 10v10h5v-6h4v6h5V10'
        ],
        briefcase: [
            'M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2',
            'M3 7h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
            'M3 12h18'
        ],
        layers: [
            'M12 3l9 5-9 5-9-5 9-5z',
            'M21 12l-9 5-9-5',
            'M21 17l-9 5-9-5'
        ],
        'shopping-cart': [
            'M3 4h2l2 10h10l2-6H7',
            'M9 20a1 1 0 100-2 1 1 0 000 2z',
            'M17 20a1 1 0 100-2 1 1 0 000 2z'
        ],
        clipboard: [
            'M9 4h6a2 2 0 012 2v2H7V6a2 2 0 012-2z',
            'M7 8h10v12a2 2 0 01-2 2H9a2 2 0 01-2-2V8z',
            'M9 12h6',
            'M9 16h6'
        ],
        calculator: [
            'M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z',
            'M8 7h8',
            'M8 11h2',
            'M12 11h2',
            'M16 11h2',
            'M8 15h2',
            'M12 15h2',
            'M16 15h2'
        ],
        chart: [
            'M4 19h16',
            'M6 17V9',
            'M12 17V5',
            'M18 17v-6'
        ],
        bell: [
            'M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5',
            'M9 17a3 3 0 006 0'
        ]
    };

    const menus = [
        {
            title: 'จัดการผู้ใช้งาน',
            icon: 'users',
            path: '/admin/settings/users',
            color: 'bg-blue-100 text-blue-600',
            templateId: 'users'
        },
        {
            title: 'จัดการสินค้า',
            icon: 'box',
            path: '/admin/settings/products',
            color: 'bg-green-100 text-green-600',
            templateId: 'products'
        },
        {
            title: 'จัดการ Suppliers',
            icon: 'truck',
            path: '/admin/settings/suppliers',
            color: 'bg-purple-100 text-purple-600',
            templateId: 'suppliers'
        },
        {
            title: 'จัดการหน่วยนับ',
            icon: 'scale',
            path: '/admin/settings/units',
            color: 'bg-yellow-100 text-yellow-600',
            templateId: 'units'
        },
        {
            title: 'จัดการสาขา',
            icon: 'home',
            path: '/admin/settings/branches',
            color: 'bg-orange-100 text-orange-600',
            templateId: 'branches'
        },
        {
            title: 'จัดการแผนก',
            icon: 'briefcase',
            path: '/admin/settings/departments',
            color: 'bg-pink-100 text-pink-600',
            templateId: 'departments'
        },
        {
            title: 'ตั้งค่าหมวดสินค้า',
            icon: 'layers',
            path: '/admin/settings/stock-categories',
            color: 'bg-sky-100 text-sky-600'
        },
        {
            title: 'ตั้งค่าการเดินซื้อของ',
            icon: 'shopping-cart',
            path: '/admin/settings/purchase-walk',
            color: 'bg-emerald-100 text-emerald-600'
        },
        {
            title: 'ตั้งค่าสูตรเมนู',
            icon: 'clipboard',
            path: '/admin/settings/recipes',
            color: 'bg-cyan-100 text-cyan-600'
        },
        {
            title: 'ตั้งค่าแปลงหน่วย',
            icon: 'calculator',
            path: '/admin/settings/unit-conversions',
            color: 'bg-rose-100 text-rose-600'
        },
        {
            title: 'รายงานใช้วัตถุดิบ',
            icon: 'chart',
            path: '/admin/settings/usage-report',
            color: 'bg-teal-100 text-teal-600'
        },
        {
            title: 'รายงานยอดขาย',
            icon: 'chart',
            path: '/admin/settings/sales-report',
            color: 'bg-amber-100 text-amber-600'
        },
        {
            title: 'รายงานราคาสินค้า',
            icon: 'chart',
            path: '/admin/settings/price-report',
            color: 'bg-lime-100 text-lime-600'
        },
        {
            title: 'รายงานการซื้อของ',
            icon: 'chart',
            path: '/admin/settings/purchase-report',
            color: 'bg-blue-100 text-blue-600'
        },
        {
            title: 'แจ้งเตือน LINE',
            icon: 'bell',
            path: '/admin/settings/line-notifications',
            color: 'bg-red-100 text-red-600'
        },
        {
            title: 'รายการของประจำแต่ละแผนก',
            icon: 'clipboard',
            path: '/admin/settings/stock-templates',
            color: 'bg-indigo-100 text-indigo-600',
            templateId: 'stock-templates'
        },
        {
            title: 'สินค้าแผนกสำหรับสั่งของ',
            icon: 'layers',
            path: '/admin/settings/department-products',
            color: 'bg-violet-100 text-violet-600'
        }
    ];

    const menuGroups = [
        {
            title: 'ข้อมูลพื้นฐาน',
            items: ['จัดการผู้ใช้งาน', 'จัดการสาขา', 'จัดการแผนก', 'จัดการหน่วยนับ']
        },
        {
            title: 'สินค้าและคู่ค้า',
            items: [
                'จัดการสินค้า',
                'จัดการ Suppliers',
                'รายการของประจำแต่ละแผนก',
                'สินค้าแผนกสำหรับสั่งของ',
                'ตั้งค่าหมวดสินค้า'
            ]
        },
        {
            title: 'การเดินซื้อของ',
            items: ['ตั้งค่าการเดินซื้อของ']
        },
        {
            title: 'สูตรและวัตถุดิบ',
            items: ['ตั้งค่าสูตรเมนู', 'ตั้งค่าแปลงหน่วย']
        },
        {
            title: 'รายงาน',
            items: ['รายงานใช้วัตถุดิบ', 'รายงานยอดขาย', 'รายงานราคาสินค้า', 'รายงานการซื้อของ']
        },
        {
            title: 'การแจ้งเตือน',
            items: ['แจ้งเตือน LINE']
        }
    ].map((group) => ({
        ...group,
        items: menus.filter((menu) => group.items.includes(menu.title))
    }));

    return (
        <Layout>
            <div className="max-w-6xl mx-auto">
                <h1 className="text-2xl font-bold text-gray-900 mb-6">ตั้งค่าระบบ</h1>

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

                <div className="space-y-10">
                    {menuGroups.map((group) => (
                        <section key={group.title} className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-gray-900">{group.title}</h2>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                {group.items.map((menu) => (
                                    <Card
                                        key={menu.path}
                                        onClick={() => navigate(menu.path)}
                                        className="cursor-pointer hover:shadow-lg transition-all duration-200 transform hover:-translate-y-1"
                                    >
                                        <div className="flex items-center space-x-4">
                                            <div className={`p-3 rounded-lg ${menu.color}`}>
                                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    {(iconPaths[menu.icon] || iconPaths.chart).map((path, index) => (
                                                        <path
                                                            key={`${menu.icon}-${index}`}
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                            strokeWidth={2}
                                                            d={path}
                                                        />
                                                    ))}
                                                </svg>
                                            </div>
                                            <div>
                                                <h3 className="font-semibold text-gray-900 text-base">
                                                    {menu.title}
                                                </h3>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </Layout>
    );
};
