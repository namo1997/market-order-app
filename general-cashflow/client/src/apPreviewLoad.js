export async function loadApPreview(params, fetchReport = fetch) {
  const response = await fetchReport(`/api/ap/report?${params}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('AP_PREVIEW_UNAVAILABLE'), { status: response.status, code: body.code });
  return body.data;
}
