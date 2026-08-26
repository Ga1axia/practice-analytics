import { useState } from 'react';
import { AdminTestAsPanel, ImpersonationBanner } from './components/AdminTestAs';
import { BrandMark } from './components/BrandMark';
import { AskAiNavButton, FloatingChat } from './components/FloatingChat';
import { LoginPage } from './components/LoginPage';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { DataProvider, useDashboard } from './hooks/useDashboard';
import { useDemoMode } from './hooks/useDemoMode';
import type { ChatViewAction } from './lib/chatViewAction';
import { fmtUSDk } from './lib/format';
import { CustomerPortal } from './sheets/CustomerPortal';
import { EmployeePortal } from './sheets/EmployeePortal';
import { Executive } from './sheets/Executive';
import { FinancialAR } from './sheets/FinancialAR';
import { MainReport } from './sheets/MainReport';
import { ProjectAnalysis } from './sheets/ProjectAnalysis';
import { ProjectList } from './sheets/ProjectList';
import { ProjectDashboard } from './sheets/ProjectDashboard';
import { WorkloadPerformance } from './sheets/WorkloadPerformance';
import { Staffing } from './sheets/Staffing';
import { isEmployeePortalRole, isExecRole, roleLabel } from './lib/roles';
import type { SheetId } from './lib/types';
import './styles/global.css';

function StaffShell() {
  const isDemo = useDemoMode();
  const { profile, signOut } = useAuth();
  const { data, loading, error } = useDashboard();
  const [sheet, setSheet] = useState<SheetId>('exec');
  const [chatOpen, setChatOpen] = useState(false);
  const [viewAction, setViewAction] = useState<{ seq: number; action: ChatViewAction } | null>(
    null,
  );

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

  const fillViewport = sheet === 'main';

  return (
    <div className={`app-shell${fillViewport ? ' fill-viewport' : ''}`}>
      <ImpersonationBanner />
      <header className="titleblock">
        <div className="tb-brand">
          <BrandMark
            subtitle={
              isDemo
                ? `Practice Analytics · ${roleLabel(profile?.role)} · Demo`
                : `Practice Analytics · ${roleLabel(profile?.role)}`
            }
          />
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Data As Of</div>
            <div className="v">Project List</div>
          </div>
          <div className="tb-cell">
            <div className="k">Projects</div>
            <div className="v">{data.kpi_active.project_count}</div>
          </div>
          <div className="tb-cell">
            <div className="k">Total Contract Value</div>
            <div className="v">{fmtUSDk(data.kpi_all.contract_amount)}</div>
          </div>
          <div className="tb-cell">
            <div className="k">Signed in</div>
            <div className="v" style={{ fontSize: 12 }}>
              {profile?.email}
            </div>
          </div>
          <div className="tb-cell tb-cell-actions">
            <AdminTestAsPanel />
            <AskAiNavButton
              open={chatOpen}
              onClick={() => {
                const x = window.scrollX;
                const y = window.scrollY;
                setChatOpen((o) => !o);
                requestAnimationFrame(() => window.scrollTo(x, y));
              }}
            />
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
        <button
          type="button"
          className={sheet === 's3' ? 'active' : ''}
          onClick={() => setSheet('s3')}
        >
          <span className="num">SHEET A-3</span>Financial &amp; A/R
        </button>
        <button
          type="button"
          className={sheet === 's4' ? 'active' : ''}
          onClick={() => setSheet('s4')}
        >
          <span className="num">SHEET A-4</span>Project Dashboard
        </button>
        <button
          type="button"
          className={sheet === 's5' ? 'active' : ''}
          onClick={() => setSheet('s5')}
        >
          <span className="num">SHEET A-5</span>Project List
        </button>
        <button
          type="button"
          className={sheet === 's6' ? 'active' : ''}
          onClick={() => setSheet('s6')}
        >
          <span className="num">SHEET A-6</span>Staffing
        </button>
      </nav>

      <main className={fillViewport ? 'main-fill' : undefined}>
        {sheet === 'exec' ? <Executive data={data} /> : null}
        {sheet === 'main' ? (
          <MainReport data={data} viewAction={viewAction} />
        ) : null}
        {sheet === 's1' ? <ProjectAnalysis data={data} /> : null}
        {sheet === 's2' ? <WorkloadPerformance data={data} /> : null}
        {sheet === 's3' ? <FinancialAR data={data} /> : null}
        {sheet === 's4' ? <ProjectDashboard data={data} /> : null}
        {sheet === 's5' ? <ProjectList data={data} /> : null}
        {sheet === 's6' ? <Staffing /> : null}
      </main>

      {!fillViewport ? (
        <footer>
          {isDemo
            ? 'M. DESIGNS ARCHITECTS — PRACTICE ANALYTICS · BUILT FROM AJERA/BQE CORE EXPORTS · ALL FIGURES REFLECT SOURCE DATA AS EXTRACTED'
            : 'M. Designs Architects — Practice Analytics'}
        </footer>
      ) : null}

      <FloatingChat
        sheet={sheet}
        data={data}
        onViewAction={applyChatView}
        open={chatOpen}
        onOpenChange={setChatOpen}
      />
    </div>
  );
}

