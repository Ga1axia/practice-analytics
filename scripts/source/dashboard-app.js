
const DATA = JSON.parse(document.getElementById('dashboard-data').textContent);

// Some tables are stored compactly (columnar, dictionary-encoded, day-offset
// dates) to keep the file size down. Decode them back into plain arrays of
// objects here, once, so every other function below can use them exactly as
// before with zero changes.
function decodeTable(t){
  if(!t || !Array.isArray(t.__cols__)) return t;
  const cols = t.__cols__, rows = t.__rows__, dicts = t.__dicts__||{}, dateCols = new Set(t.__dates__||[]);
  const epochMs = t.__epoch__ ? new Date(t.__epoch__+'T00:00:00').getTime() : null;
  return rows.map(row=>{
    const obj = {};
    cols.forEach((c,i)=>{
      let v = row[i];
      if(dicts[c] !== undefined){ v = (v===null||v===undefined) ? null : dicts[c][v]; }
      else if(dateCols.has(c)){ v = (v===null||v===undefined) ? null : new Date(epochMs + v*86400000).toISOString().slice(0,10); }
      obj[c] = v;
    });
    return obj;
  });
}
['projects','invoice_ledger','emp_monthly','ar_clients','top_overdue','top_clients','phase_analysis','manager_perf'].forEach(k=>{
  if(DATA[k]) DATA[k] = decodeTable(DATA[k]);
});
const fmtUSD = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtUSDk = n => {
  const a = Math.abs(n);
  if(a>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if(a>=1e3) return '$'+(n/1e3).toFixed(0)+'K';
  return '$'+Math.round(n);
};
const fmtPct = n => (n*100).toFixed(1)+'%';
const palette = {navy:'#101B2D',gold:'#A8783A',rust:'#B3261E',teal:'#146C6B',green:'#2E7D46',line:'#4C6580'};

/* ---------- Tab switching ---------- */
document.querySelectorAll('nav.sheets button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.sheets button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.sheet).classList.add('active');
  });
});

/* ---------- Title block ---------- */
document.getElementById('tb-asof').textContent = 'Jul 2026';
document.getElementById('tb-activeprojects').textContent = DATA.kpi_active.project_count;
document.getElementById('tb-totalcontract').textContent = fmtUSDk(DATA.kpi_all.contract_amount);
document.getElementById('tb-employees').textContent = DATA.emp_totals.length;

/***********************************************************
 * SHEET 1 — PROJECT ANALYSIS
 ***********************************************************/
let s1_sort = {key:'contract', dir:-1};
let s1_page = 0;
const S1_PAGE_SIZE = 25;

function populateSelect(id, values, labelFn){
  const el = document.getElementById(id);
  values.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = labelFn?labelFn(v):v;
    el.appendChild(opt);
  });
}
populateSelect('f-status', DATA.statuses.filter(s=>s!=='UNKNOWN'));
populateSelect('f-type', DATA.contract_types);

