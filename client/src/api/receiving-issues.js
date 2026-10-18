import client from './client';
const base='/receiving-issues';
const data=async promise=>(await promise).data.data;
export const receivingIssuesAPI={
  sourceDocument:id=>data(client.get(`${base}/documents/${encodeURIComponent(id)}`)),
  assignees:()=>data(client.get(`${base}/assignees`)),
  list:params=>data(client.get(base,{params})),
  detail:id=>data(client.get(`${base}/${encodeURIComponent(id)}`)),
  create:body=>data(client.post(base,body)),
  update:(id,body)=>data(client.put(`${base}/${encodeURIComponent(id)}`,body)),
  attach:(id,body)=>data(client.post(`${base}/${encodeURIComponent(id)}/evidence`,body)),
  binary:async(id,evidenceId,kind='image')=>(await client.get(`${base}/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`,{params:{kind},responseType:'blob'})).data,
};
