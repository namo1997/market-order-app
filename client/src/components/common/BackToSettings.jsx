import { useNavigate } from 'react-router-dom';

export const BackToSettings = ({ className = '' }) => {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/admin/settings')}
      className={`inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 ${className}`}
    >
      ← ย้อนกลับ
    </button>
  );
};
