import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '../../../components/layout/Layout';
import { Card } from '../../../components/common/Card';
import { BackToSettings } from '../../../components/common/BackToSettings';

const REPORT_MENU_ITEMS = [
  {
    path: '/admin/settings/reports/withdraw',
    title: 'รายงานการเบิก (เตรียมสร้าง)',
    description: 'เตรียมโครงหน้ารายงานการเบิกสินค้า แยกสาขา แผนก และช่วงเวลา'
  },
  {
    path: '/admin/settings/reports/transfer',
    title: 'รายงานการโอน (เตรียมสร้าง)',
    description: 'เตรียมโครงหน้ารายงานการโอนเข้า/โอนออก และยอดคงค้างปลายทาง'
  },
  {
    path: '/admin/settings/reports/purchase',
    title: 'รายงานการซื้อ (เตรียมสร้าง)',
    description: 'เตรียมโครงหน้ารายงานการซื้อจริงตามกลุ่มสินค้าและผู้ซื้อ'
  },
  {
    path: '/admin/settings/reports/materials',
    title: 'รายงานวัตถุดิบ (เตรียมสร้าง)',
    description: 'เตรียมโครงหน้ารายงานใช้วัตถุดิบและเปรียบเทียบตามสูตร'
  }
];

const PAGE_CONFIG = {
  '/admin/settings/reports/operations': {
    title: 'รายงานการเบิก/โอน/ซื้อ/วัตถุดิบ (เตรียมสร้าง)',
    description: 'เลือกประเภทรายงานย่อยที่ต้องการสร้าง'
  },
  ...Object.fromEntries(
    REPORT_MENU_ITEMS.map((item) => [
      item.path,
      {
        title: item.title,
        description: item.description
      }
    ])
  )
};

export const PlannedReportPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const config = useMemo(
    () =>
      PAGE_CONFIG[location.pathname] || {
        title: 'รายงาน (เตรียมสร้าง)',
        description: 'เตรียมโครงหน้ารายงาน'
      },
    [location.pathname]
  );
  const isMenuPage = location.pathname === '/admin/settings/reports/operations';

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <BackToSettings />
        <Card>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-gray-900">{config.title}</h1>
            <p className="text-sm text-gray-600">{config.description}</p>
            <p className="text-sm text-amber-700">
              สถานะ: เตรียมไว้สำหรับพัฒนาต่อในเฟสถัดไป
            </p>
          </div>
        </Card>

        {isMenuPage ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {REPORT_MENU_ITEMS.map((item) => (
              <Card
                key={item.path}
                className="cursor-pointer hover:shadow-lg transition-all duration-200"
                onClick={() => navigate(item.path)}
              >
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-gray-900">{item.title}</h2>
                  <p className="text-sm text-gray-600">{item.description}</p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex">
            <button
              type="button"
              onClick={() => navigate('/admin/settings/reports/operations')}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
            >
              ← กลับไปหน้ารวมรายงาน
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
};
