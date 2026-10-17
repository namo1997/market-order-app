import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isReceivingPath, mountReceivingHead } from './receiving-web-app';

export function ReceivingWebAppHead() {
  const { pathname } = useLocation();
  const receiving = isReceivingPath(pathname);
  useEffect(() => {
    if (receiving) return mountReceivingHead(document, window);
  }, [receiving]);
  return null;
}