// Employee filter: restricted to the current staff roster, grouped by team
(function populateEmployeeFilter(){
  const sel = document.getElementById('f-manager');
  Object.entries(DATA.employee_roster).forEach(([team, names])=>{
    const grp = document.createElement('optgroup');
    grp.label = team;
    const teamOpt = document.createElement('option');
    teamOpt.value = 'TEAM:'+team; teamOpt.textContent = `All ${team} (aggregate)`;
    grp.appendChild(teamOpt);
    names.forEach(n=>{
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
})();

// Period (month) filter — drives billed-amount figures
(function populateMonthFilter(){
  const sel = document.getElementById('f-month');
  DATA.billing_months.slice().reverse().forEach(m=>{
    const opt = document.createElement('option');
    opt.value = m;
    const [y,mo] = m.split('-');
    opt.textContent = new Date(y, mo-1, 1).toLocaleString('en-US',{month:'short',year:'numeric'});
    sel.appendChild(opt);
  });
})();

function getSelectedMonth(){ return document.getElementById('f-month').value; }

// Returns the "billed" figure for a project row, respecting the Period filter.
// All-time when Period = All; that month's billed only when a Period is selected.
function getBilled(row, month){
  month = month===undefined ? getSelectedMonth() : month;
  if(!month) return row.billed;
  const m = DATA.project_monthly_billed[row.project];
  return (m && m[month]) || 0;
}

function getFilteredProjects(){
  const st = document.getElementById('f-status').value;
  const mg = document.getElementById('f-manager').value;
  const ty = document.getElementById('f-type').value;
  const q = document.getElementById('f-search').value.trim().toLowerCase();
  const teamRoster = mg.startsWith('TEAM:') ? (DATA.employee_roster[mg.slice(5)]||[]) : null;
  return DATA.projects.filter(p=>{
    if(st && p.status!==st) return false;
    if(mg){
      if(teamRoster){ if(!teamRoster.includes(p.manager)) return false; }
      else if(p.manager!==mg) return false;
    }
    if(ty && p.type!==ty) return false;
    if(q && !(p.project.toLowerCase().includes(q) || (p.client||'').toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderKPIs(rows){
  const month = getSelectedMonth();
  const contract = d3sum(rows,'contract');
  const spent = d3sum(rows,'spent');
  const billed = rows.reduce((a,r)=>a+getBilled(r,month),0);
  const ar = d3sum(rows,'ar');
  const retBal = d3sum(rows,'retainer_balance');
  const profit = d3sum(rows,'profit');
  const billedLabel = month ? `Billed — ${monthLabel(month)}` : 'Amount Billed (All-Time)';
  const kpis = [
    {k:'Contract Amount', v:fmtUSD(contract), cls:''},
    {k:'Amount Spent', v:fmtUSD(spent), cls:'accent-teal'},
    {k:billedLabel, v:fmtUSD(billed), cls:'accent-gold'},
    {k:'Amount Receivable', v:fmtUSD(ar), cls:'accent-rust'},
    {k:'Retainer Balance', v:fmtUSD(retBal), cls:''},
    {k:'Net Profit', v:fmtUSD(profit), cls:'accent-green'},
  ];
  document.getElementById('s1-kpis').innerHTML = kpis.map(x=>
    `<div class="kpi ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}</div></div>`
  ).join('');
}
function monthLabel(m){ const [y,mo]=m.split('-'); return new Date(y,mo-1,1).toLocaleString('en-US',{month:'short',year:'numeric'}); }
function d3sum(rows,key){ return rows.reduce((a,r)=>a+(r[key]||0),0); }

function renderTable(rows){
  const month = getSelectedMonth();
  rows = rows.slice().sort((a,b)=>{
    const k = s1_sort.key;
    let av = k==='billed' ? getBilled(a,month) : a[k];
    let bv = k==='billed' ? getBilled(b,month) : b[k];
    if(typeof av==='string'){ return s1_sort.dir*av.localeCompare(bv); }
    return s1_sort.dir*((av||0)-(bv||0));
  });
  document.getElementById('s1-count-tag').textContent = rows.length.toLocaleString()+' rows';
  const totalPages = Math.max(1, Math.ceil(rows.length/S1_PAGE_SIZE));
  if(s1_page>=totalPages) s1_page = totalPages-1;
  const pageRows = rows.slice(s1_page*S1_PAGE_SIZE, s1_page*S1_PAGE_SIZE+S1_PAGE_SIZE);
  const tbody = document.querySelector('#s1-table tbody');
  tbody.innerHTML = pageRows.map(r=>`
    <tr>
      <td>${r.project}</td>
      <td>${r.client||''}</td>
      <td>${r.manager}</td>
      <td><span class="badge ${r.status.toLowerCase()}">${r.status}</span></td>
      <td>${r.type}</td>
      <td class="num">${fmtUSD(r.contract)}</td>
      <td class="num">${fmtUSD(r.spent)}</td>
      <td class="num">${fmtUSD(getBilled(r,month))}</td>
      <td class="num">${fmtUSD(r.ar)}</td>
      <td class="num">${isFinite(r.margin)?fmtPct(r.margin):'—'}</td>
    </tr>`).join('');
  document.getElementById('s1-pageinfo').textContent = `Page ${s1_page+1} of ${totalPages}`;
  document.getElementById('s1-prev').disabled = s1_page===0;
  document.getElementById('s1-next').disabled = s1_page>=totalPages-1;
}

let chartBilling, chartMargin, chartClients, chartPhase, chartManagers;

function groupSum(rows, keyFn, valFn){
  const map = {};
  rows.forEach(r=>{
    const k = keyFn(r);
    if(!k) return;
    map[k] = (map[k]||0) + valFn(r);
  });
  return map;
}
function topEntries(map, n){
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function renderCharts(rows){
  const month = getSelectedMonth();
  const billed = rows.reduce((a,r)=>a+getBilled(r,month),0);
  const contract = d3sum(rows,'contract');
  const remaining = Math.max(contract-billed,0);
  const profit = d3sum(rows,'profit');

  const billingTitle = document.querySelector('#chart-billing').closest('.panel').querySelector('h3');
  billingTitle.innerHTML = month
    ? `Billing Progress <span class="tag">${monthLabel(month)} billed vs. total contract</span>`
    : `Billing Progress <span class="tag">billed vs contract</span>`;

  chartBilling = upsertDoughnut(chartBilling,'chart-billing',
    [month?`Billed (${monthLabel(month)})`:'Billed','Remaining'], [billed, remaining], [palette.gold, '#E4E8EE']);

  const profitPos = Math.max(profit,0);
  const costBasis = Math.max(d3sum(rows,'billed')-profitPos,0);
  chartMargin = upsertDoughnut(chartMargin,'chart-margin',
    ['Profit','Cost'], [profitPos, costBasis], [palette.green, '#E4E8EE']);

  // ---- Top Clients: recomputed from currently filtered rows, respects Period too ----
  const clientMap = groupSum(rows, r=>r.client, r=>getBilled(r,month));
  const tc = topEntries(clientMap, 10);
  const clientsTitle = document.querySelector('#chart-clients').closest('.panel').querySelector('h3');
  clientsTitle.innerHTML = month
    ? `Top Clients <span class="tag">by billed $, ${monthLabel(month)}, filtered</span>`
    : `Top Clients <span class="tag">by billed $, filtered</span>`;
  chartClients = upsertHBar(chartClients,'chart-clients', tc.map(c=>c[0]), tc.map(c=>c[1]), palette.navy);

  // ---- Contract Value by Phase: recomputed from currently filtered rows ----
  const phaseRows = rows.filter(r=>r.phase!=='Internal/PTO' && r.phase!=='Other');
  const phaseMap = groupSum(phaseRows, r=>r.phase, r=>r.contract);
  const ph = topEntries(phaseMap, 10);
  const phaseTitle = document.querySelector('#chart-phase').closest('.panel').querySelector('h3');
  phaseTitle.innerHTML = `Contract Value by Phase <span class="tag">filtered</span>`;
  chartPhase = upsertHBar(chartPhase,'chart-phase', ph.map(p=>p[0]), ph.map(p=>p[1]), palette.teal);

  // ---- Top Project Managers: recomputed from currently filtered rows ----
  const mgrMap = groupSum(rows, r=>r.manager, r=>r.contract);
  const mgr = topEntries(mgrMap, 10);
  const mgrTitle = document.querySelector('#chart-managers').closest('.panel').querySelector('h3');
  mgrTitle.innerHTML = `Top Project Managers <span class="tag">by contract $, filtered</span>`;
  chartManagers = upsertHBar(chartManagers,'chart-managers', mgr.map(m=>m[0]), mgr.map(m=>m[1]), palette.gold);
}

function upsertDoughnut(chart, canvasId, labels, values, colors){
  const ctx = document.getElementById(canvasId);
  if(chart) chart.destroy();
  return new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data: values, backgroundColor: colors, borderWidth:2, borderColor:'#FFFFFF' }]},
    options:{
      cutout:'68%',
      plugins:{ legend:{ position:'bottom', labels:{ font:{family:'IBM Plex Mono',size:10.5}, boxWidth:10 } },
        tooltip:{ callbacks:{ label: c=> c.label+': '+fmtUSD(c.raw) } } }
    }
  });
}
function upsertHBar(chart, canvasId, labels, values, color){
  const ctx = document.getElementById(canvasId);
  if(chart) chart.destroy();
  return new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data: values, backgroundColor: color, borderRadius:2 }]},
    options:{
      indexAxis:'y',
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>fmtUSD(c.raw) } } },
      scales:{ x:{ ticks:{ callback:v=>fmtUSDk(v), font:{family:'IBM Plex Mono',size:10} }, grid:{color:'#E4E8EE'} },
                y:{ ticks:{ font:{size:10.5} }, grid:{display:false} } }
    }
  });
}

