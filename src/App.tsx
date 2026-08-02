import { useState } from 'react';
import { FloatingChat } from './components/FloatingChat';
import { LoginPage } from './components/LoginPage';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DataProvider, useDashboard } from './hooks/useDashboard';
import type { ChatViewAction } from './lib/chatViewAction';
import { fmtUSDk } from './lib/format';
import { CustomerPortal } from './sheets/CustomerPortal';
import { Executive } from './sheets/Executive';
import { FinancialAR } from './sheets/FinancialAR';
import { MainReport } from './sheets/MainReport';
import { ProjectAnalysis } from './sheets/ProjectAnalysis';
import { ProjectList } from './sheets/ProjectList';
import { ProjectSchedule } from './sheets/ProjectSchedule';
import { WorkloadPerformance } from './sheets/WorkloadPerformance';
import type { SheetId } from './lib/types';
import './styles/global.css';

function StaffShell() {
  const { profile, signOut } = useAuth();
  const { data, loading, error } = useDashboard();
  const isEmployee = profile?.role === 'employee';
  const [sheet, setSheet] = useState<SheetId>('exec');
  const [viewAction, setViewAction] = useState<{ seq: number; action: ChatViewAction } | null>(
    null,
  );
  const scheduleSheetLabel = isEmployee ? 'SHEET A-3' : 'SHEET A-4';
  const projectListSheetLabel = isEmployee ? 'SHEET A-4' : 'SHEET A-5';

  function applyChatView(action: ChatViewAction) {
    setSheet('main');
    setViewAction((prev) => ({ seq: (prev?.seq || 0) + 1, action }));
  }

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
  const projectHeaders = data.projects.filter((p) => p.row_kind === 'project');
  const activeProjects = (projectHeaders.length ? projectHeaders : data.projects).filter(
    (p) => !p.status || p.status === 'ACTIVE',
  ).length;

  const fillViewport = sheet === 'main';

  return (
    <div className={`app-shell${fillViewport ? ' fill-viewport' : ''}`}>
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
            <div className="v">Project List</div>
          </div>
          <div className="tb-cell">
            <div className="k">{isEmployee ? 'My Active Projects' : 'Projects'}</div>
            <div className="v">{isEmployee ? activeProjects : data.kpi_active.project_count}</div>
          </div>
          <div className="tb-cell">
            <div className="k">{isEmployee ? 'My Contract Value' : 'Total Contract Value'}</div>
            <div className="v">
              {fmtUSDk(
                isEmployee
                  ? data.projects
                      .filter((p) => p.row_kind !== 'project')
                      .reduce((a, p) => a + (p.contract || 0), 0)
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
          className={sheet === 'exec' ? 'active' : ''}
          onClick={() => setSheet('exec')}
        >
          <span className="num">EXEC</span>Executive
        </button>
        <button
          type="button"
          className={sheet === 'main' ? 'active' : ''}
          onClick={() => setSheet('main')}
        >
          <span className="num">MAIN</span>Main Report
        </button>
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
        <button
          type="button"
          className={sheet === 's4' ? 'active' : ''}
          onClick={() => setSheet('s4')}
        >
          <span className="num">{scheduleSheetLabel}</span>Project Schedule
        </button>
        <button
          type="button"
          className={sheet === 's5' ? 'active' : ''}
          onClick={() => setSheet('s5')}
        >
          <span className="num">{projectListSheetLabel}</span>Project List
        </button>
      </nav>

      <main className={fillViewport ? 'main-fill' : undefined}>
        {sheet === 'exec' ? <Executive data={data} /> : null}
        {sheet === 'main' ? (
          <MainReport
            data={data}
            lockedEmployee={lockedEmployee}
            viewAction={viewAction}
          />
        ) : null}
        {sheet === 's1' ? (
          <ProjectAnalysis data={data} lockedEmployee={lockedEmployee} />
        ) : null}
        {sheet === 's2' ? (
          <WorkloadPerformance data={data} lockedEmployee={lockedEmployee} />
        ) : null}
        {sheet === 's3' && !isEmployee ? <FinancialAR data={data} /> : null}
        {sheet === 's4' ? <ProjectSchedule mode="staff" /> : null}
        {sheet === 's5' ? <ProjectList data={data} /> : null}
      </main>

      {!fillViewport ? (
        <footer>
          M. DESIGNS ARCHITECTS — PRACTICE ANALYTICS &nbsp;·&nbsp; BUILT FROM AJERA/BQE CORE EXPORTS
          &nbsp;·&nbsp; ALL FIGURES REFLECT SOURCE DATA AS EXTRACTED
        </footer>
      ) : null}

      <FloatingChat sheet={sheet} data={data} onViewAction={applyChatView} />
    </div>
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
