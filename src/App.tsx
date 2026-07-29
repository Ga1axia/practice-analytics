import { useState } from 'react';
import { LoginPage } from './components/LoginPage';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DataProvider, useDashboard } from './hooks/useDashboard';
import { fmtUSDk } from './lib/format';
import { CustomerPortal } from './sheets/CustomerPortal';
import { FinancialAR } from './sheets/FinancialAR';
import { ProjectAnalysis } from './sheets/ProjectAnalysis';
import { WorkloadPerformance } from './sheets/WorkloadPerformance';
import type { SheetId } from './lib/types';
import './styles/global.css';

function StaffShell() {
  const { profile, signOut } = useAuth();
  const { data, loading, error } = useDashboard();
  const isEmployee = profile?.role === 'employee';
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
      </div>
    );
  }

  const lockedEmployee = isEmployee ? profile?.employee_name || null : null;
  const activeProjects = data.projects.filter((p) => p.status === 'ACTIVE').length;

  return (
    <>
      <header className="titleblock">
        <div className="tb-brand">
          <div className="firm display">M · DESIGNS ARCHITECTS</div>
          <div className="sub">
            Practice Analytics — {isEmployee ? `Employee · ${lockedEmployee}` : 'Admin'}
          </div>
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Data As Of</div>
            <div className="v">Jul 2026</div>
          </div>
          <div className="tb-cell">
            <div className="k">{isEmployee ? 'My Active Projects' : 'Active Projects'}</div>
            <div className="v">{isEmployee ? activeProjects : data.kpi_active.project_count}</div>
          </div>
          <div className="tb-cell">
            <div className="k">{isEmployee ? 'My Contract Value' : 'Total Contract Value'}</div>
            <div className="v">
              {fmtUSDk(
                isEmployee
                  ? data.projects.reduce((a, p) => a + (p.contract || 0), 0)
                  : data.kpi_all.contract_amount,
              )}
            </div>
          </div>
          <div className="tb-cell">
            <div className="k">Signed in</div>
            <div className="v" style={{ fontSize: 12 }}>
              {profile?.email}
            </div>
          </div>
          <div className="tb-cell">
            <button type="button" className="signout-btn" onClick={() => void signOut()}>
              Sign out
            </button>
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
        {!isEmployee ? (
          <button
            type="button"
            className={sheet === 's3' ? 'active' : ''}
            onClick={() => setSheet('s3')}
          >
            <span className="num">SHEET A-3</span>Financial &amp; A/R
          </button>
        ) : null}
      </nav>

      <main>
        {sheet === 's1' ? (
          <ProjectAnalysis data={data} lockedEmployee={lockedEmployee} />
        ) : null}
        {sheet === 's2' ? (
          <WorkloadPerformance data={data} lockedEmployee={lockedEmployee} />
        ) : null}
        {sheet === 's3' && !isEmployee ? <FinancialAR data={data} /> : null}
      </main>

      <footer>
        M. DESIGNS ARCHITECTS — PRACTICE ANALYTICS &nbsp;·&nbsp; BUILT FROM AJERA/BQE CORE EXPORTS
        &nbsp;·&nbsp; ALL FIGURES REFLECT SOURCE DATA AS EXTRACTED
      </footer>
    </>
  );
}

function CustomerShell() {
  const { profile, signOut } = useAuth();
  const { data, loading, error } = useDashboard();

  if (loading) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace' }}>Loading your projects…</div>
    );
  }
  if (error || !data || !profile) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace', color: '#B3261E' }}>
        Failed to load projects: {error || 'unknown error'}
      </div>
    );
  }

  return (
    <>
      <header className="titleblock">
        <div className="tb-brand">
          <div className="firm display">M · DESIGNS ARCHITECTS</div>
          <div className="sub">Client Status Tracker</div>
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Account</div>
            <div className="v" style={{ fontSize: 12 }}>
              {profile.client_name || profile.email}
            </div>
          </div>
          <div className="tb-cell">
            <button type="button" className="signout-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <CustomerPortal data={data} profile={profile} />
      <footer>
        M. DESIGNS ARCHITECTS — CLIENT PORTAL &nbsp;·&nbsp; PROJECT STATUS ONLY
      </footer>
    </>
  );
}

function Gate() {
  const { session, profile, loading, error } = useAuth();

  if (loading) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace' }}>Checking session…</div>
    );
  }

  if (!session || !profile) {
    return <LoginPage />;
  }

  if (error && !profile) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace', color: '#B3261E' }}>
        {error}
      </div>
    );
  }

  if (profile.role === 'customer') {
    return (
      <DataProvider>
        <CustomerShell />
      </DataProvider>
    );
  }

  return (
    <DataProvider>
      <StaffShell />
    </DataProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