function refreshS1(){
  const rows = getFilteredProjects();
  renderKPIs(rows);
  renderTable(rows);
  renderCharts(rows);
}
['f-status','f-manager','f-type','f-month'].forEach(id=>document.getElementById(id).addEventListener('change', ()=>{s1_page=0; refreshS1();}));
document.getElementById('f-search').addEventListener('input', ()=>{s1_page=0; refreshS1();});
document.getElementById('f-reset').addEventListener('click', ()=>{
  document.getElementById('f-status').value='';
  document.getElementById('f-manager').value='';
  document.getElementById('f-type').value='';
  document.getElementById('f-month').value='';
  document.getElementById('f-search').value='';
  s1_page=0; refreshS1();
});
document.getElementById('s1-prev').addEventListener('click', ()=>{ if(s1_page>0){s1_page--; renderTable(getFilteredProjects());} });
document.getElementById('s1-next').addEventListener('click', ()=>{ s1_page++; renderTable(getFilteredProjects()); });
document.querySelectorAll('#s1-table th').forEach(th=>{
  th.addEventListener('click', ()=>{
    const key = th.dataset.key;
    if(s1_sort.key===key) s1_sort.dir*=-1; else { s1_sort.key=key; s1_sort.dir=-1; }
    renderTable(getFilteredProjects());
  });
});

/***********************************************************
 * SHEET 2 — WORKLOAD & PERFORMANCE
 ***********************************************************/
let selectedEmp = null;      // null = Whole Firm (roster aggregate)
let granularity = 'month';   // 'month' | 'quarter' | 'year'
let periodValue = '';        // '' = All
let chartEmpTrend, chartEmpEff, chartEmpProj;

function titleCase(s){ return s.toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()); }

// ---- Employee dropdown filter (grouped by team, mirrors Sheet 1) ----
(function populateS2EmployeeFilter(){
  const sel = document.getElementById('s2-f-employee');
  Object.entries(DATA.employee_roster).forEach(([team, names])=>{
    const grp = document.createElement('optgroup');
    grp.label = team;
    const teamOpt = document.createElement('option');
    teamOpt.value = 'TEAM:'+team; teamOpt.textContent = `All ${team} (aggregate)`;
    grp.appendChild(teamOpt);
    names.forEach(n=>{
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
})();
document.getElementById('s2-f-employee').addEventListener('change', e=>{
  selectedEmp = e.target.value || null;
  syncSidebarSelection();
  periodValue = ''; refreshS2();
});

// ---- Team-grouped sidebar list (matches the active roster provided) ----
function teamTotals(team){
  const roster = DATA.employee_roster[team] || [];
  const rows = DATA.emp_totals.filter(e=>roster.includes(e.employee));
  const bill = rows.reduce((a,r)=>a+r.bill_hours,0);
  const std = rows.reduce((a,r)=>a+(r.standard_hours||0),0);
  return { efficiency: std>0 ? bill/std : 0 };
}
function renderEmpList(filterText){
  filterText = (filterText||'').toLowerCase();
  const totalsByName = {}; DATA.emp_totals.forEach(e=>totalsByName[e.employee]=e);
  let count = 0;
  let html = `<div class="emp-row" data-emp="__ALL__"><span class="name">— Whole Firm —</span><span class="eff"></span></div>`;
  Object.entries(DATA.employee_roster).forEach(([team, names])=>{
    const visible = names.filter(n=>n.toLowerCase().includes(filterText));
    if(visible.length===0 && !team.toLowerCase().includes(filterText)) return;
    const namesToShow = visible.length>0 ? visible : names;
    const tt = teamTotals(team);
    html += `<div class="emp-row" data-emp="TEAM:${team.replace(/"/g,'&quot;')}" style="background:var(--paper); font-weight:600;"><span class="name">${team} — All (aggregate)</span><span class="eff">${fmtPct(tt.efficiency)}</span></div>`;
    namesToShow.forEach(n=>{
      count++;
      const t = totalsByName[n];
      const eff = t ? fmtPct(t.efficiency) : '—';
      html += `<div class="emp-row" data-emp="${n.replace(/"/g,'&quot;')}" style="padding-left:22px;"><span class="name">${n}</span><span class="eff">${eff}</span></div>`;
    });
  });
  document.getElementById('s2-emp-count').textContent = count+' people';
  document.getElementById('emp-list').innerHTML = html;
  document.querySelectorAll('.emp-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      selectedEmp = row.dataset.emp==='__ALL__' ? null : row.dataset.emp;
      document.getElementById('s2-f-employee').value = selectedEmp || '';
      syncSidebarSelection();
      periodValue = ''; refreshS2();
    });
  });
  syncSidebarSelection();
}
function syncSidebarSelection(){
  document.querySelectorAll('.emp-row').forEach(r=>{
    const isAll = r.dataset.emp==='__ALL__';
    r.classList.toggle('selected', selectedEmp ? r.dataset.emp===selectedEmp : isAll);
  });
}
document.getElementById('emp-search').addEventListener('input', e=> renderEmpList(e.target.value));
renderEmpList('');

// ---- Granularity segmented control ----
document.querySelectorAll('.gran-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.gran-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    granularity = btn.dataset.gran;
    periodValue = '';
    refreshS2();
  });
});
document.getElementById('s2-f-period').addEventListener('change', e=>{ periodValue = e.target.value; refreshS2(); });
document.getElementById('s2-f-reset').addEventListener('click', ()=>{
  selectedEmp = null; granularity='month'; periodValue='';
  document.getElementById('s2-f-employee').value='';
  document.querySelectorAll('.gran-btn').forEach(b=>b.classList.toggle('active', b.dataset.gran==='month'));
  document.getElementById('emp-search').value='';
  renderEmpList('');
  refreshS2();
});

