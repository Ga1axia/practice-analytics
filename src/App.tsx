import { useState } from 'react';
import { DataProvider, useDashboard } from './hooks/useDashboard';
import { fmtUSDk } from './lib/format';
import { FinancialAR } from './sheets/FinancialAR';
import { ProjectAnalysis } from './sheets/ProjectAnalysis';
import { WorkloadPerformance } from './sheets/WorkloadPerformance';
import type { SheetId } from './lib/types';
import './styles/global.css';

function Shell() {
  const { data, loading, error } = useDashboard();
  const [sheet, setSheet] = useState<SheetId>('s1');

  if (loading) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace' }}>Loading practice data…</div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace', color: '#B3261E' }}>
        Failed to load data: {error || 'unknown error'}
        <br />
        <br />
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{' '}
        <code>.env.local</code>, then re-seed if tables are empty.
      </div>
    );
  }

  return (
    <>
      <header className="titleblock">
        <div className="tb-brand">
          <div className="firm display">M · DESIGNS ARCHITECTS</div>
          <div className="sub">Practice Analytics — Drawing Set</div>
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Data As Of</div>
            <div className="v">Jul 2026</div>
          </div>
          <div className="tb-cell">
            <div className="k">Active Projects</div>
            <div className="v">{data.kpi_active.project_count}</div>
          </div>
          <div className="tb-cell">
            <div className="k">Total Contract Value</div>
            <div className="v">{fmtUSDk(data.kpi_all.contract_amount)}</div>
          </div>
          <div className="tb-cell">
            <div className="k">Employees Tracked</div>
            <div className="v">{data.emp_totals.length}</div>
          </div>
        </div>
      </header>

      <nav className="sheets">
        <button
          type="button"
          className={sheet === 's1' ? 'active' : ''}
          onClick={() => setSheet('s1')}
        >
          <span className="num">SHEET A-1</span>Project Analysis
        </button>
        <button
          type="button"
          className={sheet === 's2' ? 'active' : ''}
          onClick={() => setSheet('s2')}
        >
          <span className="num">SHEET A-2</span>Workload &amp; Performance
        </button>
        <button
          type="button"
          className={sheet === 's3' ? 'active' : ''}
          onClick={() => setSheet('s3')}
        >
          <span className="num">SHEET A-3</span>Financial &amp; A/R
        </button>
      </nav>

      <main>
        {sheet === 's1' ? <ProjectAnalysis data={data} /> : null}
        {sheet === 's2' ? <WorkloadPerformance data={data} /> : null}
        {sheet === 's3' ? <FinancialAR data={data} /> : null}
      </main>

      <footer>
        M. DESIGNS ARCHITECTS — PRACTICE ANALYTICS &nbsp;·&nbsp; BUILT FROM AJERA/BQE CORE EXPORTS
        &nbsp;·&nbsp; ALL FIGURES REFLECT SOURCE DATA AS EXTRACTED
      </footer>
    </>
  );
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
