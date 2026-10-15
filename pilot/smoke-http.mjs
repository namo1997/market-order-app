import assert from 'node:assert/strict';

export async function requestJson(base, method, suffix, body, bearer, status = 200, fetcher = fetch) {
  const response = await fetcher(`${base}${suffix}`, { method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70000), redirect: 'error' });
  assert.equal(response.status, status, `${method} ${suffix}: HTTP ${response.status}, expected ${status}`);
  const payload = await response.json();
  if (status < 300) assert.equal(payload.success, true);
  return status < 300 ? payload.data : payload;
}

export async function uploadAndVerifyImage(base, suffix, bytes, bearer, fetcher = fetch) {
  const { image_id: imageId } = await requestJson(base, 'POST', suffix, { page_no: 1,
    image_data_url: `data:image/jpeg;base64,${bytes.toString('base64')}` }, bearer, 201, fetcher);
  assert.ok(Number.isSafeInteger(imageId) && imageId > 0, 'upload returns data.image_id');
  const response = await fetcher(`${base}${suffix}/${imageId}`, {
    headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^image\/jpeg(?:;|$)/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  return imageId;
}
