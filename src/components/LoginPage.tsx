import { useState, type FormEvent } from 'react';
import { BrandMark } from './BrandMark';
import { useAuth } from '../hooks/useAuth';

const demos = [
  {
    role: 'Admin',
    email: 'admin@mdesigns.test',
    password: 'DemoAdmin2026!',
    note: 'Firm analytics & project list',
    gate: 'Staff',
  },
  {
    role: 'Arnita Serri',
    email: 'arnita@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Hours, projects, calendar',
    gate: 'Employee',
  },
  {
    role: 'Ni Ni',
    email: 'nini@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Hours, projects, calendar',
    gate: 'Employee',
  },
  {
    role: 'Zhengrui He',
    email: 'zhengrui@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Hours, projects, calendar',
    gate: 'Employee',
  },
  {
    role: 'Elena Vargas',
    email: 'customer@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Client project board',
    gate: 'Client',
  },
];

export function LoginPage() {
  const { signIn, error } = useAuth();
  const [email, setEmail] = useState('admin@mdesigns.test');
  const [password, setPassword] = useState('DemoAdmin2026!');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function enterAs(demo: (typeof demos)[number]) {
    setEmail(demo.email);
    setPassword(demo.password);
    setBusy(true);
    setLocalError(null);
    try {
      await signIn(demo.email, demo.password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <aside className="login-hero">
          <BrandMark tone="dark" subtitle="Practice Analytics · Dev portal" />
          <div className="login-hero-copy">
            <p className="login-kicker">M·Designs user portal</p>
            <h1 className="display">Your work, projects, and client updates — in one place.</h1>
            <p className="login-lede">
              Sign in for staff analytics, your assigned project workspace, or the client portal.
              This is a development build of the M·Designs dashboard.
            </p>
          </div>
          <ul className="login-hero-points">
            <li>
              <span className="k">Staff</span>
              <span>Firm reports, A/R, project analysis</span>
            </li>
            <li>
              <span className="k">Employees</span>
              <span>Hours, assigned jobs, calendar</span>
            </li>
            <li>
              <span className="k">Clients</span>
              <span>Schedule, messages, milestones</span>
            </li>
          </ul>
          <p className="login-hero-foot mono">mdesignsarchitects.com · Mountain View, CA</p>
        </aside>

        <div className="login-main">
          <header className="login-main-head">
            <p className="login-kicker">Sign in</p>
            <h2 className="display">Access your portal</h2>
            <p className="login-lede soft">
              Use your M·Designs account, or pick a demo role below for a quick tour.
            </p>
          </header>

          <form onSubmit={onSubmit} className="login-form">
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {(localError || error) && <p className="login-error">{localError || error}</p>}
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Enter portal'}
            </button>
          </form>

          <div className="login-demos">
            <div className="login-demos-head">
              <p className="login-demos-label">Demo access</p>
              <span className="mono">Dev only · fills email &amp; signs in</span>
            </div>
            <div className="login-demo-grid">
              {demos.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="login-demo-card"
                  disabled={busy}
                  onClick={() => void enterAs(d)}
                >
                  <span className="login-demo-gate">{d.gate}</span>
                  <strong>{d.role}</strong>
                  <span className="login-demo-note">{d.note}</span>
                  <span className="login-demo-email mono">{d.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
