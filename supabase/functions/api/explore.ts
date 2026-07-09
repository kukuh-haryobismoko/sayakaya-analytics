// Ported 1:1 from server/explore.js — registry of browsable datasets for the
// Data Explorer. All SQL is server-defined; only values (search text, filter
// choices, dates, paging) come from the user via named parameters.
// users.password and the sensitive KYC fields (id_number, mothers_maiden_name,
// photo/selfie/signature URLs, full home address) are never exposed.

interface ColumnDef { key: string; label: string; type?: string }
interface FilterDef { key: string; col: string; bool?: boolean; values?: string[] }
interface DatasetDef {
  label: string; from: string; select: string; columns: ColumnDef[];
  dateCol: string | null; baseWhere?: string; filters: FilterDef[]; search: string[];
  order: string; friendlyExport?: boolean;
}

// Active holdings = live portfolios + on_going bonus portfolios. Reused by the
// Holdings explorer and the "AUM by fund" report so both match the AUM KPI.
const ACTIVE_HOLDINGS = `(
  SELECT p.user_id, p.fund_id, p.unit, p.created_at, 'regular' AS source
  FROM \`sayakaya.main.portfolios\` p
  WHERE p.deleted_at IS NULL AND p.unit > 0
  UNION ALL
  SELECT bp.user_id, bp.fund_id, bp.unit, bp.created_at, 'bonus' AS source
  FROM \`sayakaya.main.bonus_portfolios\` bp
  WHERE bp.status = 'on_going'
)`;

