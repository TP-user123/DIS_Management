import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import api from '../api.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const token = params.get('token') || '';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (password !== confirm) {
      return setError('Passwords do not match.');
    }

    setBusy(true);
    try {
      const { data } = await api.post('/auth/reset-password', { token, password });
      setNotice(data.message);
      setTimeout(() => navigate('/auth/login'), 1200);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to reset password.');
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
            <i /> SECURE ACCOUNT ACCESS
          </div>
          <h1>
            Protect your<br />
            <em>workspace.</em>
          </h1>
          <p>
            Choose a strong password to keep your ticket queues and team operations protected.
          </p>
        </div>

        <div className="auth-hero-foot">
          <ShieldCheck size={15} /> Use at least 10 characters with mixed letters and numbers.
        </div>
      </section>

      <section className="tcs-auth-form-wrap">
        <ThemeToggle className="theme-toggle-auth" />
        <div className="tcs-auth-form">
          <div className="auth-lock">
            <KeyRound size={21} />
          </div>

          <div className="form-overline">RESET PASSWORD</div>
          <h2>Choose a new password</h2>

          <form className="form-stack" onSubmit={submit}>
            <label>
              New Password
              <input
                type="password"
                minLength="10"
                required
                autoComplete="new-password"
                placeholder="Enter at least 10 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            <label>
              Confirm New Password
              <input
                type="password"
                minLength="10"
                required
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            {error && <div className="error-box">{error}</div>}
            {notice && <div className="success-box">{notice}</div>}

            <button className="btn btn-primary btn-full" disabled={busy || !token}>
              {busy ? 'Saving…' : 'Reset password'}
            </button>

            {!token && (
              <div className="error-box">
                Reset token is missing from URL. Request a new password reset link.
              </div>
            )}
          </form>

          <Link className="auth-back-link" to="/auth/login">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </div>
      </section>
    </div>
  );
}
