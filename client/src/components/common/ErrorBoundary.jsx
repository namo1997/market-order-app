import React from 'react';
import { isChunkLoadError, reloadForNewVersion } from '../../utils/chunk-reload';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
        if (isChunkLoadError(error)) {
            reloadForNewVersion();
        }
    }

    componentDidUpdate(prevProps) {
        // เปลี่ยนหน้าแล้วให้ลอง render ใหม่ ไม่ค้างอยู่ที่หน้า error
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null, errorInfo: null });
        }
    }

    render() {
        if (this.state.hasError) {
            const chunkError = isChunkLoadError(this.state.error);
            return (
                <div className="p-8 bg-red-50 text-red-900 min-h-screen">
                    <h1 className="text-2xl font-bold mb-2">
                        {chunkError ? 'มีเวอร์ชันใหม่ของระบบ' : 'เกิดข้อผิดพลาดในหน้านี้'}
                    </h1>
                    <p className="mb-4">
                        {chunkError
                            ? 'กรุณาโหลดหน้าใหม่เพื่อใช้งานเวอร์ชันล่าสุด'
                            : 'ลองโหลดหน้าใหม่ หรือกลับไปหน้าหลัก หากยังเกิดซ้ำกรุณาแจ้งผู้ดูแลระบบ'}
                    </p>
                    <div className="flex gap-2 mb-4">
                        <button
                            type="button"
                            className="px-4 py-2 rounded bg-red-600 text-white"
                            onClick={() => window.location.reload()}
                        >
                            โหลดหน้าใหม่
                        </button>
                        <button
                            type="button"
                            className="px-4 py-2 rounded border border-red-300 bg-white"
                            onClick={() => window.location.assign('/')}
                        >
                            กลับหน้าหลัก
                        </button>
                    </div>
                    {import.meta.env.DEV && (
                        <details className="whitespace-pre-wrap font-mono text-sm bg-white p-4 rounded border border-red-200">
                            {this.state.error && this.state.error.toString()}
                            <br />
                            {this.state.errorInfo && this.state.errorInfo.componentStack}
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
