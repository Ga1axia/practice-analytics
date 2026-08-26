import { useEffect, useState, type FormEvent } from 'react';
import { BrandMark } from './BrandMark';
import { useAuth } from '../hooks/useAuth';
import { useDemoMode } from '../hooks/useDemoMode';
import { oauthErrorFromSearch } from '../lib/oauthRedirect';

const demos = [
  {
    role: 'Admin',
    email: 'admin@mdesigns.test',
    password: 'DemoAdmin2026!',
    note: 'Dashboard + firm analytics & BQE',
    gate: 'Admin',
  },
  {
    role: 'Malika Junaid',
    email: 'malika.junaid@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Executive firm analytics (no BQE)',
    gate: 'Exec',
  },
  {
    role: 'Avery Cobe',
    email: 'avery.cobe@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Project lead financials on assigned jobs',
    gate: 'Lead',
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
    role: 'Thiru & Renuga Sinnathamby',
    email: 'sinnathamby@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Active residence · 26-012',
    gate: 'Client',
  },
  {
    role: 'Elena Vargas',
    email: 'customer@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Client project board',
    gate: 'Client',
  },
  {
    role: 'Jordan Blake',
    email: 'jordan.blake@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Fake demo remodel',
    gate: 'Client',
  },
  {
    role: 'Sam Rivera',
    email: 'sam.rivera@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Fake demo ADU',
    gate: 'Client',
  },
  {
    role: 'Casey Nguyen',
    email: 'casey.nguyen@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Fake demo new build',
    gate: 'Client',
  },
  {
    role: 'Morgan Patel',
    email: 'morgan.patel@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Fake demo interior',
    gate: 'Client',
  },
  {
    role: 'Alex Torres',
    email: 'alex.torres@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Fake demo commercial',
    gate: 'Client',
  },
];

function MicrosoftMark() {
  return (
    <svg className="login-ms-mark" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginPage() {
  const isDemo = useDemoMode();
  const { session, profile, signIn, signInWithMicrosoft, signOut, error } = useAuth();
  const [email, setEmail] = useState(isDemo ? 'admin@mdesigns.test' : '');
  const [password, setPassword] = useState(isDemo ? 'DemoAdmin2026!' : '');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const unlinked = Boolean(session && !profile);

  useEffect(() => {
    const oauthErr = oauthErrorFromSearch();
    if (!oauthErr) return;
    setLocalError(oauthErr);
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_code');
    url.searchParams.delete('error_description');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, []);

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

  async function onMicrosoft() {
    setBusy(true);
    setLocalError(null);
    try {
      await signInWithMicrosoft();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Microsoft sign-in failed');
      setBusy(false);
    }
  }

  const shownError = localError || error;

  return (
    <div className="login-page">
      <div className={`login-shell${isDemo ? ' is-demo' : ''}`}>
        <section className="login-main">
          <BrandMark
            tone="light"
            compact
            subtitle={isDemo ? 'Practice Analytics · Demo' : 'Practice Analytics'}
          />

          {unlinked ? (
            <div className="login-unlinked">
              <p className="login-kicker">Account pending</p>
              <h1 className="display">This Microsoft account is not provisioned yet.</h1>
              <p className="login-lede soft">
                You signed in as <span className="mono">{session?.user.email}</span>, but there is no
                portal profile for that email. Firm staff must use an{' '}
                <span className="mono">@mdesignsarchitects.com</span> Microsoft account. Ask an
                administrator if you still see this after signing in with your work email.
              </p>
              <button type="button" className="login-submit" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <>
              <header className="login-main-head">
                <p className="login-kicker">Sign in</p>
                <h1 className="display">Access your portal</h1>
                <p className="login-lede soft">
                  {isDemo
                    ? 'Microsoft for staff email, a demo role on the right, or credentials below.'
                    : 'Staff: continue with your Microsoft work email. Clients can use the email and password issued by M·Designs.'}
                </p>
              </header>

              <button
                type="button"
                className="login-microsoft"
                disabled={busy}
                onClick={() => void onMicrosoft()}
              >
                <MicrosoftMark />
                {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
              </button>

              <div className="login-or" role="separator">
                <span>or email and password</span>
              </div>

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
                {shownError ? <p className="login-error">{shownError}</p> : null}
                <button type="submit" className="login-submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in with email'}
                </button>
              </form>
            </>
          )}
        </section>

        {isDemo ? (
          <aside className="login-aside login-demos">
            <div className="login-demos-head">
              <p className="login-kicker">Demo access</p>
              <h2 className="display">Tour a role</h2>
              <p className="login-lede soft">Fills credentials and signs in immediately.</p>
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
          </aside>
        ) : (
          <aside className="login-aside login-hero">
            <div className="login-hero-copy">
              <p className="login-kicker">M·Designs user portal</p>
              <h2 className="display">Your work, projects, and client updates — in one place.</h2>
              <p className="login-lede">
                Sign in with Microsoft for staff analytics and your project workspace, or with a
                client password for the status tracker.
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
        )}
      </div>
    </div>
  );
}
