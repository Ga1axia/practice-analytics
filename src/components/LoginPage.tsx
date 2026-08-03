import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

const demos = [
  { role: 'Admin', email: 'admin@mdesigns.test', password: 'DemoAdmin2026!', note: 'Full firm' },
  {
    role: 'Employee · Arnita',
    email: 'arnita@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Her hours + projects',
  },
  {
    role: 'Employee · Ni Ni',
    email: 'nini@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'Her hours + projects',
  },
  {
    role: 'Employee · Zhengrui',
    email: 'zhengrui@mdesigns.test',
    password: 'DemoEmployee2026!',
    note: 'His hours + projects',
  },
  {
    role: 'Customer',
    email: 'customer@mdesigns.test',
    password: 'DemoCustomer2026!',
    note: 'Elena Vargas portal',
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

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="firm display">M · DESIGNS ARCHITECTS</div>
          <div className="sub">Practice Analytics — Sign In</div>
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
          {(localError || error) && <p className="login-error">{localError || error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="login-demos">
          <p className="login-demos-label">Demo accounts</p>
          {demos.map((d) => (
            <button
              key={d.email}
              type="button"
              className="login-demo-btn"
              onClick={() => {
                setEmail(d.email);
                setPassword(d.password);
              }}
            >
              <strong>{d.role}</strong>
              <span>
                {d.email}
                {d.note ? ` · ${d.note}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
