import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Users,
  Workflow,
  Ticket,
  UserRound,
  AlertCircle,
  LockKeyhole,
  FileBarChart2,
  Laptop
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useEffect, useState } from 'react';
import api from '../api.js';
import Swal from '../utils/swal.js';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Ticket queue', icon: Ticket, permission: 'tickets:view' },
  { to: '/tasks', label: 'Operational tasks', icon: ClipboardList, permission: 'tasks:view' },
  { to: '/events', label: 'Events & schedules', icon: CalendarDays, permission: 'events:view' },
  { to: '/assets', label: 'Asset desk', icon: Laptop },
  { to: '/reports', label: 'Work tracker', icon: FileBarChart2 },
  { to: '/handovers', label: 'Handovers', icon: Workflow, permission: 'tasks:view', permission2: 'tasks:handover' },
  { to: '/issues', label: 'Engineer Issues', icon: AlertCircle },
  { to: '/profile', label: 'My profile', icon: UserRound },
  { to: '/team', label: 'Team & access', icon: Users, permission: 'team:view', lead: true }
];

export default function Layout() {
  const { user, company, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (user?.tempPasswordChangeRequired && loc.pathname !== '/profile') {
      nav('/profile', { replace: true });
    }
  }, [user?.tempPasswordChangeRequired, loc.pathname, nav]);

  useEffect(() => {
    api.get('/notifications')
      .then((r) => setUnread(r.data.filter((n) => !n.readAt).length))
      .catch(() => {});
  }, [loc.pathname]);

  const handleLogout = async () => {
    const res = await Swal.confirm('Sign out', 'Are you sure you want to sign out of OpsDesk Pro?', 'Yes, Sign out');
    if (res.isConfirmed) {
      logout();
      nav('/auth/login');
    }
  };

  const roleTitle =
    user?.role === 'TL'
      ? 'Team Leader'
      : user?.role === 'SL'
      ? 'Shift Lead'
      : user?.role === 'RE'
      ? 'Resolution Engineer'
      : 'Operations Manager';

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark tcs-side-mark">O</div>
          <div>
            <strong>OpsDesk Pro</strong>
            <span>ENTERPRISE IT OPERATIONS</span>
          </div>
        </div>

        <div className="workspace-switch">
          <div className="workspace-icon">IT</div>
          <div className="workspace-name">
            <strong>{company?.name || 'Enterprise'}</strong>
            <span>Support Operations</span>
          </div>
          <Activity size={15} />
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav className="side-nav">
          {links
            .filter(
              (l) =>
                (!l.lead || ['MANAGER', 'TL', 'SL'].includes(user?.role)) &&
                (!l.permission || user?.role === 'MANAGER' || (user?.permissions || []).includes(l.permission)) &&
                (!l.permission2 || user?.role === 'MANAGER' || (user?.permissions || []).includes(l.permission2))
            )
            .map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span>{label}</span>
                {to === '/notifications' && unread > 0 && <i className="nav-unread" />}
              </NavLink>
            ))}

          {(user?.role === 'MANAGER' || (user?.permissions || []).includes('notifications:view')) && (
            <NavLink to="/notifications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Bell size={18} />
              <span>Notifications</span>
              {unread > 0 && <i className="nav-count">{unread > 9 ? '9+' : unread}</i>}
            </NavLink>
          )}
        </nav>

        {/* Sidebar Footer with Confirmation Logout */}
        <div className="sidebar-bottom">
          <div className="profile-row">
            <div className="avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div>
            <div className="profile-info">
              <strong>{user?.name}</strong>
              <span>{roleTitle}</span>
            </div>
            <button
              className="icon-btn profile-logout"
              title="Sign out of workspace"
              onClick={handleLogout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Support Workspace <span>/</span>{' '}
            <strong>
              {links.find((l) => l.to === loc.pathname)?.label ||
                (loc.pathname === '/notifications'
                  ? 'Notifications'
                  : loc.pathname === '/issues'
                  ? 'Engineer Issues'
                  : loc.pathname === '/assets'
                  ? 'Asset desk'
                  : 'Workspace')}
            </strong>
          </div>

          <div className="topbar-actions">
            <span className="secure-label">
              <span className="green-dot" /> Session active
            </span>

            <button
              className="icon-btn notification-btn"
              title="Notifications"
              onClick={() => nav('/notifications')}
            >
              <Bell size={18} />
              {unread > 0 && <i />}
            </button>

            <button className="topbar-user" onClick={() => nav('/profile')}>
              <div className="avatar avatar-small">{user?.name?.slice(0, 1).toUpperCase()}</div>
              <span>{user?.name?.split(' ')[0]}</span>
            </button>
          </div>
        </header>

        {user?.tempPasswordChangeRequired && (
          <div className="password-warning">
            <LockKeyhole size={16} /> A temporary password was issued. Please change it before continuing.
            <button onClick={() => nav('/profile')}>Change password</button>
          </div>
        )}

        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
