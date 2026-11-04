// Cache configuration lists within one mounted report; amounts are never cached here.
export const createPnlMetadataCache = (request, now = Date.now) => {
  let cached = null;
  let cachedAt = 0;
  return {
    async read({ signal, force = false } = {}) {
      if (!force && cached && now() - cachedAt < 300_000) return cached;
      const [rules, creditSuppliers] = await Promise.all([
        request('/pnl/rules', { signal }), request('/pnl/credit-suppliers', { signal })
      ]);
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      cached = { rules, creditSuppliers };
      cachedAt = now();
      return cached;
    }
  };
};
