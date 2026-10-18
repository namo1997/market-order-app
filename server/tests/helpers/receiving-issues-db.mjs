// SQL double with serialized transactions and rollback. It does not emulate InnoDB.
export function issueDb() {
  const state={issues:[],evidence:[],history:[],reminders:[],followups:[],scans:[],queries:[],fail:null,
    docs:[{id:1,status:'confirmed',branch_id:1,department_id:10,supplier_name_text:'ร้านผัก'},{id:2,status:'confirmed',branch_id:2,department_id:20,supplier_name_text:'ร้านเนื้อ'}],
    lines:[{id:11,document_id:1,bill_text:'มะนาว',quantity_billed:'3.00',quantity_received:'2.00',unit_price:'0.10'},{id:21,document_id:2,bill_text:'หมู',quantity_billed:'1.00',quantity_received:'2.00',unit_price:'25.00'}],audits:[]};
  let tail=Promise.resolve();let ids={issue:1,proof:1,history:1,followup:1};
  const rows=items=>[structuredClone(items)];
  async function query(sql,a=[]) {
    const q=sql.replace(/\s+/g,' ').trim();state.queries.push({sql:q,args:a});
    if(state.fail&&q.includes(state.fail))throw new Error('synthetic SQL secret must not escape');
    if(q.startsWith('CREATE TABLE'))return [{}];
    if(q.startsWith('SELECT DISTINCT d.id FROM receiving_documents'))return rows(state.docs.filter(d=>d.status==='confirmed'&&!state.scans.some(s=>s.document_id===d.id)));
    if(q.startsWith('SELECT id,status')||q.startsWith('SELECT id,status,branch_id'))return rows(state.docs.filter(d=>d.id===Number(a[0])));
    if(q.includes('FROM receiving_document_audits'))return rows(state.audits.filter(r=>r.document_id===a[0]));
    if(q.includes('FROM receiving_document_lines'))return rows(state.lines.filter(l=>q.includes('WHERE id IN')?a.includes(l.id):q.includes('WHERE id=?')?l.id===a[0]&&l.document_id===a[1]:l.document_id===a[0]));
    if(q.includes('FROM receiving_issue_scans'))return rows(state.scans.filter(s=>s.document_id===a[0]));
    if(q.startsWith('INSERT IGNORE INTO receiving_issue_scans')){if(!state.scans.some(s=>s.document_id===a[0]))state.scans.push({document_id:a[0]});return [{}];}
    if(q.startsWith('SELECT i.id FROM receiving_issues'))return rows(state.issues.filter(r=>['open','waiting_supplier'].includes(r.status)&&r.due_at<=a[0]&&!state.reminders.some(n=>n.issue_id===r.id&&n.due_at===r.due_at)));
    if(q.includes('FROM receiving_issues')){
      let result=state.issues;
      if(q.includes('WHERE id=?'))result=result.filter(r=>r.id===Number(a[0]));
      else if(q.includes('WHERE client_uuid=?'))result=result.filter(r=>r.client_uuid===a[0]);
      else {
        let i=0;
        if(q.includes('branch_id=?')){const branch=Number(a[i++]);result=result.filter(r=>r.branch_id===branch);if(q.split('branch_id=?').length>2){const other=Number(a[i++]);result=result.filter(r=>r.branch_id===other);}}
        if(q.includes("status IN ('open','waiting_supplier')"))result=result.filter(r=>['open','waiting_supplier'].includes(r.status));
        else if(q.includes("status IN ('resolved','cancelled')"))result=result.filter(r=>['resolved','cancelled'].includes(r.status));
        else if(q.includes('status=?')){const v=a[i++];result=result.filter(r=>r.status===v);}
        if(q.includes('type=?')){const v=a[i++];result=result.filter(r=>r.type===v);}
        if(q.includes('supplier_name LIKE ?')){const v=a[i++].slice(1,-1);result=result.filter(r=>r.supplier_name.includes(v));}
        if(q.includes('created_at<=?')){const v=a[i++];result=result.filter(r=>r.created_at<=v);}
        if(q.includes('due_at<=?')){const v=a[i++];result=result.filter(r=>r.due_at<=v);}
        if(q.includes('id<?')){const v=a[i++];result=result.filter(r=>r.id<v);}
        result=[...result].sort((x,y)=>y.id-x.id).slice(0,101);
      }
      return rows(result);
    }
    if(q.startsWith('INSERT INTO receiving_issues ')){
      const keys=['client_uuid','auto_key','type','document_id','line_id','branch_id','department_id','supplier_name','product_name','quantity','amount','note','due_at','created_by','created_at','updated_at'];
      if(state.issues.some(r=>r.client_uuid===a[0]))throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});
      const row=Object.fromEntries(keys.map((k,i)=>[k,a[i]]));Object.assign(row,{id:ids.issue++,version:1,status:'open',resolution:null,resolution_amount:null,resolution_ref:null,owner_user_id:null,closed_at:null});state.issues.push(row);return [{insertId:row.id}];
    }
    if(q.startsWith('UPDATE receiving_issues SET')){
      const row=state.issues.find(r=>r.id===a.at(-1));const keys=['status','resolution','resolution_amount','resolution_ref','note','owner_user_id','due_at','updated_at','closed_at'];
      Object.assign(row,Object.fromEntries(keys.map((k,i)=>[k,a[i]])));row.version++;return [{affectedRows:1}];
    }
    if(q.startsWith('SELECT id,name FROM users'))return [[{id:7,name:'บัญชี'}]];
    if(q.startsWith('SELECT id FROM users'))return rows(a[0]===7?[{id:7}]:[]);
    if(q.startsWith('INSERT INTO receiving_issue_history')){state.history.push({id:ids.history++,issue_id:a[0],action:a[1],actor_user_id:a[2],details_json:a[3],created_at:a[4]});return [{}];}
    if(q.includes('FROM receiving_issue_history'))return rows(state.history.filter(r=>(q.includes('WHERE issue_id IN')?a.includes(r.issue_id):r.issue_id===a[0])&&(!q.includes("action='auto_created'")||r.action==='auto_created')));
    if(q.startsWith('SELECT COUNT(*) AS count'))return [[{count:state.evidence.filter(r=>r.issue_id===a[0]).length}]];
    if(q.startsWith('INSERT INTO receiving_issue_evidence')){
      const keys=['issue_id','client_uuid','image_data','mime_type','sha256','signature_data','collector_name','note','created_by','created_at'];const row=Object.fromEntries(keys.map((k,i)=>[k,a[i]]));row.id=ids.proof++;state.evidence.push(row);return [{insertId:row.id}];
    }
    if(q.includes('FROM receiving_issue_evidence')){
      let result=state.evidence;
      if(q.includes('WHERE id=?'))result=result.filter(r=>r.id===a[0]&&r.issue_id===a[1]);
      else result=result.filter(r=>r.issue_id===a[0]);
      if(q.includes('client_uuid=?'))result=result.filter(r=>r.client_uuid===a[1]);
      if(q.includes('collector_name IS NOT NULL'))result=result.filter(r=>r.collector_name);
      if(q.startsWith('SELECT id,collector_name'))result=result.map(r=>({id:r.id,collector_name:r.collector_name,note:r.note,has_signature:!!r.signature_data,created_at:r.created_at}));
      return rows(result);
    }
    if(q.startsWith('SELECT followup_id'))return rows(state.reminders.filter(r=>r.issue_id===a[0]&&r.due_at===a[1]));
    if(q.startsWith('INSERT INTO receiving_issue_reminders')){state.reminders.push({issue_id:a[0],due_at:a[1],followup_id:a[2]});return [{}];}
    if(q.startsWith('INSERT INTO receiving_followups')){
      const keys=['supplier_key','supplier_name','branch_id','department_id','pending_items_json','actor_user_id','actor_name','note','source','auto_key','created_at','updated_at'];const row=Object.fromEntries(keys.map((k,i)=>[k,a[i]]));row.id=ids.followup++;row.status='open';state.followups.push(row);return [{insertId:row.id}];
    }
    if(q.startsWith('UPDATE receiving_followups f JOIN')){for(const r of state.reminders.filter(r=>r.issue_id===a[0])){const f=state.followups.find(f=>f.id===r.followup_id);if(f)f.status='resolved';}return [{}];}
    throw Error('Unmocked issue SQL: '+q);
  }
  const db={query,async getConnection(){let unlock,snapshot;
    return {async beginTransaction(){const prior=tail;tail=new Promise(resolve=>{unlock=resolve;});await prior;snapshot=structuredClone(Object.fromEntries(['issues','evidence','history','reminders','followups'].map(k=>[k,state[k]])));},query,
      async commit(){},async rollback(){Object.assign(state,snapshot);},release(){unlock?.();}};
  }};
  return {db,state};
}