// ---- Bucket helpers: derive quarter/year buckets from monthly data on the fly ----
function toQuarter(m){ const [y,mo] = m.split('-').map(Number); return `${y}-Q${Math.ceil(mo/3)}`; }
function toYear(m){ return m.split('-')[0]; }
function periodLabel(p, gran){
  if(gran==='month'){ const [y,mo]=p.split('-'); return new Date(y,mo-1,1).toLocaleString('en-US',{month:'short',year:'numeric'}); }
  return p;
}
function aggregateBuckets(monthlyRows, gran){
  const map = {};
  monthlyRows.forEach(r=>{
    const key = gran==='month' ? r.month : gran==='quarter' ? toQuarter(r.month) : toYear(r.month);
    if(!map[key]) map[key] = {bill_hours:0, nb_hours:0, total_hours:0, standard_hours:0};
    map[key].bill_hours += r.bill_hours;
    map[key].nb_hours += r.nb_hours;
    map[key].total_hours += r.total_hours;
    map[key].standard_hours += (r.standard_hours||0);
  });
  return Object.keys(map).sort().map(k=>({
    period:k, bill_hours:map[k].bill_hours, nb_hours:map[k].nb_hours, total_hours:map[k].total_hours,
    standard_hours:map[k].standard_hours,
    efficiency: map[k].standard_hours>0 ? map[k].bill_hours/map[k].standard_hours : 0
  }));
}
const TRAILING = {month:12, quarter:8, year:100};

function teamMonthly(team){
  const roster = DATA.employee_roster[team] || [];
  const rows = DATA.emp_monthly.filter(m=>roster.includes(m.employee));
  const map = {};
  rows.forEach(r=>{
    if(!map[r.month]) map[r.month] = {month:r.month, bill_hours:0, nb_hours:0, total_hours:0, standard_hours:0};
    map[r.month].bill_hours += r.bill_hours;
    map[r.month].nb_hours += r.nb_hours;
    map[r.month].total_hours += r.total_hours;
    map[r.month].standard_hours += (r.standard_hours||0);
  });
  return Object.values(map).sort((a,b)=>a.month.localeCompare(b.month));
}

