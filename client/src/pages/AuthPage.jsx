import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Activity, Layers3, LockKeyhole } from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { acceptSession } = useAuth();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const { data } = await api.post('/auth/login', form);
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
            <i /> IT SERVICE ORCHESTRATION PLATFORM
          </div>
          <h1>
            Every ticket.<br />
            <em>Every task.</em><br />
            Under control.
          </h1>
          <p>
            An integrated workspace for ticket assignment, operational execution, shift handovers, and private engineer escalation.
          </p>

          <div className="hero-feature">
            <span><Layers3 size={17} /></span>
            <div>
              <b>Ticket Operations & Queue Health</b>
              <small>Sectioned queues, smart distribution, and audit logging</small>
            </div>
          </div>

          <div className="hero-feature">
            <span><Activity size={17} /></span>
            <div>
              <b>Operational Continuity</b>
              <small>Lead reassignment, multi-party broadcast handovers, and team events</small>
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

          <div className="form-overline">SECURE ENTERPRISE PORTAL</div>
          <h2>Sign in to OpsDesk Pro</h2>
          <p className="auth-description">
            Access your operations queue with your organizational account credentials.
          </p>

          <form className="form-stack" onSubmit={submit}>
            <label>
              Work Email
              <input
                type="email"
                autoComplete="username"
                placeholder="engineer@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your secure password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </label>

            <div className="forgot-link-row">
              <Link to="/auth/forgot-password">Forgot password?</Link>
            </div>

            {error && <div className="error-box">{error}</div>}

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
            <ShieldCheck size={15} /> Authenticated session with fine-grained access policies.
          </div>

          <div className="auth-copyright">
            © 2026 OpsDesk Pro · IT Operations Management System
          </div>
        </div>
      </section>
    </div>
  );
}
