// Every active branch returned by the API must remain selectable, including new codes.
export const groupLoginBranches = (branches = []) => {
  const result = { storefrontBranches: [], kitchenBranches: [], storeBranch: null, centralBranch: null };
  for (const branch of branches) {
    const code = String(branch?.code || '').trim().toUpperCase();
    const name = String(branch?.name || '').trim();
    if ((code === 'BR001' || name.includes('สโตร์')) && !result.storeBranch) {
      result.storeBranch = branch;
    } else if ((code === 'CENTRAL' || name === 'สาขาส่วนกลาง') && !result.centralBranch) {
      result.centralBranch = branch;
    } else if (code === 'PRODUCT1' || code === 'PRODUCT2') {
      result.kitchenBranches.push(branch);
    } else {
      result.storefrontBranches.push(branch);
    }
  }
  return result;
};
