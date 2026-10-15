// Native HTTP avoids WebView CORS; protected image bytes never use public URLs.
export function createTransport({ isNative, nativeRequest, fetchImpl = fetch }) {
  return async options => {
    const binary = options.responseType === 'blob';
    if (isNative()) {
      const result = await nativeRequest({ ...options, responseType: binary ? 'arraybuffer' : 'json' });
      if (binary && result.status >= 200 && result.status < 300) {
        try {
          const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
          const headers = result.headers || {};
          result.data = new Blob([bytes], { type: headers['content-type'] || headers['Content-Type'] || 'image/jpeg' });
        } catch { throw new Error('อ่านรูปไม่สำเร็จ'); }
      }
      return result;
    }
    const response = await fetchImpl(options.url, {
      method: options.method, headers: options.headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: AbortSignal.timeout(options.readTimeout), credentials: 'omit', redirect: 'error',
    });
    return { status: response.status, data: binary && response.ok ? await response.blob() : await response.json() };
  };
}
