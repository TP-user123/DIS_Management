import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCheck,
  Clock3,
  ArrowUpRight,
  Ticket,
  ClipboardList,
  CalendarDays,
  ArrowRightLeft,
  ShieldCheck,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../api.js';

const icons = {
  AGING: Clock3,
  TICKET: Ticket,
  TASK: ClipboardList,
  EVENT: CalendarDays,
  HANDOVER: ArrowRightLeft,
  SECURITY: ShieldCheck,
  ISSUE: AlertCircle
};

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [desktopPermission, setDesktopPermission] = useState(() => (
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  ));

  const load = () => {
    api.get('/notifications')
      .then((r) => setItems(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Unable to load notifications.'));
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`, {});
      window.dispatchEvent(new Event('opsdesk:notifications-updated'));
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not mark notification as read.');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      window.dispatchEvent(new Event('opsdesk:notifications-updated'));
      load();
    } catch {
      setError('Could not mark notifications as read.');
    }
  };

  const enableDesktopAlerts = async () => {
    if (!('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setDesktopPermission(permission);
    } catch {
      setError('Could not request desktop alert permission. Check your browser settings.');
    }
  };

  const deleteNotification = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/notifications/${id}`);
      setItems((current) => current.filter((notification) => notification._id !== id));
      window.dispatchEvent(new Event('opsdesk:notifications-updated'));
    } catch (e) {
      setError(e.response?.data?.message || 'Could not delete this notification.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="page-stack">
      <div className="welcome-row">
        <div>
          <div className="page-kicker">ACTIVITY & ALERTS</div>
          <h1>
            Notifications<span className="title-period">.</span>
          </h1>
          <p>
            Updates on ticket assignments, handovers, event invitations, and engineer issues. Desktop alerts appear while this app is open in the background.
          </p>
        </div>
        <div className="notification-page-actions">
          {desktopPermission === 'granted' ? (
            <span className="notification-desktop-status">Desktop alerts enabled</span>
          ) : desktopPermission === 'unsupported' ? (
            <span className="notification-desktop-status">Desktop alerts unavailable</span>
          ) : desktopPermission === 'denied' ? (
            <span className="notification-desktop-status">Allow alerts in browser settings</span>
          ) : (
            <button className="btn btn-secondary" type="button" onClick={enableDesktopAlerts}>
              <Bell size={16} /> Enable desktop alerts
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={markAllRead}>
            <CheckCheck size={16} /> Mark all as read
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <section className="panel notification-list">
        {items.map((n) => {
          const Icon = icons[n.type] || Bell;
          return (
            <div className={`notification-row ${n.readAt ? 'is-read' : 'is-unread'}`} key={n._id}>
              <div className={`notification-icon ${n.type === 'AGING' ? 'notif-aging' : ''}`}>
                <Icon size={19} />
              </div>

              <div className="notification-main">
                <div className="notification-title-line">
                  <strong>{n.title}</strong>
                  {!n.readAt && <i />}
                </div>
                <p>{n.message}</p>
                <small>{new Date(n.createdAt).toLocaleString()}</small>
              </div>

              <div className="notification-actions">
                {n.link && (
                  <Link to={n.link} className="icon-btn" title="Open related item">
                    <ArrowUpRight size={16} />
                  </Link>
                )}
                {!n.readAt && (
                  <button className="btn btn-secondary btn-sm" onClick={() => markRead(n._id)}>
                    Mark read
                  </button>
                )}
                <button
                  className="icon-btn notification-delete"
                  type="button"
                  title="Delete this notification only"
                  aria-label={`Delete notification: ${n.title}`}
                  disabled={deletingId === n._id}
                  onClick={() => deleteNotification(n._id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          );
        })}

        {!items.length && (
          <div className="empty-state">
            <div className="empty-icon">
              <Bell size={22} />
            </div>
            <strong>You are all caught up</strong>
            <p>
              Notifications will appear when tickets are assigned, handovers broadcasted, or aging thresholds crossed.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
