import { createRoot } from 'react-dom/client';
import ApLedger from './ApLedger.jsx';
const loadReport = async params => {
  const response = await fetch(`/api/ap/report?${params}`);
  if (!response.ok) throw new Error('AP_PREVIEW_UNAVAILABLE');
  return (await response.json()).data;
};
createRoot(document.getElementById('root')).render(<ApLedger preview loadReport={loadReport}/>);
