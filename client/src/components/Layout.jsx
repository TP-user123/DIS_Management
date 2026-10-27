import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
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
  Laptop,
  Building2,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Plus
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useEffect, useRef, useState } from 'react';
import api from '../api.js';
import Swal from '../utils/swal.js';
import ThemeToggle from './ThemeToggle.jsx';

const links = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Ticket', icon: Ticket, permission: 'tickets:view' },
  { to: '/assets', label: 'Asset', icon: Laptop },
  { to: '/tasks', label: 'Task', icon: ClipboardList, permission: 'tasks:view' },
  { to: '/events', label: 'Event', icon: CalendarDays, permission: 'events:view' },
  { to: '/handovers', label: 'Handover', icon: Workflow, permission: 'tasks:view', permission2: 'tasks:handover' },
  { to: '/reports', label: 'Work tracker', icon: FileBarChart2, permission: 'reports:view' },
  { to: '/issues', label: 'Issue', icon: AlertCircle },
  { to: '/team', label: 'Teams', icon: Users, permission: 'team:view', lead: true },
  { to: '/profile', label: 'My profile', icon: UserRound }
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('opsdesk_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const knownNotificationIds = useRef(new Set());
  const notificationBaselineReady = useRef(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem('opsdesk_sidebar_collapsed', String(next));
      } catch {
        // Keep the sidebar control usable for the current session.
      }
      return next;
    });
  };

  useEffect(() => {
    setMobileNavOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (user?.tempPasswordChangeRequired && loc.pathname !== '/profile') {
      nav('/profile', { replace: true });
    }
  }, [user?.tempPasswordChangeRequired, loc.pathname, nav]);

  useEffect(() => {
    let active = true;
    const refreshUnread = () => {
      api.get('/notifications')
        .then((r) => {
          if (!active) return;
          const notifications = Array.isArray(r.data) ? r.data : [];
          const knownIds = knownNotificationIds.current;
          if (
            notificationBaselineReady.current &&
            document.visibilityState === 'hidden' &&
            'Notification' in window &&
            window.Notification.permission === 'granted'
          ) {
            notifications
              .filter((notification) => !notification.readAt && !knownIds.has(String(notification._id)))
              .slice(0, 3)
              .forEach((notification) => {
                const systemNotice = new window.Notification(notification.title || 'OpsDesk Pro', {
                  body: notification.message || 'You have a new workspace notification.',
                  tag: `opsdesk-${notification._id}`
                });
                systemNotice.onclick = () => {
                  systemNotice.close();
                  window.focus();
                  nav(notification.link || '/notifications');
                };
              });
          }
          notifications.forEach((notification) => knownIds.add(String(notification._id)));
          notificationBaselineReady.current = true;
          setUnread(notifications.filter((notification) => !notification.readAt).length);
        })
        .catch(() => {});
    };
    const handleNotificationsUpdated = () => refreshUnread();

    refreshUnread();
    const interval = window.setInterval(refreshUnread, 30000);
    window.addEventListener('opsdesk:notifications-updated', handleNotificationsUpdated);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('opsdesk:notifications-updated', handleNotificationsUpdated);
    };
  }, [loc.pathname, nav]);

  const handleLogout = async () => {
    const res = await Swal.confirm('Sign out', 'Are you sure you want to sign out of your workspace?', 'Yes, Sign out');
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
  const permissions = user?.permissions || [];
  const canCreateTicket = user?.role === 'MANAGER' || user?.role === 'RE' || (
    permissions.includes('tickets:view') && permissions.includes('tickets:import')
  );
  const canCreateOperationalTask = user?.role === 'MANAGER' || (
    permissions.includes('tasks:view') && permissions.includes('tasks:create')
  );

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand" title="TCS DIS">
          <Building2 size={19} aria-hidden="true" />
          <span>TCS DIS</span>
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
                title={label}
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
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

      {mobileNavOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      {/* Main Content Area */}
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-btn sidebar-collapse-btn"
            type="button"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={sidebarCollapsed}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            className="icon-btn mobile-menu-btn"
            type="button"
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumb">
            Support Workspace <span>/</span>{' '}
            <strong>
              {links.find((l) => l.to === loc.pathname)?.label ||
                (loc.pathname === '/notifications'
                  ? 'Notifications'
                  : loc.pathname === '/issues'
                  ? 'Issue'
                  : loc.pathname === '/assets'
                  ? 'Asset desk'
                  : 'Workspace')}
            </strong>
          </div>

          <div className="topbar-actions">
            <details
              className="topbar-add-task"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
              }}
            >
              <summary className="topbar-add-task-toggle">
                <Plus size={16} />
                <span>Add task</span>
                <ChevronDown size={14} className="topbar-add-task-chevron" />
              </summary>
              <nav className="topbar-add-task-menu" aria-label="Create an item by category">
                {canCreateTicket && (
                  <NavLink to="/tickets" state={{ openCreate: true }}>
                    <Ticket size={17} /> <span>Ticket</span>
                  </NavLink>
                )}
                {canCreateTicket && (
                  <NavLink to="/tickets" state={{ openCreate: true, requestType: 'Walk-in User' }}>
                    <UserRound size={17} /> <span>Walk-in user</span>
                  </NavLink>
                )}
                <NavLink to="/assets" state={{ openCreate: true }}>
                  <Laptop size={17} /> <span>Asset desk</span>
                </NavLink>
                {canCreateOperationalTask && (
                  <NavLink to="/tasks" state={{ openCreate: true }}>
                    <ClipboardList size={17} /> <span>Operational task</span>
                  </NavLink>
                )}
              </nav>
            </details>
            <ThemeToggle className="theme-toggle-topbar" />
            <span className="secure-label">
              <span className="green-dot" /> Session active
            </span>

            <button
              className="icon-btn notification-btn"
              title={unread ? `${unread} unread notifications` : 'Notifications'}
              aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
              onClick={() => nav('/notifications')}
            >
              <Bell size={18} />
              {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
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