function refreshS2(){
  let monthlyRows, topProj, title;
  if(selectedEmp && selectedEmp.startsWith('TEAM:')){
    const team = selectedEmp.slice(5);
    monthlyRows = teamMonthly(team);
    topProj = [];
    title = `${team} (aggregate)`;
  } else if(selectedEmp){
    monthlyRows = DATA.emp_monthly.filter(m=>m.employee===selectedEmp).sort((a,b)=>a.month.localeCompare(b.month));
    topProj = DATA.emp_top_projects[selectedEmp] || [];
    title = selectedEmp;
  } else {
    monthlyRows = DATA.company_monthly.slice().sort((a,b)=>a.month.localeCompare(b.month));
    topProj = [];
    title = 'Whole Firm';
  }

  const buckets = aggregateBuckets(monthlyRows, granularity);

  // Repopulate the Period dropdown to match current employee + granularity
  const periodSel = document.getElementById('s2-f-period');
  const prevValue = periodValue;
  periodSel.innerHTML = '<option value="">Period: All</option>';
  buckets.slice().reverse().forEach(b=>{
    const opt = document.createElement('option');
    opt.value = b.period; opt.textContent = periodLabel(b.period, granularity);
    periodSel.appendChild(opt);
  });
  if(buckets.find(b=>b.period===prevValue)){ periodSel.value = prevValue; } else { periodValue=''; periodSel.value=''; }

  // KPI totals: either the single selected bucket, or the sum across all buckets ("All")
  let totals;
  if(periodValue){
    totals = buckets.find(b=>b.period===periodValue) || {bill_hours:0,nb_hours:0,total_hours:0,standard_hours:0,efficiency:0};
  } else {
    const bill = buckets.reduce((a,b)=>a+b.bill_hours,0), nb = buckets.reduce((a,b)=>a+b.nb_hours,0);
    const std = buckets.reduce((a,b)=>a+b.standard_hours,0);
    totals = {bill_hours:bill, nb_hours:nb, total_hours:bill+nb, standard_hours:std, efficiency: std>0 ? bill/std : 0};
  }

  const kpis = [
    {k:'Billable Hours', v: Math.round(totals.bill_hours).toLocaleString(), cls:'accent-teal'},
    {k:'Non-Billable Hours', v: Math.round(totals.nb_hours).toLocaleString(), cls:'accent-rust'},
    {k:'Total Hours Worked', v: Math.round(totals.total_hours).toLocaleString(), cls:''},
    {k:'Standard Hours', v: Math.round(totals.standard_hours).toLocaleString(), cls:'', sub:'network days − PTO'},
    {k:'Efficiency', v: fmtPct(totals.efficiency), cls:'accent-gold', sub:'billable ÷ standard'},
  ];
  document.getElementById('s2-kpis').innerHTML = kpis.map(x=>
    `<div class="kpi ${x.cls}"><div class="k">${x.k}</div><div class="v">${x.v}</div>${x.sub?`<div class="sub">${x.sub}</div>`:''}</div>`).join('');

  // ---- Determine which buckets to actually plot ----
  // No period selected: trailing window at the chosen granularity (existing behavior).
  // Period selected: drill down one level — a month shows just itself, a quarter shows
  // the months inside it, a year shows the quarters inside it.
  let chartBuckets, chartGran;
  if(periodValue){
    if(granularity==='month'){
      chartBuckets = buckets.filter(b=>b.period===periodValue);
      chartGran = 'month';
    } else if(granularity==='quarter'){
      const monthBuckets = aggregateBuckets(monthlyRows, 'month');
      chartBuckets = monthBuckets.filter(b=>toQuarter(b.period)===periodValue);
      chartGran = 'month';
    } else { // year
      const quarterBuckets = aggregateBuckets(monthlyRows, 'quarter');
      chartBuckets = quarterBuckets.filter(b=>b.period.split('-')[0]===periodValue);
      chartGran = 'quarter';
    }
  } else {
    chartBuckets = buckets.slice(-TRAILING[granularity]);
    chartGran = granularity;
  }

  const granLabel = granularity==='month' ? 'Monthly' : granularity==='quarter' ? 'Quarterly' : 'Yearly';
  const periodTag = periodValue ? ` — ${periodLabel(periodValue,granularity)}` : ' — trailing';
  document.getElementById('s2-trend-title').textContent = `${granLabel} Bill vs Non-Bill Hours (${title})${periodTag}`;
  document.getElementById('s2-eff-title').innerHTML = `Efficiency Trend <span class="tag">${granLabel.toLowerCase()}, bill hrs / total hrs</span>`;
  const isIndividual = selectedEmp && !selectedEmp.startsWith('TEAM:');
  document.getElementById('s2-topproj-title').textContent = isIndividual ? `Top Projects by Hours — ${title}` : 'Select an individual employee to see top projects';

  const trailing = chartBuckets;

  const ctx1 = document.getElementById('chart-emp-trend');
  if(chartEmpTrend) chartEmpTrend.destroy();
  chartEmpTrend = new Chart(ctx1,{
    type:'bar',
    data:{ labels: trailing.map(b=>periodLabel(b.period,chartGran)),
      datasets:[
        {label:'Billable', data:trailing.map(b=>b.bill_hours), backgroundColor:palette.teal, stack:'s'},
        {label:'Non-Billable', data:trailing.map(b=>b.nb_hours), backgroundColor:palette.rust, stack:'s'}
      ]},
    options:{ plugins:{legend:{display:false}}, scales:{ x:{ ticks:{font:{family:'IBM Plex Mono',size:9.5}} }, y:{ stacked:true, grid:{color:'#E4E8EE'} } } }
  });

  const ctx2 = document.getElementById('chart-emp-efficiency');
  if(chartEmpEff) chartEmpEff.destroy();
  chartEmpEff = new Chart(ctx2,{
    type:'line',
    data:{ labels: trailing.map(b=>periodLabel(b.period,chartGran)),
      datasets:[{ label:'Efficiency', data:trailing.map(b=>b.efficiency*100), borderColor:palette.gold, backgroundColor:'rgba(168,120,58,0.15)', fill:true, tension:0.3, pointRadius:3 }]},
    options:{ plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>c.raw.toFixed(1)+'%'}}},
      scales:{ y:{ ticks:{callback:v=>v+'%'}, grid:{color:'#E4E8EE'} }, x:{ ticks:{font:{family:'IBM Plex Mono',size:9.5}} } } }
  });

  const ctx3 = document.getElementById('chart-emp-projects');
  if(chartEmpProj) chartEmpProj.destroy();
  chartEmpProj = new Chart(ctx3,{
    type:'bar',
    data:{ labels: topProj.map(p=>p.project), datasets:[{ data: topProj.map(p=>p.hours), backgroundColor: palette.navy, borderRadius:2 }]},
    options:{ indexAxis:'y', plugins:{legend:{display:false}},
      scales:{ x:{ grid:{color:'#E4E8EE'} }, y:{ ticks:{font:{size:10.5}}, grid:{display:false} } } }
  });
}
refreshS2();

/***********************************************************
 * SHEET 3 — FINANCIAL & AR
 ***********************************************************/
let arBucket = ''; // '' = All, else 'd0_30' | 'd31_60' | 'd61_90' | 'd91_plus'
let asOfDate = '';  // '' = live current snapshot; else 'YYYY-MM-DD'
const bucketMeta = {
  '':        {label:'All Buckets', color:null},
  'd0_30':   {label:'0–30 Days',   color:palette.teal},
  'd31_60':  {label:'31–60 Days',  color:palette.gold},
  'd61_90':  {label:'61–90 Days',  color:'#A8783A'},
  'd91_plus':{label:'91+ Days',    color:palette.rust},
};
let chartAging;

// ---- Set up the date picker's bounds from the invoice ledger ----
(function initAsOfDate(){
  const dates = DATA.invoice_ledger.map(r=>r.d).filter(Boolean).sort();
  const input = document.getElementById('s3-asof-date');
  input.min = dates[0];
  input.max = dates[dates.length-1];
})();

