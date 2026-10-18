import { useEffect, useState } from 'react';
import { Plus, Search, Users, UserRound, ShieldCheck, Mail, KeyRound } from 'lucide-react';
import api from '../api.js';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Swal from '../utils/swal.js';

const initial = {
  name: '',
  email: '',
  role: 'RE',
  team: 'IT Support',
  shift: 'General',
  password: ''
};

const permissionLabels = {
  'tickets:view': 'View tickets',
  'tickets:import': 'Import Excel tickets',
  'tickets:assign': 'Bulk assign / distribute tickets',
  'tasks:view': 'View tasks',
  'tasks:create': 'Create tasks',
  'tasks:assign': 'Assign tasks',
  'tasks:handover': 'Request / process handovers',
  'events:view': 'View events',
  'events:manage': 'Create and manage events',
  'team:view': 'View team directory',
  'team:manage': 'Manage team accounts',
  'notifications:view': 'View notifications'
};

export default function Team() {
  const { user } = useAuth();
  const canManageTeam = user?.role === 'MANAGER' || (user?.permissions || []).includes('team:manage');

  const [rolePermissions, setRolePermissions] = useState({ TL: [], SL: [], RE: [] });
  const [availablePermissions, setAvailablePermissions] = useState(Object.keys(permissionLabels));
  const [permissionNotice, setPermissionNotice] = useState('');
  const [permissionError, setPermissionError] = useState('');

  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/team')
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Unable to load team.'));
  };

  useEffect(() => {
    load();
    if (user?.role === 'MANAGER') {
      api.get('/team/role-permissions')
        .then((r) => {
          setRolePermissions(r.data.permissions);
          setAvailablePermissions(r.data.available);
        })
        .catch((e) => setPermissionError(e.response?.data?.message || 'Unable to load role permissions.'));
    }
  }, [user?.role]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await api.post('/team', form);
      Swal.success('Member Added', `${form.name} (${form.role}) has been added to the workspace.`);
      setShow(false);
      setForm(initial);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to create user.');
    } finally {
      setBusy(false);
    }
  };

  const saveRolePermissions = async () => {
    setPermissionError('');
    setPermissionNotice('');
    try {
      const { data } = await api.put('/team/role-permissions', { permissions: rolePermissions });
      setRolePermissions(data.permissions);
      Swal.success('Permissions Saved', 'Role permissions updated. Changes apply across all accounts in each role.');
    } catch (e) {
      setPermissionError(e.response?.data?.message || 'Unable to save role permissions.');
    }
  };

  // Toggle Status with Confirmation (Requirement 9)
  const toggleStatus = async (u) => {
    const nextStatus = u.status === 'active' ? 'inactive' : 'active';
    const actionWord = nextStatus === 'active' ? 'activate' : 'deactivate';

    const confirmRes = await Swal.confirm(
      `${actionWord.toUpperCase()} Member`,
      `Are you sure you want to ${actionWord} ${u.name}'s account?`,
      `Yes, ${actionWord}`
    );

    if (!confirmRes.isConfirmed) return;

    try {
      await api.patch(`/team/${u._id}/status`, { status: nextStatus });
      Swal.success('Status Updated', `${u.name} is now ${nextStatus}.`);
      load();
    } catch (e) {
      Swal.error('Update Failed', e.response?.data?.message || 'Unable to update user status.');
    }
  };

  // Reset Password using SweetAlert Prompt (Requirement 9)
  const resetPassword = async (u) => {
    const promptRes = await Swal.prompt(
      `Set Temporary Password for ${u.name}`,
      'Must contain at least 10 characters with mixed letters and numbers:',
      'Enter new temporary password...',
      true
    );

    if (!promptRes.isConfirmed) return;
    const temporaryPassword = promptRes.value;

    if (!temporaryPassword || temporaryPassword.length < 10) {
      Swal.error('Password Too Short', 'Temporary password must contain at least 10 characters.');
      return;
    }

    try {
      await api.post(`/team/${u._id}/reset-password`, { temporaryPassword });
      Swal.success(
        'Password Reset',
        `Temporary password for ${u.name} has been set. Share it securely with the employee.`
      );
      load();
    } catch (e) {
      Swal.error('Reset Failed', e.response?.data?.message || 'Unable to reset password.');
    }
  };

  const visible = items.filter((u) =>
    `${u.name} ${u.email} ${u.role} ${u.team}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <div className="page-kicker">DIRECTORY & ACCESS POLICIES</div>
          <h1>
            Team & access<span className="title-period">.</span>
          </h1>
          <p>
            Configure user profiles, shift rotations, and granular feature permissions across resolution engineers and leads.
          </p>
        </div>

        {canManageTeam && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setError('');
              setShow(true);
            }}
          >
            <Plus size={17} /> Add member
          </button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {/* Summary Metrics */}
      <div className="team-summary-grid">
        <div className="team-summary-card">
          <div className="metric-icon blue">
            <Users size={19} />
          </div>
          <div>
            <strong>{items.length}</strong>
            <span>Total members</span>
          </div>
        </div>

        <div className="team-summary-card">
          <div className="metric-icon green">
            <ShieldCheck size={19} />
          </div>
          <div>
            <strong>{items.filter((u) => u.status === 'active').length}</strong>
            <span>Active accounts</span>
          </div>
        </div>

        <div className="team-summary-card">
          <div className="metric-icon purple">
            <UserRound size={19} />
          </div>
          <div>
            <strong>{items.filter((u) => u.role === 'RE').length}</strong>
            <span>Resolution engineers</span>
          </div>
        </div>
      </div>

      {/* Role Permissions (Manager Only) */}
      {user?.role === 'MANAGER' && (
        <section className="panel role-permissions-panel">
          <div className="panel-heading">
            <div>
              <h2>Role Access Controls</h2>
              <p className="muted-cell">
                Configure feature access policies for TLs, SLs, and REs. Managers retain complete access.
              </p>
            </div>
          </div>

          <div className="role-permissions-grid">
            {['TL', 'SL', 'RE'].map((role) => (
              <div className="role-permission-card" key={role}>
                <h3>
                  {role === 'TL' ? 'Team Leader' : role === 'SL' ? 'Shift Lead' : 'Resolution Engineer'}{' '}
                  <span>{role}</span>
                </h3>
                <div className="permission-checks">
                  {availablePermissions
                    .filter((p) => p !== 'tickets:route') // Route removed
                    .map((permission) => (
                      <label key={permission} className="permission-check">
                        <input
                          type="checkbox"
                          checked={(rolePermissions[role] || []).includes(permission)}
                          onChange={(e) =>
                            setRolePermissions((old) => ({
                              ...old,
                              [role]: e.target.checked
                                ? [...(old[role] || []), permission]
                                : (old[role] || []).filter((p) => p !== permission)
                            }))
                          }
                        />
                        <span>{permissionLabels[permission] || permission}</span>
                      </label>
                    ))}
                </div>
              </div>
            ))}
          </div>

          {permissionError && <div className="error-box">{permissionError}</div>}
          {permissionNotice && <div className="success-box">{permissionNotice}</div>}

          <div className="panel-actions">
            <button className="btn btn-primary" onClick={saveRolePermissions}>
              Save role permissions
            </button>
          </div>
        </section>
      )}

      {/* Team Member Table */}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              placeholder="Search team members by name, email, or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="count-pill">{visible.length} members</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>MEMBER</th>
                <th>ROLE</th>
                <th>TEAM / SHIFT</th>
                <th>STATUS</th>
                <th>JOINED</th>
                {canManageTeam && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u._id}>
                  <td>
                    <div className="member-cell">
                      <div className={`avatar member-avatar avatar-${u.role.toLowerCase()}`}>
                        {u.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span>
                        <strong>{u.name}</strong>
                        <small>
                          <Mail size={12} />
                          {u.email}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge value={u.role} />
                  </td>
                  <td>
                    <span className="team-shift">
                      {u.team || 'Operations'} <small>{u.shift || 'General'}</small>
                    </span>
                  </td>
                  <td>
                    <span className={`status-text ${u.status}`}>
                      {u.status === 'active' ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td className="muted-cell">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </td>
                  {canManageTeam && (
                    <td>
                      <div className="team-actions">
                        <button
                          className="icon-btn"
                          title="Reset temporary password"
                          disabled={String(u._id) === String(user.id)}
                          onClick={() => resetPassword(u)}
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          className="btn btn-secondary btn-xs"
                          disabled={String(u._id) === String(user.id)}
                          onClick={() => toggleStatus(u)}
                        >
                          {u.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!visible.length && (
          <div className="empty-state compact">
            <strong>No team members found</strong>
            <p>Try refining your search terms.</p>
          </div>
        )}

        <div className="table-footer">
          <span>Enterprise organizational accounts with role policies.</span>
          <span className="table-footer-right">Strict access boundaries active</span>
        </div>
      </section>

      {/* Add Member Modal */}
      {show && (
        <Modal title="Add a team member" onClose={() => setShow(false)}>
          <form className="form-stack modal-form" onSubmit={create}>
            <label>
              Full Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Employee name"
              />
            </label>

            <label>
              Work Email
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="engineer@company.com"
              />
            </label>

            <div className="form-grid">
              <label>
                Role
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="RE">Resolution Engineer (RE)</option>
                  <option value="SL">Shift Lead (SL)</option>
                  <option value="TL">Team Leader (TL)</option>
                  {user?.role === 'MANAGER' && <option value="MANAGER">Manager</option>}
                </select>
              </label>

              <label>
                Team
                <input
                  value={form.team}
                  onChange={(e) => setForm({ ...form, team: e.target.value })}
                  required
                />
              </label>
            </div>

            <label>
              Shift
              <input
                value={form.shift}
                onChange={(e) => setForm({ ...form, shift: e.target.value })}
                required
                placeholder="e.g. Day Shift, Night Shift, General"
              />
            </label>

            <label>
              Temporary Password
              <input
                type="password"
                minLength="10"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 10 characters"
              />
            </label>

            <p className="form-help">
              Share the temporary password securely. The employee will be required to change it on initial login.
            </p>

            {error && <div className="error-box">{error}</div>}

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShow(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create Member'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
