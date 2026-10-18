import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import api from '../api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to request a reset link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tcs-auth">
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
            <i /> ACCOUNT RECOVERY
          </div>
          <h1>
            Get back<br />
            <em>to work.</em>
          </h1>
          <p>
            Request secure password reset instructions for your enterprise operations account.
          </p>
        </div>

        <div className="auth-hero-foot">
          <ShieldCheck size={15} /> Reset links expire after 30 minutes.
        </div>
      </section>

      <section className="tcs-auth-form-wrap">
        <div className="tcs-auth-form">
          <div className="auth-lock">
            <Mail size={21} />
          </div>

          <div className="form-overline">ACCOUNT RECOVERY</div>
          <h2>Forgot your password?</h2>
          <p className="auth-description">
            Enter your work email address. If an account is found, reset instructions will be prepared.
          </p>

          <form className="form-stack" onSubmit={submit}>
            <label>
              Work Email
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="engineer@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {error && <div className="error-box">{error}</div>}

            {result && (
              <div className="success-box">
                {result.message}
                {result.developmentResetUrl && (
                  <div style={{ marginTop: 10 }}>
                    <a href={result.developmentResetUrl} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                      Open local reset link
                    </a>
                    <p className="form-help">Development mode only. Configure SMTP for email delivery.</p>
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-primary btn-full" disabled={busy}>
              {busy ? 'Preparing…' : 'Send Reset Instructions'}
            </button>
          </form>

          <Link className="auth-back-link" to="/auth/login">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
