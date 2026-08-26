import { useEffect, useState } from 'react';
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

function GoogleMark() {
  return (
    <svg className="login-ms-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.9 26.8 37 24 37c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.5 7.1l.1.1 6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}

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
  const { session, profile, signIn, signInWithGoogle, signInWithMicrosoft, signOut, error } =
    useAuth();
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

  async function enterAs(demo: (typeof demos)[number]) {
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

  async function onGoogle() {
    setBusy(true);
    setLocalError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Google sign-in failed');
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
              <h1 className="display">This account is not provisioned yet.</h1>
              <p className="login-lede soft">
                You signed in as <span className="mono">{session?.user.email}</span>, but there is no
                portal profile for that email. Firm staff should use an{' '}
                <span className="mono">@mdesignsarchitects.com</span> work account. Ask an
                administrator if you still see this after signing in.
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
                    ? 'Google or Microsoft for OAuth, or pick a demo role on the right.'
                    : 'Continue with Google, or Microsoft 365 for your M·Designs work email.'}
                </p>
              </header>

              <button
                type="button"
                className="login-microsoft login-google"
                disabled={busy}
                onClick={() => void onGoogle()}
              >
                <GoogleMark />
                {busy ? 'Redirecting…' : 'Sign in with Google'}
              </button>

              <button
                type="button"
                className="login-microsoft login-oauth-secondary"
                disabled={busy}
                onClick={() => void onMicrosoft()}
              >
                <MicrosoftMark />
                {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
              </button>

              {shownError ? <p className="login-error">{shownError}</p> : null}
            </>
          )}
        </section>

        {isDemo ? (
          <aside className="login-aside login-demos">
            <div className="login-demos-head">
              <p className="login-kicker">Demo access</p>
              <h2 className="display">Tour a role</h2>
              <p className="login-lede soft">Signs in as that demo account immediately.</p>
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
                Staff and clients sign in with Google or Microsoft. Firm analytics and project
                workspaces open from the same portal.
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