function EmployeeShell() {
  const isDemo = useDemoMode();
  const { profile, signOut } = useAuth();
  const { data, loading, error } = useDashboard();

  if (loading) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace' }}>Loading your work…</div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace', color: '#B3261E' }}>
        Failed to load data: {error || 'unknown error'}
      </div>
    );
  }

  const employeeName = profile?.employee_name;
  if (!employeeName) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace', color: '#B3261E' }}>
        {isDemo ? (
          <>
            This account is not linked to an employee name. Ask an admin to set{' '}
            <code>employee_name</code> on your profile.
          </>
        ) : (
          'This account is not linked to an employee profile. Contact your administrator.'
        )}
      </div>
    );
  }

  return (
    <div className="app-shell emp-shell">
      <ImpersonationBanner />
      <header className="titleblock">
        <div className="tb-brand">
          <BrandMark
            subtitle={
              isDemo
                ? `My work · ${roleLabel(profile?.role)} · ${employeeName} · Demo`
                : `My work · ${roleLabel(profile?.role)} · ${employeeName}`
            }
          />
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Signed in</div>
            <div className="v" style={{ fontSize: 12 }}>
              {profile?.email}
            </div>
          </div>
          <div className="tb-cell tb-cell-actions">
            <AdminTestAsPanel />
            <button
              type="button"
              className="signout-btn emp-cal-nav-btn"
              title="Jump to today on calendar (C)"
              aria-keyshortcuts="c"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('pa-emp-open-calendar', { detail: { jumpToToday: true } }),
                );
              }}
            >
              Today <kbd className="emp-nav-kbd">C</kbd>
            </button>
            <button type="button" className="signout-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main>
        <EmployeePortal data={data} employeeName={employeeName} />
      </main>
      <footer>
        {isDemo
          ? 'M. DESIGNS ARCHITECTS — EMPLOYEE WORKSPACE · YOUR HOURS & ASSIGNED PROJECTS ONLY'
          : 'M. Designs Architects — Employee workspace'}
      </footer>
    </div>
  );
}

function CustomerShell() {
  const isDemo = useDemoMode();
  const { profile, signOut } = useAuth();

  if (!profile) {
    return (
      <div style={{ padding: 48, fontFamily: 'IBM Plex Mono, monospace' }}>Loading…</div>
    );
  }

  return (
    <div className="cp-shell">
      <ImpersonationBanner />
      <header className="titleblock cp-titleblock">
        <div className="tb-brand">
          <BrandMark subtitle={isDemo ? 'Client portal · Demo' : 'Client portal'} />
        </div>
        <div className="tb-meta">
          <div className="tb-cell">
            <div className="k">Signed in</div>
            <div className="v" style={{ fontSize: 12 }}>
              {profile.client_name || profile.email}
            </div>
          </div>
          <div className="tb-cell tb-cell-actions">
            <AdminTestAsPanel />
            <button type="button" className="signout-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <CustomerPortal profile={profile} />
      <footer className="cp-footer">
        {isDemo
          ? 'Questions outside the portal? Email your project manager — they see every note you leave here.'
          : 'Questions? Contact your project manager.'}
      </footer>
    </div>
  );
}

function Gate() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <p className="login-session-check mono">Checking session…</p>
      </div>
    );
  }

  if (!session || !profile) {
    return <LoginPage />;
  }

  if (profile.role === 'customer') {
    return <CustomerShell />;
  }

  if (isEmployeePortalRole(profile.role)) {
    return (
      <DataProvider>
        <EmployeeShell />
      </DataProvider>
    );
  }

  if (isExecRole(profile.role)) {
    return (
      <DataProvider>
        <StaffShell />
      </DataProvider>
    );
  }

  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
