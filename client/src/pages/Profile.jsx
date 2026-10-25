
import { useState } from 'react';
import {
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRound,
  Mail,
  Users,
  Clock3,
  Eye,
  EyeOff,
  CheckCircle2,
  KeyRound,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';

import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Swal from '../utils/swal.js';
import './profile.css';

export default function Profile() {
  const { user, updateUser } = useAuth();

  const [profile, setProfile] = useState({
    name: user?.name || '',
    team: user?.team || 'IT Support',
    shift: user?.shift || 'General',
  });

  const [pw, setPw] = useState({
    currentPassword: '',
    newPassword: '',
    confirm: '',
  });

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const roleNames = {
    RE: 'Resolution Engineer',
    SL: 'Shift Lead',
    TL: 'Team Leader',
    MANAGER: 'Operations Manager',
  };

  const roleName = roleNames[user?.role] || 'Workspace Member';
  const initial = user?.name?.trim()?.charAt(0)?.toUpperCase() || 'U';

  const setProfileField = (field, value) => {
    setProfile((previous) => ({ ...previous, [field]: value }));
  };

  const setPasswordField = (field, value) => {
    setPw((previous) => ({ ...previous, [field]: value }));
  };

  const togglePassword = (field) => {
    setShowPasswords((previous) => ({
      ...previous,
      [field]: !previous[field],
    }));
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setError('');

    if (!profile.name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    setBusy(true);

    try {
      const { data } = await api.patch('/auth/profile', {
        ...profile,
        name: profile.name.trim(),
      });

      updateUser(data.user);

      Swal.success(
        'Profile Updated',
        'Your profile details have been saved successfully.'
      );
    } catch (err) {
      setError(
        err.response?.data?.message || 'Could not update profile.'
      );
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');

    if (pw.newPassword.length < 10) {
      setError('Your new password must contain at least 10 characters.');
      return;
    }

    if (pw.newPassword !== pw.confirm) {
      setError('New password and confirmation do not match.');
      return;
    }

    if (
      !user?.tempPasswordChangeRequired &&
      !pw.currentPassword
    ) {
      setError('Please enter your current password.');
      return;
    }

    setBusy(true);

    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });

      if (data.user) {
        updateUser(data.user);
      }

      setPw({
        currentPassword: '',
        newPassword: '',
        confirm: '',
      });

      Swal.success(
        'Password Changed',
        data.message || 'Your password has been updated.'
      );
    } catch (err) {
      setError(
        err.response?.data?.message || 'Could not change password.'
      );
    } finally {
      setBusy(false);
    }
  };

  const passwordChecks = [
    {
      label: 'At least 10 characters',
      valid: pw.newPassword.length >= 10,
    },
    {
      label: 'Passwords match',
      valid:
        pw.confirm.length > 0 &&
        pw.newPassword === pw.confirm,
    },
  ];

  const passwordStrength = (() => {
    const password = pw.newPassword;

    if (!password) return { label: 'Not entered', level: 0 };

    let score = 0;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) return { label: 'Weak', level: 1 };
    if (score === 2) return { label: 'Fair', level: 2 };
    if (score === 3) return { label: 'Good', level: 3 };

    return { label: 'Strong', level: 4 };
  })();

  return (
    <main className="profile-page">
      {/* Page header */}
      <header className="profile-hero">
        <div className="profile-hero-glow" />

        <div className="profile-hero-copy">
          <div className="profile-eyebrow">
            <ShieldCheck size={14} />
            ACCOUNT & SECURITY
          </div>

          <h1>
            My profile<span>.</span>
          </h1>

          <p>
            Manage your identity, workspace details, and account
            security from one place.
          </p>

          <div className="profile-hero-tags">
            <span>
              <UserRound size={13} />
              {roleName}
            </span>
            <span>
              <ShieldCheck size={13} />
              Personal settings
            </span>
          </div>
        </div>

        <div className="profile-hero-symbol">
          <div className="profile-symbol-ring">
            <UserRound size={38} strokeWidth={1.4} />
          </div>
          <span>YOUR ACCOUNT</span>
        </div>
      </header>

      {/* Temporary password notice */}
      {user?.tempPasswordChangeRequired && (
        <div className="profile-warning" role="alert">
          <div className="profile-warning-icon">
            <AlertTriangle size={20} />
          </div>

          <div>
            <strong>Password change required</strong>
            <p>
              You are using a temporary password. Set a personal
              password to secure your workspace.
            </p>
          </div>

          <LockKeyhole size={18} className="profile-warning-end" />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="profile-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Account overview */}
      <section className="profile-overview">
        <div className="profile-overview-heading">
          <div>
            <span className="profile-section-kicker">OVERVIEW</span>
            <h2>Your account</h2>
          </div>
          <span className="profile-account-label">
            ACCOUNT PROFILE
          </span>
        </div>

        <div className="profile-identity-card">
          <div className="profile-avatar">
            {initial}
            <span className="profile-avatar-status" />
          </div>

          <div className="profile-identity-main">
            <h3>{user?.name || 'Workspace User'}</h3>
            <p>{user?.email || 'No email available'}</p>

            <div className="profile-identity-tags">
              <span className="profile-role-tag">
                <ShieldCheck size={13} />
                {roleName}
              </span>
              <span className="profile-member-tag">
                <Users size={13} />
                {profile.team || 'IT Support'}
              </span>
            </div>
          </div>

          <div className="profile-identity-side">
            <span>WORK SHIFT</span>
            <strong>
              <Clock3 size={15} />
              {profile.shift || 'General'}
            </strong>
          </div>
        </div>
      </section>

      {/* Settings cards */}
      <section className="profile-settings-grid">
        {/* Profile details */}
        <article className="profile-panel">
          <div className="profile-panel-heading">
            <div className="profile-panel-icon blue">
              <UserRound size={20} />
            </div>

            <div>
              <h2>Personal information</h2>
              <p>Update your account details and team information.</p>
            </div>
          </div>

          <form className="profile-form" onSubmit={saveProfile}>
            <label className="profile-field">
              <span>Full name</span>

              <div className="profile-input-wrap">
                <UserRound size={17} />
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) =>
                    setProfileField('name', e.target.value)
                  }
                  autoComplete="name"
                  maxLength={100}
                  placeholder="Enter your full name"
                  required
                />
              </div>
            </label>

            <label className="profile-field">
              <span>Work email</span>

              <div className="profile-input-wrap is-disabled">
                <Mail size={17} />
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  readOnly
                />
                <ShieldCheck size={15} className="profile-field-lock" />
              </div>

              <small>Email is managed by your account administrator.</small>
            </label>

            <div className="profile-form-grid">
              <label className="profile-field">
                <span>Team</span>

                <div className="profile-input-wrap">
                  <Users size={17} />
                  <input
                    value={profile.team}
                    disabled={user?.role !== 'MANAGER'}
                    onChange={(e) =>
                      setProfileField('team', e.target.value)
                    }
                    maxLength={80}
                    placeholder="IT Support"
                  />
                </div>
              </label>

              <label className="profile-field">
                <span>Work shift</span>

                <div className="profile-input-wrap">
                  <Clock3 size={17} />
                  <input
                    value={profile.shift}
                    disabled={user?.role !== 'MANAGER'}
                    onChange={(e) =>
                      setProfileField('shift', e.target.value)
                    }
                    maxLength={50}
                    placeholder="General"
                  />
                </div>
              </label>
            </div>

            <div className="profile-info-note">
              <ShieldCheck size={17} />
              <p>
                Your role and team assignments are governed by
                workspace permissions.
              </p>
            </div>

            <div className="profile-form-footer">
              <span>Changes apply after saving.</span>

              <button
                className="profile-primary-btn"
                type="submit"
                disabled={busy}
              >
                <Save size={16} />
                {busy ? 'Saving…' : 'Save changes'}
                {!busy && <ArrowRight size={15} />}
              </button>
            </div>
          </form>
        </article>

        {/* Password settings */}
        <article className="profile-panel profile-security-panel">
          <div className="profile-panel-heading">
            <div className="profile-panel-icon purple">
              <LockKeyhole size={20} />
            </div>

            <div>
              <h2>Account security</h2>
              <p>Keep your account protected with a strong password.</p>
            </div>
          </div>

          <div className="profile-security-banner">
            <div className="profile-security-banner-icon">
              <ShieldCheck size={22} />
            </div>

            <div>
              <strong>Protect your workspace</strong>
              <p>
                Never share your password with anyone, including
                colleagues.
              </p>
            </div>
          </div>

          <form className="profile-form" onSubmit={changePassword}>
            {!user?.tempPasswordChangeRequired && (
              <label className="profile-field">
                <span>Current password</span>

                <div className="profile-input-wrap">
                  <LockKeyhole size={17} />
                  <input
                    type={showPasswords.current ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={pw.currentPassword}
                    onChange={(e) =>
                      setPasswordField('currentPassword', e.target.value)
                    }
                    placeholder="Enter current password"
                    required
                  />

                  <button
                    type="button"
                    className="profile-eye-btn"
                    onClick={() => togglePassword('current')}
                    aria-label={
                      showPasswords.current
                        ? 'Hide current password'
                        : 'Show current password'
                    }
                  >
                    {showPasswords.current
                      ? <EyeOff size={17} />
                      : <Eye size={17} />}
                  </button>
                </div>
              </label>
            )}

            <label className="profile-field">
              <span>New password</span>

              <div className="profile-input-wrap">
                <KeyRound size={17} />
                <input
                  type={showPasswords.new ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  value={pw.newPassword}
                  onChange={(e) =>
                    setPasswordField('newPassword', e.target.value)
                  }
                  placeholder="At least 10 characters"
                  required
                />

                <button
                  type="button"
                  className="profile-eye-btn"
                  onClick={() => togglePassword('new')}
                  aria-label={
                    showPasswords.new
                      ? 'Hide new password'
                      : 'Show new password'
                  }
                >
                  {showPasswords.new
                    ? <EyeOff size={17} />
                    : <Eye size={17} />}
                </button>
              </div>
            </label>

            <label className="profile-field">
              <span>Confirm new password</span>

              <div className="profile-input-wrap">
                <LockKeyhole size={17} />
                <input
                  type={showPasswords.confirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  value={pw.confirm}
                  onChange={(e) =>
                    setPasswordField('confirm', e.target.value)
                  }
                  placeholder="Re-enter your new password"
                  required
                />

                <button
                  type="button"
                  className="profile-eye-btn"
                  onClick={() => togglePassword('confirm')}
                  aria-label={
                    showPasswords.confirm
                      ? 'Hide confirmation password'
                      : 'Show confirmation password'
                  }
                >
                  {showPasswords.confirm
                    ? <EyeOff size={17} />
                    : <Eye size={17} />}
                </button>
              </div>
            </label>

            {pw.newPassword && (
              <div className="profile-password-strength">
                <div className="profile-strength-top">
                  <span>Password strength</span>
                  <strong className={`strength-label level-${passwordStrength.level}`}>
                    {passwordStrength.label}
                  </strong>
                </div>

                <div
                  className="profile-strength-bars"
                  aria-label={`Password strength: ${passwordStrength.label}`}
                >
                  {[1, 2, 3, 4].map((level) => (
                    <span
                      key={level}
                      className={
                        level <= passwordStrength.level
                          ? `active level-${passwordStrength.level}`
                          : ''
                      }
                    />
                  ))}
                </div>

                <div className="profile-password-checks">
                  {passwordChecks.map((check) => (
                    <span
                      key={check.label}
                      className={check.valid ? 'is-valid' : ''}
                    >
                      <CheckCircle2 size={14} />
                      {check.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="profile-info-note security-note">
              <ShieldCheck size={17} />
              <p>
                Use a unique password. Your administrator can help
                with an authorized reset if you are locked out.
              </p>
            </div>

            <div className="profile-form-footer">
              <span>Minimum 10 characters</span>

              <button
                className="profile-primary-btn"
                type="submit"
                disabled={busy}
              >
                <LockKeyhole size={16} />
                {busy ? 'Updating…' : 'Update password'}
                {!busy && <ArrowRight size={15} />}
              </button>
            </div>
          </form>
        </article>
      </section>

      {/* Footer security note */}
      <footer className="profile-footer-note">
        <ShieldCheck size={17} />
        <span>
          OpsDesk security · Your account details are subject to
          workspace access policies.
        </span>
      </footer>
    </main>
  );
}