// ---- Reconstruct aging-by-client as of an arbitrary date from the invoice ledger ----
// Approximation: an invoice counts as still outstanding on date D if it has no
// recorded payment, or its last recorded payment date falls after D (in which case
// the full net-billed amount is treated as outstanding as of D); otherwise today's
// balance carries forward. This is estimated from invoice + payment history, not
// a true historical ledger, since only a single "last payment" is recorded per invoice.
function computeAgingAsOf(dateStr){
  const D = new Date(dateStr+'T00:00:00').getTime();
  const DAY = 86400000;
  const clientMap = {};
  DATA.invoice_ledger.forEach(r=>{
    const invTime = new Date(r.d+'T00:00:00').getTime();
    if(invTime > D) return; // not yet issued as of D
    let outstanding;
    if(r.p){
      const payTime = new Date(r.p+'T00:00:00').getTime();
      outstanding = (payTime <= D) ? (r.b||0) : (r.n||0);
    } else {
      outstanding = (r.b||0);
    }
    if(!outstanding || outstanding <= 0.005) return;
    const days = Math.floor((D - invTime)/DAY);
    const bucket = days<=30 ? 'd0_30' : days<=60 ? 'd31_60' : days<=90 ? 'd61_90' : 'd91_plus';
    if(!clientMap[r.c]) clientMap[r.c] = {client:r.c, d0_30:0, d31_60:0, d61_90:0, d91_plus:0, credit:0, balance:0};
    clientMap[r.c][bucket] += outstanding;
    clientMap[r.c].balance += outstanding;
  });
  const clients = Object.values(clientMap);
  const totals = {d0_30:0, d31_60:0, d61_90:0, d91_plus:0, credit:0, balance:0};
  clients.forEach(c=>{ totals.d0_30+=c.d0_30; totals.d31_60+=c.d31_60; totals.d61_90+=c.d61_90; totals.d91_plus+=c.d91_plus; totals.balance+=c.balance; });
  return {clients, totals};
}

function getArData(){
  if(!asOfDate) return {clients: DATA.ar_clients, totals: DATA.ar_totals, mode:'live'};
  const computed = computeAgingAsOf(asOfDate);
  return {clients: computed.clients, totals: computed.totals, mode:'asof'};
}

function renderS3KPIs(){
  const {totals:at, mode} = getArData();
  const creditRow = mode==='live'
    ? {k:'Retainer Credit on File', v: fmtUSD(at.credit), cls:'accent-teal', bucket:null}
    : {k:'Retainer Credit on File', v:'N/A', cls:'accent-teal', bucket:null};
  const kpis = [
    {k:'0–30 Days', v: fmtUSD(at.d0_30), cls:'', bucket:'d0_30'},
    {k:'31–60 Days', v: fmtUSD(at.d31_60), cls:'accent-gold', bucket:'d31_60'},
    {k:'61–90 Days', v: fmtUSD(at.d61_90), cls:'accent-rust', bucket:'d61_90'},
    {k:'91+ Days', v: fmtUSD(at.d91_plus), cls:'accent-rust', bucket:'d91_plus'},
    creditRow,
    {k:'Total Balance Due', v: fmtUSD(at.balance), cls:'', bucket:null},
  ];
  document.getElementById('s3-kpis').innerHTML = kpis.map(x=>{
    const active = x.bucket && x.bucket===arBucket;
    return `<div class="kpi ${x.cls}" style="${active?'outline:2px solid '+palette.navy+'; outline-offset:-2px;':''}"><div class="k">${x.k}</div><div class="v">${x.v}</div></div>`;
  }).join('');

  const note = document.getElementById('s3-mode-note');
  if(mode==='asof'){
    note.style.display = 'block';
    note.textContent = `Showing aging estimated as of ${asOfDate} — reconstructed from invoice and payment history, not the live snapshot. Retainer credit isn't reconstructable this way and shows N/A.`;
  } else {
    note.style.display = 'none';
  }
}

function renderRevenueChart(){
  const rev = DATA.monthly_revenue.slice(-30);
  new Chart(document.getElementById('chart-revenue'), {
    type:'bar',
    data:{ labels: rev.map(r=>r.month),
      datasets:[
        {type:'bar', label:'Gross Billed', data: rev.map(r=>r.gross_billed), backgroundColor:'#B9C2CF'},
        {type:'line', label:'Cash Collected', data: rev.map(r=>r.amount_paid), borderColor:palette.gold, backgroundColor:palette.gold, tension:0.25, pointRadius:2}
      ]},
    options:{ plugins:{legend:{position:'bottom',labels:{font:{family:'IBM Plex Mono',size:10}}}},
      scales:{ x:{ ticks:{font:{family:'IBM Plex Mono',size:8.5},maxRotation:90,minRotation:90} }, y:{ ticks:{callback:v=>fmtUSDk(v)}, grid:{color:'#E4E8EE'} } } }
  });
}

function renderAgingChart(){
  const {totals:at} = getArData();
  const labels = ['0–30','31–60','61–90','91+'];
  const values = [at.d0_30, at.d31_60, at.d61_90, at.d91_plus];
  const baseColors = [palette.teal, palette.gold, '#A8783A', palette.rust];
  const bucketKeys = ['d0_30','d31_60','d61_90','d91_plus'];
  const colors = bucketKeys.map((b,i)=> (!arBucket || arBucket===b) ? baseColors[i] : '#E4E8EE');
  const borderW = bucketKeys.map(b => (arBucket && arBucket===b) ? 3 : 2);
  if(chartAging) chartAging.destroy();
  chartAging = new Chart(document.getElementById('chart-aging'), {
    type:'doughnut',
    data:{ labels, datasets:[{ data: values, backgroundColor: colors, borderWidth: borderW, borderColor:'#FFFFFF' }] },
    options:{ cutout:'62%', plugins:{ legend:{position:'bottom',labels:{font:{family:'IBM Plex Mono',size:10.5}}}, tooltip:{callbacks:{label:c=>c.label+': '+fmtUSD(c.raw)}} } }
  });
  const title = document.querySelector('#chart-aging').closest('.panel').querySelector('h3');
  title.innerHTML = asOfDate ? `A/R Aging Buckets <span class="tag">as of ${asOfDate}, estimated</span>` : `A/R Aging Buckets <span class="tag">firm-wide</span>`;
}

