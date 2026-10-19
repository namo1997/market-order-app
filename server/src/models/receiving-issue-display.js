// Enrich only issues already filtered by the caller's access policy. No binary
// evidence or user directory is returned; bind IDs in bounded batches.
export async function issueDisplay(db, rows) {
  if (!rows.length) return [];
  const unique = key => [...new Set(rows.map(row => row[key]).filter(Boolean))];
  const branches = unique('branch_id'), owners = unique('owner_user_id');
  const marks = ids => ids.map(() => '?').join(',');
  const [branchRows] = branches.length ? await db.query(`SELECT id,name FROM branches WHERE id IN (${marks(branches)})`, branches) : [[]];
  const [ownerRows] = owners.length ? await db.query(`SELECT id,name FROM users WHERE id IN (${marks(owners)})`, owners) : [[]];
  const ids = rows.map(row => row.id);
  const [proofs] = await db.query(`SELECT issue_id,COUNT(*) AS evidence_count FROM receiving_issue_evidence WHERE issue_id IN (${marks(ids)}) GROUP BY issue_id`, ids);
  return rows.map(row => ({...row,
    branch_name: branchRows.find(branch => Number(branch.id) === Number(row.branch_id))?.name || null,
    owner_name: ownerRows.find(owner => Number(owner.id) === Number(row.owner_user_id))?.name || null,
    evidence_count: Number(proofs.find(proof => Number(proof.issue_id) === Number(row.id))?.evidence_count || 0),
    resolution_ref_pending: row.status === 'resolved' && row.resolution === 'credit_note' && !row.resolution_ref,
  }));
}

// A closed credit agreement may receive its missing reference once. It cannot
// change the agreed amount, owner, reason or terminal status, or reopen stock.
export async function completeIssueReference(conn, row, body, user, now, {p, history, mapIssue, select}) {
  if (row.status !== 'resolved' || row.resolution !== 'credit_note' || row.resolution_ref ||
      Object.keys(body).some(key => !['version','resolution_ref'].includes(key))) {
    p.fail('เรื่องปิดแล้ว แก้ได้เฉพาะเลขใบลดหนี้ที่ยังไม่ได้ระบุ', 'NOT_DRAFT');
  }
  const reference = p.text(body.resolution_ref, 255, true);
  await conn.query('UPDATE receiving_issues SET resolution_ref=?,version=version+1,updated_at=? WHERE id=?', [reference,p.stamp(now),row.id]);
  await history(conn,row,user,'reference_added',{resolution_ref:reference},now);
  const [rows] = await conn.query(`${select} WHERE id=?`,[row.id]);
  return mapIssue(rows[0]);
}
