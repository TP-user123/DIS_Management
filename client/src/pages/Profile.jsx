import { useState } from 'react';
import { LockKeyhole, Save, UserRound, ShieldCheck } from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Swal from '../utils/swal.js';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState({
    name: user?.name || '',
    team: user?.team || 'IT Support',
    shift: user?.shift || 'General'
  });

  const [pw, setPw] = useState({
    currentPassword: '',
    newPassword: '',
    confirm: ''
  });

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const { data } = await api.patch('/auth/profile', profile);
      updateUser(data.user);
      Swal.success('Profile Updated', 'Your profile details have been saved successfully.');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not update profile.');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    if (pw.newPassword !== pw.confirm) {
      setError('New password and confirmation do not match.');
      setBusy(false);
      return;
    }

    try {
      const { data } = await api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword
      });
      updateUser(data.user);
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      Swal.success('Password Changed', data.message || 'Your password has been updated.');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  const roleName =
    user?.role === 'RE'
      ? 'Resolution Engineer'
      : user?.role === 'SL'
      ? 'Shift Lead'
      : user?.role === 'TL'
      ? 'Team Leader'
      : 'Operations Manager';

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <div className="page-kicker">ACCOUNT & SECURITY SETTINGS</div>
          <h1>
            My profile<span className="title-period">.</span>
          </h1>
          <p>Manage your account identity, security preferences, and contact details.</p>
        </div>
      </div>

      {user?.tempPasswordChangeRequired && (
        <div className="warning-box">
          <LockKeyhole size={17} />
          <div>
            <strong>Password change required</strong>
            <p>A temporary password was assigned. Please set a personal password to secure your workspace.</p>
          </div>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}

      <div className="profile-grid">
        {/* Profile Card */}
        <section className="panel profile-card">
          <div className="profile-card-head">
            <div className="profile-large-avatar">{user?.name?.slice(0, 1).toUpperCase()}</div>
            <div>
              <h2>{user?.name}</h2>
              <span className="role-chip">{roleName}</span>
            </div>
          </div>

          <form className="form-stack" onSubmit={saveProfile}>
            <label>
              Full Name
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                required
              />
            </label>

            <label>
              Work Email
              <input value={user?.email || ''} disabled />
            </label>

            <div className="form-grid">
              <label>
                Team
                <input
                  value={profile.team}
                  disabled={user?.role !== 'MANAGER'}
                  onChange={(e) => setProfile({ ...profile, team: e.target.value })}
                />
              </label>

              <label>
                Shift
                <input
                  value={profile.shift}
                  disabled={user?.role !== 'MANAGER'}
                  onChange={(e) => setProfile({ ...profile, shift: e.target.value })}
                />
              </label>
            </div>

            <div className="profile-meta">
              <ShieldCheck size={16} />
              <span>Team assignments and roles are governed by your workspace administrator.</span>
            </div>

            <button className="btn btn-primary" disabled={busy}>
              <Save size={16} /> Save profile
            </button>
          </form>
        </section>

        {/* Password Card */}
        <section className="panel profile-card">
          <div className="panel-heading">
            <div>
              <h2>Change Password</h2>
              <p>Must contain at least 10 characters.</p>
            </div>
            <span className="metric-icon blue">
              <LockKeyhole size={18} />
            </span>
          </div>

          <form className="form-stack" onSubmit={changePassword}>
            {!user?.tempPasswordChangeRequired && (
              <label>
                Current Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pw.currentPassword}
                  onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                  required
                />
              </label>
            )}

            <label>
              New Password
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                required
                placeholder="At least 10 characters"
              />
            </label>

            <label>
              Confirm New Password
              <input
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                required
              />
            </label>

            <div className="password-guidance">
              <ShieldCheck size={16} />
              <span>Use a strong password and never share it. Managers can issue a temporary reset if locked out.</span>
            </div>

            <button className="btn btn-primary" disabled={busy}>
              <LockKeyhole size={16} /> Update password
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