function renderOverdueTable(){
  const {clients} = getArData();
  let rows = clients.slice();
  if(arBucket){
    rows = rows.filter(c=>(c[arBucket]||0) > 0).sort((a,b)=>(b[arBucket]||0)-(a[arBucket]||0)).slice(0,15);
  } else {
    rows = rows.slice().sort((a,b)=>b.balance-a.balance).slice(0,15);
  }
  document.getElementById('s3-overdue-title').innerHTML = arBucket
    ? `Top Overdue Clients <span class="tag">by ${bucketMeta[arBucket].label} outstanding</span>`
    : `Top Overdue Clients <span class="tag">by balance</span>`;
  document.querySelector('#s3-overdue-table tbody').innerHTML = rows.map(c=>`
    <tr><td>${c.client}</td>
    <td class="num" style="${arBucket==='d0_30'?'font-weight:600;':''}">${fmtUSD(c.d0_30)}</td>
    <td class="num" style="${arBucket==='d31_60'?'font-weight:600;':''}">${fmtUSD(c.d31_60)}</td>
    <td class="num" style="${arBucket==='d61_90'?'font-weight:600;':''}">${fmtUSD(c.d61_90)}</td>
    <td class="num" style="${arBucket==='d91_plus'?'font-weight:600;':''}">${fmtUSD(c.d91_plus)}</td>
    <td class="num">${fmtUSD(c.balance)}</td></tr>
  `).join('');
}

function renderAllClients(filterText){
  const {clients} = getArData();
  filterText = (filterText||'').toLowerCase();
  let rows = clients.filter(c=>c.client.toLowerCase().includes(filterText));
  if(arBucket){
    rows = rows.filter(c=>(c[arBucket]||0) > 0).sort((a,b)=>(b[arBucket]||0)-(a[arBucket]||0));
  } else {
    rows = rows.sort((a,b)=>b.balance-a.balance);
  }
  document.getElementById('s3-ar-count').textContent = rows.length+' clients'+(arBucket?` with balance in ${bucketMeta[arBucket].label}`:'');
  document.querySelector('#s3-all-table tbody').innerHTML = rows.map(c=>`
    <tr><td>${c.client}</td>
    <td class="num" style="${arBucket==='d0_30'?'font-weight:600;':''}">${fmtUSD(c.d0_30)}</td>
    <td class="num" style="${arBucket==='d31_60'?'font-weight:600;':''}">${fmtUSD(c.d31_60)}</td>
    <td class="num" style="${arBucket==='d61_90'?'font-weight:600;':''}">${fmtUSD(c.d61_90)}</td>
    <td class="num" style="${arBucket==='d91_plus'?'font-weight:600;':''}">${fmtUSD(c.d91_plus)}</td>
    <td class="num">${fmtUSD(c.credit)}</td><td class="num">${fmtUSD(c.balance)}</td></tr>
  `).join('');
}

function renderBucketSummary(){
  const {clients, totals} = getArData();
  const el = document.getElementById('s3-bucket-summary');
  if(!arBucket){ el.textContent = ''; return; }
  const n = clients.filter(c=>(c[arBucket]||0)>0).length;
  el.textContent = `${n} client${n===1?'':'s'} outstanding in ${bucketMeta[arBucket].label} — ${fmtUSD(totals[arBucket])} total`;
}

function refreshS3(){
  renderS3KPIs();
  renderAgingChart();
  renderOverdueTable();
  renderAllClients(document.getElementById('ar-search').value);
  renderBucketSummary();
}

document.querySelectorAll('#s3-bucket-filter .gran-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#s3-bucket-filter .gran-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    arBucket = btn.dataset.bucket;
    refreshS3();
  });
});
document.getElementById('ar-search').addEventListener('input', e=>renderAllClients(e.target.value));
document.getElementById('s3-asof-date').addEventListener('change', e=>{ asOfDate = e.target.value; refreshS3(); });
document.getElementById('s3-asof-reset').addEventListener('click', ()=>{
  asOfDate = '';
  document.getElementById('s3-asof-date').value = '';
  refreshS3();
});

renderRevenueChart();
refreshS3();

