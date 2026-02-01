import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';

export const FunctionSelect = () => {
  const navigate = useNavigate();

  const actions = [
    {
      title: 'สั่งซื้อสินค้า',
      description: 'เพิ่มรายการและส่งคำสั่งซื้อ',
      path: '/order',
      tone: 'border-blue-200 bg-blue-50 hover:border-blue-300'
    },
    {
      title: 'เช็คสต็อก',
      description: 'บันทึกคงเหลือสินค้าประจำ',
      path: '/stock-check',
      tone: 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'
    },
    {
      title: 'เบิกสินค้า',
      description: 'บันทึกการเบิกใช้งานสินค้า',
      path: '/withdraw',
      tone: 'border-amber-200 bg-amber-50 hover:border-amber-300'
    }
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">เลือกฟังก์ชั่นการทำงาน</h1>
          <p className="text-sm text-gray-500">
            กรุณาเลือกสิ่งที่ต้องการทำต่อ
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {actions.map((action) => (
            <Card
              key={action.path}
              onClick={() => navigate(action.path)}
              className={`cursor-pointer border-2 ${action.tone}`}
            >
              <div className="min-h-[120px] flex flex-col justify-center">
                <h2 className="text-lg font-semibold text-gray-900">
                  {action.title}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {action.description}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
};
