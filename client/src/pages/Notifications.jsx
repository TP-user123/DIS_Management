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
  AlertCircle
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
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not mark notification as read.');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      load();
    } catch {
      setError('Could not mark notifications as read.');
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
            Real-time updates on ticket assignments, broadcast handovers, event invitations, and engineer issues.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={markAllRead}>
          <CheckCheck size={16} /> Mark all as read
        </button>
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