const DATASETS: Record<string, DatasetDef> = {
  transactions: {
    label: 'Transactions',
    from: `\`sayakaya.main.transactions\` t
      LEFT JOIN \`sayakaya.main.users\` u ON u.id = t.user_id
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = t.user_id`,
    select: `
      t.transaction_number, t.created_at, t.user_id, up.name AS investor,
      u.email, up.phone_number AS phone, u.sid_code AS sid, u.ifua_code AS ifua,
      t.fund_id, t.type, t.status, t.unit, t.final_amount, t.payment_method,
      t.realized_gain_loss`,
    columns: [
      { key: 'transaction_number', label: 'Tx #' },
      { key: 'created_at', label: 'Created', type: 'datetime' },
      { key: 'user_id', label: 'User ID' },
      { key: 'investor', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'sid', label: 'SID' },
      { key: 'ifua', label: 'IFUA' },
      { key: 'fund_id', label: 'Fund' },
      { key: 'type', label: 'Type', type: 'tag' },
      { key: 'status', label: 'Status', type: 'tag' },
      { key: 'unit', label: 'Unit', type: 'num4' },
      { key: 'final_amount', label: 'Final amount', type: 'idr' },
      { key: 'payment_method', label: 'Payment' },
      { key: 'realized_gain_loss', label: 'Gain/Loss', type: 'idr' },
    ],
    dateCol: 't.created_at',
    filters: [{ key: 'type', col: 't.type' }, { key: 'status', col: 't.status' }],
    search: ['t.user_id', 't.id', 't.transaction_number', 'u.email', 'up.name', 'u.sid_code'],
    order: 't.created_at DESC',
  },

  holdings: {
    label: 'Holdings & AUM',
    from: `${ACTIVE_HOLDINGS} h
      JOIN \`sayakaya.main.funds\` f ON f.id = h.fund_id
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = h.user_id`,
    select: `
      h.user_id, up.name AS investor, f.name AS fund, f.type AS fund_type,
      h.source, h.unit, f.latest_nav_value AS nav,
      ROUND(h.unit * f.latest_nav_value) AS current_value, h.created_at AS opened_at`,
    columns: [
      { key: 'user_id', label: 'User' },
      { key: 'investor', label: 'Investor' },
      { key: 'fund', label: 'Fund' },
      { key: 'fund_type', label: 'Fund type', type: 'tag' },
      { key: 'source', label: 'Source', type: 'tag' },
      { key: 'unit', label: 'Units', type: 'num4' },
      { key: 'nav', label: 'NAV', type: 'num' },
      { key: 'current_value', label: 'Current value', type: 'idr' },
      { key: 'opened_at', label: 'Opened', type: 'datetime' },
    ],
    dateCol: 'h.created_at',
    filters: [
      { key: 'fund_type', col: 'f.type' },
      { key: 'source', col: 'h.source', values: ['regular', 'bonus'] },
    ],
    search: ['h.user_id', 'f.name', 'up.name'],
    order: 'current_value DESC',
  },

  aum_by_fund: {
    label: 'AUM by fund',
    from: `(
        SELECT h.fund_id, COUNT(DISTINCT h.user_id) AS holders, SUM(h.unit) AS units
        FROM ${ACTIVE_HOLDINGS} h GROUP BY h.fund_id
      ) a
      JOIN \`sayakaya.main.funds\` f ON f.id = a.fund_id
      LEFT JOIN \`sayakaya.main.investment_managers\` im ON im.id = f.investment_manager_id`,
    select: `
      f.name AS fund, f.type AS fund_type, COALESCE(im.common_name, im.name) AS manager,
      a.holders, ROUND(a.units * f.latest_nav_value) AS sayakaya_aum,
      f.latest_aum_value AS market_aum, f.latest_nav_value AS nav`,
    columns: [
      { key: 'fund', label: 'Fund' },
      { key: 'fund_type', label: 'Type', type: 'tag' },
      { key: 'manager', label: 'Manager' },
      { key: 'holders', label: 'Holders', type: 'num' },
      { key: 'sayakaya_aum', label: 'Sayakaya AUM', type: 'idr' },
      { key: 'market_aum', label: 'Market AUM', type: 'idr' },
      { key: 'nav', label: 'NAV', type: 'num' },
    ],
    dateCol: null,
    filters: [{ key: 'fund_type', col: 'f.type' }],
    search: ['f.name'],
    order: 'sayakaya_aum DESC NULLS LAST',
  },

  funds: {
    label: 'Funds',
    from: `\`sayakaya.main.funds\` f
      LEFT JOIN \`sayakaya.main.investment_managers\` im ON im.id = f.investment_manager_id`,
    select: `
      f.name, f.type, f.is_sharia, f.listing_status,
      f.latest_nav_value AS nav, f.latest_aum_value AS aum,
      f.management_fee, f.expense_ratio, COALESCE(im.common_name, im.name) AS manager,
      f.latest_aum_date`,
    columns: [
      { key: 'name', label: 'Fund' },
      { key: 'type', label: 'Type', type: 'tag' },
      { key: 'is_sharia', label: 'Sharia', type: 'bool' },
      { key: 'listing_status', label: 'Status', type: 'tag' },
      { key: 'nav', label: 'NAV', type: 'num' },
      { key: 'aum', label: 'Market AUM', type: 'idr' },
      { key: 'management_fee', label: 'Mgmt fee %', type: 'num' },
      { key: 'expense_ratio', label: 'Expense %', type: 'num' },
      { key: 'manager', label: 'Manager' },
      { key: 'latest_aum_date', label: 'AUM date', type: 'date' },
    ],
    dateCol: null,
    filters: [
      { key: 'type', col: 'f.type' },
      { key: 'listing_status', col: 'f.listing_status' },
      { key: 'is_sharia', col: 'f.is_sharia', bool: true },
    ],
    search: ['f.name'],
    order: 'f.latest_aum_value DESC NULLS LAST',
  },

  users: {
    label: 'Users',
    from: `\`sayakaya.main.users\` u
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = u.id`,
    select: `
      u.id AS user_id, up.name, u.email, up.phone_number AS phone,
      u.sid_code AS sid, u.ifua_code AS ifua, up.gender, up.occupation,
      up.id_address_city AS city, up.monthly_income, up.total_asset,
      up.investment_risk_tolerance AS risk, u.verification_status, u.is_institution,
      u.created_at AS signed_up, u.verified_at`,
    columns: [
      { key: 'user_id', label: 'User ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'sid', label: 'SID' },
      { key: 'ifua', label: 'IFUA' },
      { key: 'gender', label: 'Gender' },
      { key: 'occupation', label: 'Occupation' },
      { key: 'city', label: 'City' },
      { key: 'monthly_income', label: 'Monthly income', type: 'idr' },
      { key: 'total_asset', label: 'Total asset', type: 'idr' },
      { key: 'risk', label: 'Risk' },
      { key: 'verification_status', label: 'Verification', type: 'tag' },
      { key: 'is_institution', label: 'Institution', type: 'bool' },
      { key: 'signed_up', label: 'Signed up', type: 'datetime' },
      { key: 'verified_at', label: 'Verified', type: 'datetime' },
    ],
    dateCol: 'u.created_at',
    filters: [
      { key: 'verification_status', col: 'u.verification_status' },
      { key: 'gender', col: 'up.gender' },
      { key: 'is_institution', col: 'u.is_institution', bool: true },
    ],
    search: ['u.id', 'u.email', 'up.name', 'up.phone_number', 'u.sid_code', 'u.ifua_code'],
    order: 'u.created_at DESC',
  },

  bonus: {
    label: 'Bonus portfolios',
    from: `\`sayakaya.main.bonus_portfolios\` bp
      JOIN \`sayakaya.main.funds\` f ON f.id = bp.fund_id
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = bp.user_id`,
    select: `
      bp.user_id, up.name AS investor, f.name AS fund, bp.promo_code,
      bp.status, bp.unit, f.latest_nav_value AS nav,
      ROUND(bp.unit * f.latest_nav_value) AS value, bp.created_at, bp.redeemed_at`,
    columns: [
      { key: 'user_id', label: 'User' },
      { key: 'investor', label: 'Investor' },
      { key: 'fund', label: 'Fund' },
      { key: 'promo_code', label: 'Promo' },
      { key: 'status', label: 'Status', type: 'tag' },
      { key: 'unit', label: 'Units', type: 'num4' },
      { key: 'nav', label: 'NAV', type: 'num' },
      { key: 'value', label: 'Value', type: 'idr' },
      { key: 'created_at', label: 'Granted', type: 'datetime' },
      { key: 'redeemed_at', label: 'Redeemed', type: 'datetime' },
    ],
    dateCol: 'bp.created_at',
    filters: [{ key: 'status', col: 'bp.status' }],
    search: ['bp.user_id', 'f.name', 'bp.promo_code', 'up.name'],
    order: 'value DESC NULLS LAST',
  },

  switching: {
    label: 'Switching',
    from: `\`sayakaya.main.switching_transactions\` s
      LEFT JOIN \`sayakaya.main.funds\` fo ON fo.id = s.origin_fund_id
      LEFT JOIN \`sayakaya.main.funds\` fd ON fd.id = s.destination_fund_id
      LEFT JOIN \`sayakaya.main.user_profiles\` up ON up.user_id = s.user_id`,
    select: `
      s.transaction_number, s.created_at, s.user_id, up.name AS investor,
      fo.name AS from_fund, fd.name AS to_fund, s.origin_amount AS amount, s.status`,
    columns: [
      { key: 'transaction_number', label: 'Tx #' },
      { key: 'created_at', label: 'Created', type: 'datetime' },
      { key: 'user_id', label: 'User' },
      { key: 'investor', label: 'Investor' },
      { key: 'from_fund', label: 'From fund' },
      { key: 'to_fund', label: 'To fund' },
      { key: 'amount', label: 'Amount', type: 'idr' },
      { key: 'status', label: 'Status', type: 'tag' },
    ],
    dateCol: 's.created_at',
    filters: [{ key: 'status', col: 's.status' }],
    search: ['s.user_id', 's.transaction_number', 'up.name'],
    order: 's.created_at DESC',
  },

  managers: {
    label: 'Investment Managers',
    from: '`sayakaya.main.investment_managers` im',
    select: `
      COALESCE(im.common_name, im.name) AS manager, im.ojk_code,
      (SELECT COUNT(*) FROM \`sayakaya.main.funds\` f WHERE f.investment_manager_id = im.id) AS fund_count,
      im.latest_aum_value AS aum, im.latest_aum_date, im.website_url`,
    columns: [
      { key: 'manager', label: 'Manager' },
      { key: 'ojk_code', label: 'OJK code' },
      { key: 'fund_count', label: 'Funds', type: 'num' },
      { key: 'aum', label: 'Market AUM', type: 'idr' },
      { key: 'latest_aum_date', label: 'AUM date', type: 'date' },
      { key: 'website_url', label: 'Website' },
    ],
    dateCol: null,
    filters: [],
    search: ['im.common_name', 'im.name', 'im.ojk_code'],
    order: 'im.latest_aum_value DESC NULLS LAST',
  },
  // Raw KSEI/SInvest custodian feed, never cleaned — every column is STRING.
  // SQL keeps the table's own column names (BigQuery aliases can't contain
  // ".", "/", "(", ")", which the custodian's field names use) — the
  // friendly rename to those exact field names (see the column `label`s)
  // happens only at export time, via `friendlyExport` + exportRename().
  // Transaction_Date is 'YYYYMMDD' text, so the date filter parses it
  // before the generic DATE(dateCol) wrapper.
  sinvest_trx: {
    label: 'Sinvest Transactions',
    from: '`sayakaya.sinvest.trx_history`',
    select: `
      Transaction_Date, Transaction_Type, Investor_Fund_Unit_A_C_No, Investor_Fund_Unit_A_C_Name,
      SID, Fund_Code, Fund_Name, IM_Code, IM_Name, CB_Code, CB_Name, SA_Code, SA_Name,
      Number_of_Units, NAV_per_Unit, Gross_Transaction_Amount, Transaction_Fee__Nominal,
      Net_Transaction_Amount, Reference_No, SA_Reference_No, Input_Date, Realized_Gain_Loss, Remarks`,
    columns: [
      { key: 'Transaction_Date', label: 'Transaction Date' },
      { key: 'Transaction_Type', label: 'Transaction Type', type: 'tag' },
      { key: 'Investor_Fund_Unit_A_C_No', label: 'Investor Fund Unit A/C No.' },
      { key: 'Investor_Fund_Unit_A_C_Name', label: 'Investor Fund Unit A/C Name' },
      { key: 'SID', label: 'SID' },
      { key: 'Fund_Code', label: 'Fund Code' },
      { key: 'Fund_Name', label: 'Fund Name' },
      { key: 'IM_Code', label: 'IM Code' },
      { key: 'IM_Name', label: 'IM Name' },
      { key: 'CB_Code', label: 'CB Code' },
      { key: 'CB_Name', label: 'CB Name' },
      { key: 'SA_Code', label: 'SA Code' },
      { key: 'SA_Name', label: 'SA Name' },
      { key: 'Number_of_Units', label: 'Number of Units', type: 'num4' },
      { key: 'NAV_per_Unit', label: 'NAV per Unit', type: 'num' },
      { key: 'Gross_Transaction_Amount', label: 'Gross Transaction Amount', type: 'num' },
      { key: 'Transaction_Fee__Nominal', label: 'Transaction Fee (Nominal)', type: 'num' },
      { key: 'Net_Transaction_Amount', label: 'Net Transaction Amount', type: 'num' },
      { key: 'Reference_No', label: 'Reference No.' },
      { key: 'SA_Reference_No', label: 'SA Reference No.' },
      { key: 'Input_Date', label: 'Input Date' },
      { key: 'Realized_Gain_Loss', label: 'Realized Gain/Loss', type: 'num' },
      { key: 'Remarks', label: 'Remarks' },
    ],
    dateCol: "SAFE.PARSE_DATE('%Y%m%d', Transaction_Date)",
    filters: [{ key: 'Transaction_Type', col: 'Transaction_Type' }],
    search: ['SID', 'Investor_Fund_Unit_A_C_Name', 'Fund_Name', 'Fund_Code', 'Reference_No'],
    order: 'Transaction_Date DESC',
    friendlyExport: true,
  },

  campaigns: {
    label: 'Campaigns',
    from: '`sayakaya.main.campaigns` c',
    select: `
      c.name, c.campaign_type, c.promo_code, c.quota, c.used_quota,
      ROUND(SAFE_DIVIDE(c.used_quota, c.quota) * 100, 1) AS redemption_pct,
      c.bonus_amount, c.start_date, c.end_date`,
    columns: [
      { key: 'name', label: 'Campaign' },
      { key: 'campaign_type', label: 'Type', type: 'tag' },
      { key: 'promo_code', label: 'Promo code' },
      { key: 'quota', label: 'Quota', type: 'num' },
      { key: 'used_quota', label: 'Used', type: 'num' },
      { key: 'redemption_pct', label: 'Redemption %', type: 'num' },
      { key: 'bonus_amount', label: 'Bonus', type: 'idr' },
      { key: 'start_date', label: 'Start', type: 'date' },
      { key: 'end_date', label: 'End', type: 'date' },
    ],
    dateCol: 'c.start_date',
    baseWhere: 'c.deleted_at IS NULL',
    filters: [{ key: 'campaign_type', col: 'c.campaign_type' }],
    search: ['c.name', 'c.promo_code'],
    order: 'c.used_quota DESC NULLS LAST',
  },
};

export function meta() {
  return Object.entries(DATASETS).map(([key, d]) => ({
    key, label: d.label, columns: d.columns,
    filters: d.filters.map((f) => ({ key: f.key, bool: Boolean(f.bool), values: f.values || null })),
    hasDate: Boolean(d.dateCol),
  }));
}

function buildWhere(d: DatasetDef, q: Record<string, string | undefined>, params: Record<string, unknown>): string {
  const clauses: string[] = [];
  if (d.baseWhere) clauses.push(d.baseWhere);
  if (d.dateCol && (q.from || q.to)) {
    params.from = q.from || '2000-01-01';
    params.to = q.to || '2100-01-01';
    clauses.push(`DATE(${d.dateCol}) BETWEEN @from AND @to`);
  }
  for (const f of d.filters) {
    const v = q[f.key];
    if (v === undefined || v === '' || v === null) continue;
    clauses.push(`${f.col} = @${f.key}`);
    params[f.key] = f.bool ? (v === 'true' || (v as unknown) === true) : v;
  }
  if (q.search && q.search.trim()) {
    params.search = `%${q.search.trim().toLowerCase()}%`;
    const ors = d.search.map((c) => `LOWER(CAST(${c} AS STRING)) LIKE @search`).join(' OR ');
    clauses.push(`(${ors})`);
  }
  return clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
}

export function buildExplore(datasetKey: string, q: Record<string, string | undefined>) {
  const d = DATASETS[datasetKey];
  if (!d) throw new Error('Unknown dataset.');
  const params: Record<string, unknown> = {};
  const where = buildWhere(d, q, params);
  const limit = Math.min(parseInt(String(q.limit), 10) || 50, 100000);
  const offset = parseInt(String(q.offset), 10) || 0;
  params.limit = limit; params.offset = offset;
  const sql = `SELECT ${d.select} FROM ${d.from} ${where} ORDER BY ${d.order} LIMIT @limit OFFSET @offset`;
  const countSql = `SELECT COUNT(*) AS total FROM ${d.from} ${where}`;
  return { sql, countSql, params };
}

export function filterValuesSql(datasetKey: string, filterKey: string): string | null {
  const d = DATASETS[datasetKey];
  if (!d) throw new Error('Unknown dataset.');
  const f = d.filters.find((x) => x.key === filterKey);
  if (!f || f.bool || f.values) return null; // bool/preset filters need no query
  return `SELECT DISTINCT ${f.col} AS v FROM ${d.from}
          ${d.baseWhere ? 'WHERE ' + d.baseWhere + ' AND' : 'WHERE'} ${f.col} IS NOT NULL
          ORDER BY v LIMIT 200`;
}

// key -> label map for datasets opted into friendlyExport, so the exported
// file's headers match the source field names exactly. null for everything
// else, so existing exports (headers = SQL column names) stay unchanged.
export function exportRename(datasetKey: string): Record<string, string> | null {
  const d = DATASETS[datasetKey];
  if (!d || !d.friendlyExport) return null;
  return Object.fromEntries(d.columns.map((c) => [c.key, c.label]));
}

export { DATASETS };
