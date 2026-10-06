import { reviewItemPath } from './api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionError, ErrorBox, FlagAmountActions, MoreStatus } from './App';
import { api } from './api';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function jsonResponse(data: unknown, pagination: Record<string, unknown> = {}) {
  return { ok: true, status: 200, json: async () => ({ success: true, data, pagination }) } as Response;
}

describe('mobile item search pagination', () => {
  it('uses the requested page size at each offset and returns every matching row', async () => {
    const fixture = Array.from({ length: 250 }, (_, index) => ({ id: index + 1 }));
    const seen: Array<{ limit: number; offset: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://local.test');
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      seen.push({ limit, offset });
      return jsonResponse(fixture.slice(offset, offset + limit), { total: fixture.length, limit, offset });
    }));

    const rows = await api.items({ search: 'receipt', limit: 100 });

    expect(rows).toHaveLength(250);
    expect(rows[0].id).toBe(1);
    expect(rows.at(-1)?.id).toBe(250);
    expect(seen).toEqual([{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }, { limit: 100, offset: 200 }]);
  });

  it('returns server total and next offset for one search page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{ id: 101 }, { id: 102 }], { total: 150, limit: 2, offset: 100 })));

    const page = await api.itemsPage({ search: 'receipt' }, 2, 100);

    expect(page.rows.map((row) => row.id)).toEqual([101, 102]);
    expect(page.pagination).toEqual({ total: 150, limit: 2, offset: 100, next_offset: 102 });
  });

  it('rejects a failed request so the caller can show an error instead of an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ message: 'mock unavailable' }) } as Response)));

    await expect(api.itemsPage({ search: 'receipt' })).rejects.toThrow('mock unavailable');
  });
});

describe('mobile mutation feedback and eligibility', () => {
  it('does not offer an automatic mutation retry or reload for a failed save', () => {
    const html = renderToStaticMarkup(createElement(ActionError, { error: new Error('fictional conflict') }));
    expect(html).toContain('บันทึกไม่สำเร็จ');
    expect(html).toContain('fictional conflict');
    expect(html).not.toContain('<button');
  });
  it('disables an absent LINE amount and exposes a manual correction', () => {
    const html = renderToStaticMarkup(createElement(FlagAmountActions, { item: { id: 1, category: 'bill', bill_total_value: 100, announced_amount: null }, pending: false, onResolve: () => undefined }));
    expect(html).toMatch(/<button disabled="">ใช้ยอดจาก LINE/);
    expect(html).toContain('ไม่มีข้อความระบุยอด');
    expect(html).toContain('บันทึกยอดเองและเคลียร์ธง');
  });
  it('locks all flag actions and the amount draft while a save is pending', () => {
    const html = renderToStaticMarkup(createElement(FlagAmountActions, { item: { id: 1, category: 'bill', bill_total_value: 100, announced_amount: 125 }, pending: true, onResolve: () => undefined }));
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain('กำลังบันทึก…');
  });
});

describe('mobile query failure display', () => {
  it('renders a visible error and retry action instead of an empty-result message', () => {
    const html = renderToStaticMarkup(createElement(ErrorBox, { error: new Error('mock unavailable'), onRetry: () => undefined }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('mock unavailable');
    expect(html).toContain('ลองอีกครั้ง');
    expect(html).not.toContain('ไม่พบเอกสาร');
  });

  it('does not turn More-page status request failures into stopped or zero status', () => {
    const html = renderToStaticMarkup(createElement(MoreStatus, {
      ai: { error: new Error('mock AI status unavailable'), isError: true, isFetching: false, refetch: () => undefined },
      senders: { error: new Error('mock sender list unavailable'), isError: true, isFetching: false, refetch: () => undefined }
    }));

    expect(html).toContain('mock AI status unavailable');
    expect(html).toContain('mock sender list unavailable');
    expect(html).not.toContain('ระบบอ่านรูป หยุดอยู่');
    expect(html).not.toContain('0 คน');
    expect(html.match(/ลองอีกครั้ง/g)).toHaveLength(2);
  });
});

describe('search result navigation context', () => {
  it('uses LINE event date in Bangkok instead of an unrelated storage creation date', () => {
    expect(reviewItemPath({ id: 7, source_id: 'fictional-group', event_timestamp_ms: Date.parse('2026-07-06T18:00:00Z'), created_at: '2026-10-03T12:00:00.000Z' })).toBe('/review/item/7?date=2026-07-07&source=fictional-group&item=7');
  });
});

describe('mobile receipt draft request', () => {
  it('returns the server error so the form can show a retry while keeping mutation separate', async () => {
    const get = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({ ok: false, status: 503, json: async () => ({ message: 'fictional draft unavailable' }), method: init?.method || 'GET' } as unknown as Response));
    vi.stubGlobal('fetch', get);
    await expect(api.receiptDraft(9)).rejects.toThrow('fictional draft unavailable');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][1]?.method).toBeUndefined();
  });
});
