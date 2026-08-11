import {
  mapBqeContractType,
  mapBqeStatus,
  type BqeEmployee,
  type BqeInvoice,
  type BqeProject,
  type BqeTimeEntry,
} from './bqe';

export type ProjectInsert = {
  project: string;
  client: string | null;
  city: string | null;
  manager: string | null;
  status: string;
  type: string | null;
  phase: string;
  contract: number;
  spent: number;
  billed: number;
  pct_used: number | null;
  pct_billed: number | null;
  retainer_paid: number;
  retainer_balance: number;
  ar: number;
  profit: number;
  margin: number | null;
  row_kind: 'project' | 'phase';
  parent_project: string | null;
  billed_hours: number | null;
  spent_hours: number | null;
  contract_outstanding: number | null;
  sort_order: number;
};

export type EmpMonthlyInsert = {
  employee: string;
  month: string;
  nb_hours: number;
  bill_hours: number;
  total_hours: number;
  efficiency: number;
  pto_hours: number;
  network_days: number;
  standard_hours: number;
};

export type EmpTotalInsert = {
  employee: string;
  bill_hours: number;
  nb_hours: number;
  total_hours: number;
  standard_hours: number;
  efficiency: number;
};

export type CompanyMonthlyInsert = {
  month: string;
  bill_hours: number;
  nb_hours: number;
  total_hours: number;
  standard_hours: number;
  efficiency: number;
};

export type ArClientInsert = {
  client: string;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d91_plus: number;
  credit: number;
  balance: number;
};

export type InvoiceLedgerInsert = {
  client: string | null;
  invoice_date: string | null;
  payment_date: string | null;
  net: number;
  balance: number;
};

export type MonthlyRevenueInsert = {
  month: string;
  gross_billed: number;
  amount_paid: number;
  net_billed: number;
};

export type ProjectMonthlyBilledInsert = {
  project: string;
  month: string;
  amount: number;
};

export type ClientMonthlyBilledInsert = {
  client: string;
  month: string;
  amount: number;
};

export type RosterInsert = {
  team: string;
  employee: string;
};

type MoneyHours = {
  spentHours: number;
  billedHours: number;
  earned: number;
  cost: number;
};

function displayOf(p: BqeProject): string {
  return (p.displayName || p.name || p.code || 'Untitled').trim() || 'Untitled';
}

