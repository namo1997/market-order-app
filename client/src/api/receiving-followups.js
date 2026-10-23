import apiClient from './client';
const base = '/receiving-followups';
const data = async request => (await request).data.data;
export const receivingFollowupsAPI = {
  setLead: (key, lead_days) => data(apiClient.put(`${base}/lead-times/${encodeURIComponent(key)}`, { lead_days })),
  followup: body => data(apiClient.post(base, body)),
  followups: (status = 'pending') => data(apiClient.get(base, { params: { status } })),
  followupStatus: (id, status) => data(apiClient.patch(`${base}/${encodeURIComponent(id)}`, { status })),
  // Staff home mode (owner 2026-10-23): 'new_first' hides the order queue from staff; administrators switch it.
  homeMode: () => data(apiClient.get('/receiving-home/mode')),
  setHomeMode: mode => data(apiClient.put('/receiving-home/mode', { mode })),
};
