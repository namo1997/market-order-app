import { Component, Suspense } from 'react';

class ViewErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="error-box" role="alert"><p>โหลด{this.props.label}ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่</p><button type="button" onClick={() => window.location.reload()}>โหลดหน้าใหม่</button></section>;
    return this.props.children;
  }
}

export default function DeferredView({ children, label = 'หน้าใช้งาน', active = true }) {
  return <div hidden={!active}><ViewErrorBoundary label={label}><Suspense fallback={<p role="status">กำลังโหลด{label}…</p>}>{children}</Suspense></ViewErrorBoundary></div>;
}
