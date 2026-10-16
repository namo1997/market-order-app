import { useEffect, useRef } from 'react';

// Measure the real bar, including text wrapping. visualViewport also keeps a
// focused number field above an on-screen keyboard without guessing its size.
export function useReviewLayout(step, uncertain, bulk) {
  const root = useRef(null);
  useEffect(() => {
    const element = root.current;
    if (!element?.querySelector) return;
    const bar = element.querySelector('.sg-bar:not(.sg-bar-inline)');
    const viewport = window.visualViewport;
    const pageStyle = document.documentElement.style;
    const previousHeight = pageStyle.getPropertyValue('--rc-page-bar-height');
    const measure = () => {
      pageStyle.setProperty('--rc-page-bar-height', `${bar?.getBoundingClientRect().height || 0}px`);
      element.style.setProperty('--rc-bar-height', `${bar?.getBoundingClientRect().height || 0}px`);
      element.style.setProperty('--rc-keyboard-offset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
      element.style.setProperty('--rc-visible-height', `${viewport?.height || window.innerHeight}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => { if (previousHeight) pageStyle.setProperty('--rc-page-bar-height', previousHeight); else pageStyle.removeProperty('--rc-page-bar-height'); observer?.disconnect(); viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [step, uncertain, bulk]);
  return root;
}