function allocateUnique(base: string, id: string, used: Set<string>): string {
  const clean = base.replace(/\s+/g, ' ').trim() || 'Untitled';
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const withCode = id ? `${clean} [${id.slice(0, 8)}]` : clean;
  if (!used.has(withCode)) {
    used.add(withCode);
    return withCode;
  }
  let n = 2;
  for (;;) {
    const candidate = `${clean} (${n})`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : null;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function networkDaysInMonth(ym: string): number {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return 22;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = 1; day <= days; day += 1) {
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

function ageBucket(invoiceDate: string | null | undefined, today: Date): keyof Pick<
  ArClientInsert,
  'd0_30' | 'd31_60' | 'd61_90' | 'd91_plus'
> {
  if (!invoiceDate) return 'd0_30';
  const d = new Date(invoiceDate);
  if (Number.isNaN(d.getTime())) return 'd0_30';
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd91_plus';
}

function emptyMoney(): MoneyHours {
  return { spentHours: 0, billedHours: 0, earned: 0, cost: 0 };
}

export type MappedProjects = {
  rows: ProjectInsert[];
  idToKey: Map<string, string>;
  /** CORE id → parent CORE id (for rolling phase → root when needed) */
  idToParentId: Map<string, string | null>;
};

export function mapCoreProjects(projects: BqeProject[]): MappedProjects {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const used = new Set<string>();
  const idToKey = new Map<string, string>();
  const idToParentId = new Map<string, string | null>();

  const roots = projects.filter((p) => !p.parentId || !byId.has(p.parentId));
  const phases = projects.filter((p) => p.parentId && byId.has(p.parentId));

  const rows: ProjectInsert[] = [];
  let sort = 0;

  for (const p of roots) {
    const key = allocateUnique(displayOf(p), p.id, used);
    idToKey.set(p.id, key);
    idToParentId.set(p.id, null);
    const city =
      Array.isArray(p.address) && p.address[0]?.city ? String(p.address[0].city) : null;
    rows.push({
      project: key,
      client: p.client || null,
      city,
      manager: p.manager || null,
      status: mapBqeStatus(p.status),
      type: mapBqeContractType(p.contractType),
      phase: 'Other',
      contract: Number(p.contractAmount ?? p.serviceContract ?? 0) || 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'project',
      parent_project: null,
      billed_hours: 0,
      spent_hours: 0,
      contract_outstanding: 0,
      sort_order: sort++,
    });
  }

  for (const p of phases) {
    const parent = byId.get(p.parentId!)!;
    const parentKey = idToKey.get(parent.id) || displayOf(parent);
    const phaseName = (p.phaseDescription || p.phaseName || displayOf(p)).trim() || 'Phase';
    const base = `${parentKey} - ${phaseName}`;
    const key = allocateUnique(base, p.id, used);
    idToKey.set(p.id, key);
    idToParentId.set(p.id, parent.id);
    const city =
      Array.isArray(p.address) && p.address[0]?.city
        ? String(p.address[0].city)
        : Array.isArray(parent.address) && parent.address[0]?.city
          ? String(parent.address[0].city)
          : null;
    rows.push({
      project: key,
      client: p.client || parent.client || null,
      city,
      manager: p.manager || parent.manager || null,
      status: mapBqeStatus(p.status ?? parent.status),
      type: mapBqeContractType(p.contractType ?? parent.contractType),
      phase: phaseName,
      contract: Number(p.contractAmount ?? p.serviceContract ?? 0) || 0,
      spent: 0,
      billed: 0,
      pct_used: null,
      pct_billed: null,
      retainer_paid: 0,
      retainer_balance: 0,
      ar: 0,
      profit: 0,
      margin: null,
      row_kind: 'phase',
      parent_project: parentKey,
      billed_hours: 0,
      spent_hours: 0,
      contract_outstanding: 0,
      sort_order: sort++,
    });
  }

  return { rows, idToKey, idToParentId };
}

function resolveProjectKey(
  projectId: string | null | undefined,
  idToKey: Map<string, string>,
): string | null {
  if (!projectId) return null;
  return idToKey.get(projectId) || null;
}

export function applyTimeAndInvoices(
  mapped: MappedProjects,
  timeEntries: BqeTimeEntry[],
  invoices: BqeInvoice[],
): {
  projects: ProjectInsert[];
  empMonthly: EmpMonthlyInsert[];
  empTotals: EmpTotalInsert[];
  companyMonthly: CompanyMonthlyInsert[];
  arClients: ArClientInsert[];
  invoiceLedger: InvoiceLedgerInsert[];
  monthlyRevenue: MonthlyRevenueInsert[];
  projectMonthlyBilled: ProjectMonthlyBilledInsert[];
  clientMonthlyBilled: ClientMonthlyBilledInsert[];
  stats: {
    timeEntries: number;
    invoices: number;
    matchedTime: number;
    matchedInvoiceLines: number;
  };
} {
  const { rows, idToKey } = mapped;
  const byKey = new Map(rows.map((r) => [r.project, { ...r }]));

  const projMoney = new Map<string, MoneyHours>();
  const empMonth = new Map<string, { bill: number; nb: number }>();
  const companyMonth = new Map<string, { bill: number; nb: number }>();

  let matchedTime = 0;
  for (const te of timeEntries) {
    const hours = Number(te.actualHours) || 0;
    if (!hours) continue;
    const key = resolveProjectKey(te.projectId, idToKey);
    const billable = !!te.billable && !te.isWrittenOff;
    const billRate = Number(te.billRate) || 0;
    const costRate = Number(te.costRate) || 0;
    const earned = billable ? hours * billRate : 0;
    const cost = hours * costRate;

    if (key) {
      matchedTime += 1;
      const m = projMoney.get(key) || emptyMoney();
      m.spentHours += hours;
      if (billable) m.billedHours += hours;
      m.earned += earned;
      m.cost += cost;
      projMoney.set(key, m);
    }

    const emp = (te.resource || '').trim() || 'Unassigned';
    const month = monthKey(te.date);
    if (month) {
      const ek = `${emp}||${month}`;
      const cur = empMonth.get(ek) || { bill: 0, nb: 0 };
      if (billable) cur.bill += hours;
      else cur.nb += hours;
      empMonth.set(ek, cur);

      const cm = companyMonth.get(month) || { bill: 0, nb: 0 };
      if (billable) cm.bill += hours;
      else cm.nb += hours;
      companyMonth.set(month, cm);
    }
  }

  const projBilled = new Map<string, number>();
  const projAr = new Map<string, number>();
  const pmb = new Map<string, number>();
  const cmb = new Map<string, number>();
  const rev = new Map<string, { gross: number; paid: number }>();
  const arByClient = new Map<string, ArClientInsert>();
  const ledger: InvoiceLedgerInsert[] = [];
  const today = new Date();
  let matchedInvoiceLines = 0;

  for (const inv of invoices) {
    if (inv.isVoid || inv.isDraft) continue;
    const invAmount = Number(inv.invoiceAmount) || 0;
    const invBalance = Number(inv.balance) || 0;
    const paid = Math.max(0, invAmount - invBalance);
    const month = monthKey(inv.date);
    if (month) {
      const r = rev.get(month) || { gross: 0, paid: 0 };
      r.gross += invAmount;
      r.paid += paid;
      rev.set(month, r);
    }

    const details = Array.isArray(inv.invoiceDetails) ? inv.invoiceDetails : [];
    const usable = details.filter((d) => d.projectId || d.client);
    const detailSum = usable.reduce((a, d) => a + (Number(d.amount) || 0), 0);

    let ledgerClient: string | null = null;

    if (usable.length) {
      for (const d of usable) {
        const amt = Number(d.amount) || 0;
        const share = detailSum > 0 ? amt / detailSum : 1 / usable.length;
        const lineBilled = detailSum > 0 ? amt : invAmount * share;
        const lineAr = invBalance * share;
        const client = (d.client || '').trim() || 'Unassigned';
        ledgerClient = ledgerClient || client;
        const pKey = resolveProjectKey(d.projectId, idToKey);
        if (pKey) {
          matchedInvoiceLines += 1;
          projBilled.set(pKey, (projBilled.get(pKey) || 0) + lineBilled);
          projAr.set(pKey, (projAr.get(pKey) || 0) + lineAr);
          if (month) {
            const pk = `${pKey}||${month}`;
            pmb.set(pk, (pmb.get(pk) || 0) + lineBilled);
          }
        }
        if (month) {
          const ck = `${client}||${month}`;
          cmb.set(ck, (cmb.get(ck) || 0) + lineBilled);
        }
        if (lineAr !== 0 || client) {
          const row =
            arByClient.get(client) ||
            ({
              client,
              d0_30: 0,
              d31_60: 0,
              d61_90: 0,
              d91_plus: 0,
              credit: 0,
              balance: 0,
            } satisfies ArClientInsert);
          if (lineAr < 0) row.credit += -lineAr;
          else {
            row[ageBucket(inv.date, today)] += lineAr;
            row.balance += lineAr;
          }
          arByClient.set(client, row);
        }
      }
    } else if (invAmount || invBalance) {
      // No details — still count revenue; AR under Unassigned
      const client = 'Unassigned';
      ledgerClient = client;
      const row =
        arByClient.get(client) ||
        ({
          client,
          d0_30: 0,
          d31_60: 0,
          d61_90: 0,
          d91_plus: 0,
          credit: 0,
          balance: 0,
        } satisfies ArClientInsert);
      if (invBalance < 0) row.credit += -invBalance;
      else {
        row[ageBucket(inv.date, today)] += invBalance;
        row.balance += invBalance;
      }
      arByClient.set(client, row);
    }

    ledger.push({
      client: ledgerClient,
      invoice_date: inv.date ? String(inv.date).slice(0, 10) : null,
      payment_date: null,
      net: invAmount,
      balance: invBalance,
    });
  }

  // Apply money/hours onto project rows
  for (const [key, row] of byKey) {
    const mh = projMoney.get(key) || emptyMoney();
    const billed = projBilled.get(key) || 0;
    const ar = projAr.get(key) || 0;
    // Spent ≈ earned fees from timecards (burn against contract); fall back to billed
    const spent = mh.earned > 0 ? mh.earned : billed;
    const cost = mh.cost;
    const profit = billed - cost;
    const contract = row.contract || 0;
    row.spent_hours = mh.spentHours;
    row.billed_hours = mh.billedHours;
    row.spent = spent;
    row.billed = billed;
    row.ar = ar;
    row.contract_outstanding = ar;
    row.profit = profit;
    row.margin = billed > 0 ? profit / billed : null;
    row.pct_used = contract > 0 ? spent / contract : null;
    row.pct_billed = contract > 0 ? billed / contract : null;
    byKey.set(key, row);
  }

  // Add phase totals onto parent headers for project-level display.
  // KPIs use phase/detail rows when present, so this does not double-count firm totals.
  const childrenByParent = new Map<string, ProjectInsert[]>();
  for (const row of byKey.values()) {
    if (row.row_kind !== 'phase' || !row.parent_project) continue;
    const list = childrenByParent.get(row.parent_project) || [];
    list.push(row);
    childrenByParent.set(row.parent_project, list);
  }
  for (const [parentKey, children] of childrenByParent) {
    const parent = byKey.get(parentKey);
    if (!parent) continue;
    parent.spent = (parent.spent || 0) + children.reduce((a, c) => a + (c.spent || 0), 0);
    parent.billed = (parent.billed || 0) + children.reduce((a, c) => a + (c.billed || 0), 0);
    parent.ar = (parent.ar || 0) + children.reduce((a, c) => a + (c.ar || 0), 0);
    parent.spent_hours =
      (parent.spent_hours || 0) + children.reduce((a, c) => a + (c.spent_hours || 0), 0);
    parent.billed_hours =
      (parent.billed_hours || 0) + children.reduce((a, c) => a + (c.billed_hours || 0), 0);
    parent.profit = (parent.profit || 0) + children.reduce((a, c) => a + (c.profit || 0), 0);
    parent.contract_outstanding = parent.ar;
    if (parent.contract > 0) {
      parent.pct_used = parent.spent / parent.contract;
      parent.pct_billed = parent.billed / parent.contract;
    }
    parent.margin = parent.billed > 0 ? parent.profit / parent.billed : null;
    byKey.set(parentKey, parent);
  }

  const empMonthly: EmpMonthlyInsert[] = [];
  const empTotalsMap = new Map<string, EmpTotalInsert>();

  for (const [ek, v] of empMonth) {
    const [employee, month] = ek.split('||');
    const total = v.bill + v.nb;
    const network_days = networkDaysInMonth(month);
    const standard_hours = network_days * 8;
    const efficiency = standard_hours > 0 ? v.bill / standard_hours : 0;
    empMonthly.push({
      employee,
      month,
      bill_hours: v.bill,
      nb_hours: v.nb,
      total_hours: total,
      efficiency,
      pto_hours: 0,
      network_days,
      standard_hours,
    });
    const t = empTotalsMap.get(employee) || {
      employee,
      bill_hours: 0,
      nb_hours: 0,
      total_hours: 0,
      standard_hours: 0,
      efficiency: 0,
    };
    t.bill_hours += v.bill;
    t.nb_hours += v.nb;
    t.total_hours += total;
    t.standard_hours += standard_hours;
    empTotalsMap.set(employee, t);
  }

  const empTotals = [...empTotalsMap.values()].map((t) => ({
    ...t,
    efficiency: t.standard_hours > 0 ? t.bill_hours / t.standard_hours : 0,
  }));

  const companyMonthly: CompanyMonthlyInsert[] = [...companyMonth.entries()].map(
    ([month, v]) => {
      const network_days = networkDaysInMonth(month);
      // Approximate firm capacity from distinct employees that month
      const empCount = empMonthly.filter((e) => e.month === month).length || 1;
      const standard_hours = network_days * 8 * empCount;
      const bill_hours = v.bill;
      const nb_hours = v.nb;
      return {
        month,
        bill_hours,
        nb_hours,
        total_hours: bill_hours + nb_hours,
        standard_hours,
        efficiency: standard_hours > 0 ? bill_hours / standard_hours : 0,
      };
    },
  );

  const monthlyRevenue: MonthlyRevenueInsert[] = [...rev.entries()].map(([month, r]) => ({
    month,
    gross_billed: r.gross,
    amount_paid: r.paid,
    net_billed: r.gross,
  }));

  const projectMonthlyBilled: ProjectMonthlyBilledInsert[] = [...pmb.entries()].map((e) => {
    const [project, month] = e[0].split('||');
    return { project, month, amount: e[1] };
  });

  const clientMonthlyBilled: ClientMonthlyBilledInsert[] = [...cmb.entries()].map((e) => {
    const [client, month] = e[0].split('||');
    return { client, month, amount: e[1] };
  });

  return {
    projects: [...byKey.values()].sort((a, b) => a.sort_order - b.sort_order),
    empMonthly,
    empTotals,
    companyMonthly,
    arClients: [...arByClient.values()],
    invoiceLedger: ledger,
    monthlyRevenue,
    projectMonthlyBilled,
    clientMonthlyBilled,
    stats: {
      timeEntries: timeEntries.length,
      invoices: invoices.length,
      matchedTime,
      matchedInvoiceLines,
    },
  };
}

export function mapEmployeesToRoster(employees: BqeEmployee[]): RosterInsert[] {
  const out: RosterInsert[] = [];
  const seen = new Set<string>();
  for (const e of employees) {
    const status = String(e.status ?? '').toLowerCase();
    if (status.includes('terminat') || status === '2') continue;
    const name = `${e.firstName || ''} ${e.lastName || ''}`.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const team = (e.department || e.title || 'Staff').trim() || 'Staff';
    const k = `${team}||${name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ team, employee: name });
  }
  return out;
}