/***********************************************************
 * ASK-THIS-SHEET Q&A — powered by a live call to Claude
 * Real natural-language understanding: the question is sent to
 * Claude along with a relevant slice of this sheet's underlying
 * data, so it can reason about anything in that data rather than
 * matching a fixed set of phrases. This only works while this
 * dashboard is open inside Claude.ai, since that's what lets the
 * API call through without needing a key.
 ***********************************************************/
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function findEntity(text, names){
  const t = text.toLowerCase();
  let best = null;
  names.forEach(name=>{
    if(!name) return;
    const n = String(name).toLowerCase();
    if(n.length>=3 && t.includes(n)){
      if(!best || n.length>best.length) best = name;
    }
  });
  return best;
}
async function callClaude(prompt){
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if(!res.ok) throw new Error('API error '+res.status);
  const data = await res.json();
  const text = (data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
  if(!text) throw new Error('empty response');
  return text;
}
function buildPrompt(sheetLabel, ctx, question){
  return `You are a financial/operations analyst embedded inside an interactive practice-management dashboard for M. Designs Architects, an architecture firm. You are answering a question about the "${sheetLabel}" sheet. Use ONLY the JSON data provided below — it is a real slice of the firm's underlying Ajera/BQE export data that powers this dashboard. Do not invent figures that aren't derivable from this data. If the provided data doesn't contain enough detail to fully answer, say what you can determine and briefly note what's missing rather than guessing. Answer in 1-4 concise sentences. Format dollar amounts with $ and commas, percentages with %, and bold key figures using **double asterisks**.

DATA:
${JSON.stringify(ctx)}

QUESTION: ${question}`;
}

/* ---- Sheet 1: Project Analysis context ---- */
function s1Context(question){
  const clients = [...new Set(DATA.projects.map(p=>p.client))];
  const entity = findEntity(question, [...DATA.projects.map(p=>p.project), ...clients, ...DATA.managers]);
  const ctx = {
    firmwide_totals_all_projects: DATA.kpi_all,
    firmwide_totals_active_only: DATA.kpi_active,
    status_options: DATA.statuses,
    contract_types: DATA.contract_types,
    top_15_clients_by_billed: DATA.top_clients,
    contract_value_by_phase: DATA.phase_analysis,
    top_managers_by_contract_value: DATA.manager_perf,
    currently_active_dashboard_filters: {
      status: document.getElementById('f-status').value || 'All',
      employee_filter: document.getElementById('f-manager').value || 'All',
      contract_type: document.getElementById('f-type').value || 'All',
      period_month: document.getElementById('f-month').value || 'All (all-time)'
    }
  };
  if(entity){
    ctx.matched_entity_from_question = entity;
    ctx.matching_project_rows = DATA.projects.filter(p=>p.project===entity||p.client===entity||p.manager===entity);
  } else {
    ctx.note = 'No specific project/client/manager name was detected in the question — only firm-wide aggregates are included above. If the question needs a specific project or client\'s numbers, ask again mentioning its name.';
  }
  return ctx;
}

/* ---- Sheet 2: Workload & Performance context ---- */
function s2Context(question){
  const allEmployees = Object.values(DATA.employee_roster).flat();
  const teamNames = Object.keys(DATA.employee_roster);
  const emp = findEntity(question, allEmployees);
  const team = teamNames.find(t=>question.toLowerCase().includes(t.toLowerCase()));
  const ctx = {
    employee_roster_by_team: DATA.employee_roster,
    all_time_totals_per_employee: DATA.emp_totals,
    firmwide_monthly_hours: DATA.company_monthly,
    note_on_efficiency: 'efficiency = billable hours / standard hours, where standard hours = (business days in the period x 8) minus PTO/holiday/sick/vacation hours',
    currently_selected_employee_or_team: document.getElementById('s2-f-employee').value || 'Whole Firm',
    currently_selected_view_granularity: (document.querySelector('.gran-btn.active')||{}).dataset ? document.querySelector('.gran-btn.active').dataset.gran : 'month'
  };
  if(emp){
    ctx.matched_employee = emp;
    ctx.matched_employee_monthly_detail = DATA.emp_monthly.filter(m=>m.employee===emp);
    ctx.matched_employee_top_projects = DATA.emp_top_projects[emp] || [];
  }
  if(team){
    ctx.matched_team = team;
    ctx.matched_team_monthly_detail = teamMonthly(team);
  }
  return ctx;
}

/* ---- Sheet 3: Financial & A/R context ---- */
function s3Context(question){
  const {clients: arClients, totals: arTotals, mode} = getArData();
  const client = findEntity(question, arClients.map(c=>c.client));
  const ctx = {
    aging_totals_firmwide: arTotals,
    aging_by_client: arClients,
    monthly_billed_vs_collected: DATA.monthly_revenue,
    currently_active_view: {
      aging_bucket_filter: arBucket || 'All buckets',
      as_of_date: asOfDate || 'Live current snapshot',
      data_mode: mode
    }
  };
  if(client) ctx.matched_client = client;
  return ctx;
}

function setupQA(prefix, chips, contextFn, sheetLabel, examples){
  const input = document.getElementById(prefix+'-qa-input');
  const btn = document.getElementById(prefix+'-qa-ask');
  const answerEl = document.getElementById(prefix+'-qa-answer');
  const chipsEl = document.getElementById(prefix+'-qa-chips');
  chipsEl.innerHTML = chips.map(c=>`<button type="button" class="qa-chip">${c}</button>`).join('');
  chipsEl.querySelectorAll('.qa-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{ input.value = chip.textContent; ask(); });
  });
  async function ask(){
    const q = input.value.trim();
    if(!q) return;
    answerEl.innerHTML = `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(q)}</div><div class="qa-a"><i>Thinking…</i></div></div>`;
    try{
      const ctx = contextFn(q);
      const prompt = buildPrompt(sheetLabel, ctx, q);
      const answerRaw = await callClaude(prompt);
      const answerHtml = escapeHtml(answerRaw).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');
      answerEl.innerHTML = `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(q)}</div><div class="qa-a">${answerHtml}</div></div>`;
    } catch(e){
      answerEl.innerHTML = `<div class="qa-bubble"><div class="qa-q">Q: ${escapeHtml(q)}</div><div class="qa-a">Live Q&amp;A isn't reachable right now (${escapeHtml(e.message||'connection error')}). This asks Claude directly and only works while this dashboard is open inside Claude.ai — try examples: <br>${examples.map(x=>'&bull; '+x).join('<br>')}</div></div>`;
    }
  }
  btn.addEventListener('click', ask);
  input.addEventListener('keydown', e=>{ if(e.key==='Enter') ask(); });
}

setupQA('s1', [
  'Which client has the highest billed amount?',
  'Which project manager has the highest contract value?',
  'How many active projects are there?',
  'What is the total profit margin?'
], s1Context, 'Project Analysis', [
  'How much has been billed to [client name]?',
  'What is the contract amount for [project name]?',
  'How many completed projects are there?'
]);

setupQA('s2', [
  'Who has the highest efficiency?',
  'Who has logged the most billable hours?',
  'What is the US Team efficiency?',
  'How many billable hours has the Pak Team logged?'
], s2Context, 'Workload & Performance', [
  "What is [employee name]'s efficiency?",
  'How many billable hours has [employee name] logged?',
  'What is the US Team efficiency?'
]);

setupQA('s3', [
  'What is the total outstanding balance?',
  'Which client owes the most?',
  'How much is 91+ days overdue?',
  'How many clients have an overdue balance?'
], s3Context, 'Financial & A/R', [
  'What is the balance for [client name]?',
  'How much is in the 31-60 day bucket?',
  'Which client owes the most?'
]);

/* ---------- init ---------- */
refreshS1();
