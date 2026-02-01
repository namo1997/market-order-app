import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/layout/Layout';
import { Card } from '../../components/common/Card';

export const Withdraw = () => {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mb-3 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          &lt;- ย้อนกลับ
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">เบิกสินค้า</h1>
        <Card className="text-center py-10 text-gray-500">
          ฟังก์ชั่นเบิกสินค้ากำลังเตรียมระบบ
        </Card>
      </div>
    </Layout>
  );
};
