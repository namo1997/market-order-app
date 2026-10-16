import { useEffect, useRef } from 'react';
import { focusField } from './receiving-validation.js';

// Keep the whole signing region above the measured bar on entry and resize.
export function fitSignature(element, view = window) {
  const signature = element.querySelector('.rc-signature');
  const bar = element.querySelector('.sg-bar:not(.sg-bar-inline)');
  if (!signature || !bar) return;
  const rect = signature.getBoundingClientRect();
  const top = (view.visualViewport?.offsetTop || 0) + 8;
  const bottom = Math.min(bar.getBoundingClientRect().top - 8,
    (view.visualViewport?.offsetTop || 0) + (view.visualViewport?.height || view.innerHeight));
  if (rect.bottom > bottom) view.scrollBy({ top: Math.min(rect.bottom - bottom, rect.top - top), behavior: 'instant' });
  else if (rect.top < top) view.scrollBy({ top: rect.top - top, behavior: 'instant' });
}

// Keep both pending-price lines together above the actual success action bar.
export function fitReceipt(element, view = window) {
  if (!element.classList.contains('rc-success')) return;
  const notice = element.querySelector('.rc-price-notice');
  const bar = element.querySelector('.sg-bar:not(.sg-bar-inline)');
  if (!notice || !bar) return;
  const bottom = Math.min(bar.getBoundingClientRect().top - 8,
    (view.visualViewport?.offsetTop || 0) + (view.visualViewport?.height || view.innerHeight));
  const overflow = notice.getBoundingClientRect().bottom - bottom;
  if (overflow > 0) view.scrollBy({ top: overflow, behavior: 'instant' });
}

// Measure the real bar, including text wrapping. visualViewport also keeps a
// focused number field above an on-screen keyboard without guessing its size.
export function useReviewLayout(step, uncertain, bulk, editing) {
  const root = useRef(null);
  useEffect(() => {
    const element = root.current;
    if (!element?.querySelector) return;
    const bar = element.querySelector('.sg-bar:not(.sg-bar-inline)');
    const toolbar = element.querySelector('.rc-review-toolbar');
    const viewport = window.visualViewport;
    const pageStyle = document.documentElement.style;
    const previousHeight = pageStyle.getPropertyValue('--rc-page-bar-height');
    const previousToolbar = pageStyle.getPropertyValue('--rc-page-toolbar-height');
    let toolbarHeight;
    const measure = () => {
      element.dataset.largeText = String(parseFloat(getComputedStyle(element).fontSize) >= 24);
      pageStyle.setProperty('--rc-page-bar-height', `${bar?.getBoundingClientRect().height || 0}px`);
      element.style.setProperty('--rc-bar-height', `${bar?.getBoundingClientRect().height || 0}px`);
      element.style.setProperty('--rc-keyboard-offset', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
      element.style.setProperty('--rc-visible-height', `${viewport?.height || window.innerHeight}px`);
      const nextToolbarHeight = toolbar?.getBoundingClientRect().height || 0;
      pageStyle.setProperty('--rc-page-toolbar-height', `${nextToolbarHeight}px`);
      if (toolbarHeight !== nextToolbarHeight && document.activeElement?.id?.startsWith('line-')) focusField(document.activeElement.id);
      toolbarHeight = nextToolbarHeight;
      if (step === 'sign' && !element.querySelector('dialog[open]')) { fitSignature(element); fitReceipt(element); }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (bar) observer?.observe(bar);
    if (toolbar) observer?.observe(toolbar);
    observer?.observe(element);
    const resized = () => { measure(); if (document.activeElement?.id?.startsWith('line-')) focusField(document.activeElement.id); };
    viewport?.addEventListener('resize', resized);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', resized);
    return () => { if (previousHeight) pageStyle.setProperty('--rc-page-bar-height', previousHeight); else pageStyle.removeProperty('--rc-page-bar-height'); if (previousToolbar) pageStyle.setProperty('--rc-page-toolbar-height', previousToolbar); else pageStyle.removeProperty('--rc-page-toolbar-height'); observer?.disconnect(); viewport?.removeEventListener('resize', resized); viewport?.removeEventListener('scroll', measure); window.removeEventListener('resize', resized); };
  }, [step, uncertain, bulk, editing]);
  return root;
}
