import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Activity, Layers3, LockKeyhole, Eye, EyeOff } from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { acceptSession } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const { data } = await api.post('/auth/login', { ...form, email: form.email.trim() });
      acceptSession(data);
      navigate(data.user.tempPasswordChangeRequired ? '/profile' : '/');
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to connect. Check backend server and credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tcs-auth">
      {/* Hero Branding Section */}
      <section className="tcs-auth-hero">
        <div className="tcs-brand">
          <div className="tcs-brand-mark">O</div>
          <div>
            <strong>OpsDesk Pro</strong>
            <span>ENTERPRISE IT OPERATIONS WORKSPACE</span>
          </div>
        </div>

        <div className="hero-copy">
          <div className="live-eyebrow">
            <i /> DIS SERVICE OPERATIONS
          </div>
          <h1>
            A clearer view<br />
            of every <em>issue.</em>
          </h1>
          <p>
            Keep asset issues, ticket assignments, engineer handovers, and daily operations together in one secure workspace.
          </p>

          <div className="hero-feature">
            <span><Layers3 size={17} /></span>
            <div>
              <b>Asset and ticket tracking</b>
              <small>Follow assignments, issue history, and resolution progress</small>
            </div>
          </div>

          <div className="hero-feature">
            <span><Activity size={17} /></span>
            <div>
              <b>Clear team handovers</b>
              <small>Keep work moving between shifts and engineers</small>
            </div>
          </div>

          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />

          <div className="hero-glass-card">
            <div className="glass-top">
              <span>OPS PULSE</span>
              <i>ACTIVE</i>
            </div>
            <div className="glass-bars">
              <b /><b /><b /><b /><b /><b /><b /><b /><b /><b />
            </div>
            <div className="glass-bottom">
              <span>Workflow</span>
              <strong>Track · Coordinate · Resolve</strong>
            </div>
          </div>
        </div>

        <div className="auth-hero-foot">
          <ShieldCheck size={15} /> Internal Enterprise Workspace · Role-Based Security
        </div>
      </section>

      {/* Sign-in Form Section */}
      <section className="tcs-auth-form-wrap">
        <div className="tcs-auth-form">
          <div className="mobile-tcs-brand">
            <div className="tcs-brand-mark">O</div>
            <b>OpsDesk Pro</b>
          </div>

          <div className="auth-lock">
            <LockKeyhole size={21} />
          </div>

          <div className="form-overline">SECURE WORKSPACE</div>
          <h2>Welcome back</h2>
          <p className="auth-description">
            Sign in with your work account to continue to your team’s workspace.
          </p>

          <form className="form-stack" onSubmit={submit}>
            <label>
              Work Email
              <input
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                placeholder="engineer@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>

            <label>
              Password
              <span className="auth-password-field">
                <input
                  className="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
                <button
                  className="auth-password-toggle"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>

            <div className="forgot-link-row">
              <Link to="/auth/forgot-password">Forgot password?</Link>
            </div>

            {error && <div className="error-box" role="alert">{error}</div>}

            <button className="btn btn-primary btn-full login-submit" disabled={busy}>
              {busy ? (
                <>
                  <span className="button-spinner" /> Signing in…
                </>
              ) : (
                <>
                  Sign in to Workspace <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="auth-security">
            <ShieldCheck size={15} /> Your access follows your team role and permissions.
          </div>

          <div className="auth-copyright">
            © 2026 OpsDesk Pro · IT Operations Management System
          </div>
        </div>
      </section>
    </div>
  );
}
