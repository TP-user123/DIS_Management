import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import AuthPage from './pages/AuthPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tasks from './pages/Tasks.jsx';
import Handovers from './pages/Handovers.jsx';
import Team from './pages/Team.jsx';
import Tickets from './pages/Tickets.jsx';
import Events from './pages/Events.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import EngineerIssues from './pages/EngineerIssues.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Assets from './pages/Assets.jsx';
import Reports from './pages/Reports.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="screen-loading">
        <div className="loader-mark">O</div>
        <span>Preparing your workspace…</span>
      </div>
    );
  }
  return user ? children : <Navigate to="/auth/login" replace />;
}

function PermissionOnly({ permission, children }) {
  const { user } = useAuth();
  const allowed =
    user?.role === 'MANAGER' ||
    (user?.permissions || []).includes(permission);
  return allowed ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Public Authentication Routes */}
      <Route
        path="/auth/login"
        element={user ? <Navigate to="/" replace /> : <AuthPage />}
      />
      <Route
        path="/auth/forgot-password"
        element={user ? <Navigate to="/" replace /> : <ForgotPassword />}
      />
      <Route
        path="/auth/reset-password"
        element={user ? <Navigate to="/" replace /> : <ResetPassword />}
      />

      {/* Authenticated Application Shell */}
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route
          path="tickets"
          element={
            <PermissionOnly permission="tickets:view">
              <Tickets />
            </PermissionOnly>
          }
        />
        <Route
          path="tasks"
          element={
            <PermissionOnly permission="tasks:view">
              <Tasks />
            </PermissionOnly>
          }
        />
        <Route
          path="events"
          element={
            <PermissionOnly permission="events:view">
              <Events />
            </PermissionOnly>
          }
        />
        <Route path="assets" element={<Assets />} />
        <Route
          path="handovers"
          element={
            <PermissionOnly permission="tasks:view">
              <PermissionOnly permission="tasks:handover">
                <Handovers />
              </PermissionOnly>
            </PermissionOnly>
          }
        />
        {/* Confidential 1-to-1 Engineer Issues */}
        <Route path="issues" element={<EngineerIssues />} />
        <Route path="reports" element={<Reports />} />
        <Route
          path="notifications"
          element={
            <PermissionOnly permission="notifications:view">
              <Notifications />
            </PermissionOnly>
          }
        />
        <Route path="profile" element={<Profile />} />
        <Route
          path="team"
          element={
            <PermissionOnly permission="team:view">
              <Team />
            </PermissionOnly>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to={user ? '/' : '/auth/login'} replace />} />
    </Routes>
  );
}
