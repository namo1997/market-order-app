import { createRoot } from 'react-dom/client';
import ApLedger from './ApLedger.jsx';
import { loadApPreview } from './apPreviewLoad.js';
createRoot(document.getElementById('root')).render(<ApLedger preview loadReport={loadApPreview}/>);
