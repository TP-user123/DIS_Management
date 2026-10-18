import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Send,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Search,
  RefreshCw,
  User,
  MessageSquare,
  AlertTriangle
} from 'lucide-react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/Modal.jsx';
import Swal from '../utils/swal.js';

const emptyForm = {
  title: '',
  category: 'TECHNICAL_BLOCKER',
  priority: 'MEDIUM',
  tlId: '',
  description: ''
};

export default function EngineerIssues() {
  const { user } = useAuth();
  const isTL = ['TL', 'MANAGER'].includes(user?.role);
const isRE = user?.role === 'RE';
const isSubmitter = ['RE', 'SL'].includes(user?.role);

  const [issues, setIssues] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [activeIssue, setActiveIssue] = useState(null);
  const [responseForm, setResponseForm] = useState({ status: 'IN_REVIEW', tlNotes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    api.get('/engineer-issues')
      .then((r) => setIssues(r.data))
      .catch((e) => setError(e.response?.data?.message || 'Could not load issues.'));
  };

  useEffect(() => {
    load();
    api.get('/team')
      .then((r) => setMembers(r.data.filter((u) => u.status === 'active')))
      .catch(() => {});
  }, []);

  // Filter TL candidates for the engineer or shift lead
  const availableTLs = members.filter((m) => m.role === 'TL');

  const submitIssue = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    try {
      const { data } = await api.post('/engineer-issues', form);
      Swal.success('Issue Escalated', 'Your report has been securely sent to your Team Leader.');
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to submit issue.');
    } finally {
      setBusy(false);
    }
  };

  const submitResponse = async (e) => {
    e.preventDefault();
    if (!activeIssue) return;
    setError('');
    setBusy(true);

    try {
      await api.patch(`/engineer-issues/${activeIssue._id}/respond`, responseForm);
      Swal.success('Response Sent', 'Your guidance and status update have been delivered to the engineer.');
      setActiveIssue(null);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to update issue.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = issues.filter((i) => {
    if (filterCategory !== 'ALL' && i.category !== filterCategory) return false;
    if (filterStatus !== 'ALL' && i.status !== filterStatus) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTitle = i.title?.toLowerCase().includes(q);
      const matchDesc = i.description?.toLowerCase().includes(q);
      const matchEngineer = i.engineer?.name?.toLowerCase().includes(q);
      return matchTitle || matchDesc || matchEngineer;
    }
    return true;
  });

  return (
    <div className="page-stack">
      {/* Header */}
      <div className="welcome-row">
        <div>
          <div className="page-kicker">OPERATIONAL ESCALATIONS & SUPPORT</div>
          <h1>
            Issues & Escalations Desk<span className="title-period">.</span>
          </h1>
          <p>
            {isSubmitter
              ? `Confidential 1-to-1 issue escalation directly to your Team Leader (TL). Private channel between you (${user?.role}) and your TL.`
              : 'Private 1-to-1 operational issues reported by team engineers and shift leads.'}
          </p>
        </div>
        <div>
          <span className="confidential-badge">
            <ShieldCheck size={15} /> Private 1-to-1 Channel (Submitter ↔ TL Only)
          </span>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}

      {/* Main Layout Grid */}
      <div className={`report-grid ${isSubmitter ? 'report-submit-grid' : ''}`} style={!isSubmitter ? { gridTemplateColumns: '1fr' } : {}}>
        {/* Submitter (RE & SL) Submission Form */}
        {isSubmitter && (
          <section className="panel profile-card">
            <div className="panel-heading">
              <div>
                <h2>Report an Issue or Blocker</h2>
                <p>Private communication visible only to your Team Leader.</p>
              </div>
              <span className="metric-icon orange">
                <AlertTriangle size={18} />
              </span>
            </div>

            <form className="form-stack" onSubmit={submitIssue}>
              <label>
                Issue / Problem Title
                <input
                  required
                  placeholder="e.g. VPN gateway disconnecting frequently"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>

              <div className="form-grid">
                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    <option value="TECHNICAL_BLOCKER">Technical Blocker</option>
                    <option value="TOOLING_ACCESS">Tooling & System Access</option>
                    <option value="WORKLOAD_SHIFT">Workload & Shift Issue</option>
                    <option value="PROCESS">Process / Workflow Blocker</option>
                    <option value="OTHER">Other Query</option>
                  </select>
                </label>

                <label>
                  Priority / Severity
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </label>
              </div>

              <label>
                Select Team Leader (TL)
                <select
                  value={form.tlId}
                  onChange={(e) => setForm({ ...form, tlId: e.target.value })}
                >
                  <option value="">Default Team Leader ({user?.team || 'Team'} TL)</option>
                  {availableTLs.map((tl) => (
                    <option key={tl._id || tl.id} value={tl._id || tl.id}>
                      {tl.name} ({tl.team} TL)
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Detailed Explanation
                <textarea
                  rows="4"
                  required
                  placeholder="Describe what issue you are facing, steps taken, impact on tickets/tasks, and what assistance is needed..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>

              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit Privately to TL'} <Send size={15} />
              </button>
            </form>
          </section>
        )}

        {/* Issues List Panel */}
        <section className="panel recent-panel work-report-panel">
          <div className="panel-heading">
            <div>
              <h2>{isRE ? 'My Reported Issues' : 'Engineer Escalations'}</h2>
              <p>
                {isRE
                  ? 'Tracks status and responses from your Team Leader.'
                  : 'Review and provide guidance on issues raised by your engineers.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="count-pill">{filtered.length} issues</span>
              <button className="icon-btn" title="Refresh" onClick={load}>
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="table-toolbar" style={{ padding: '0 0 16px 0', borderBottom: '1px solid #edf0f5' }}>
            <div className="search-box">
              <Search size={16} />
              <input
                placeholder="Search issues..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-controls">
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="IN_REVIEW">Under Review</option>
                <option value="RESOLVED">Resolved</option>
              </select>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="ALL">All Categories</option>
                <option value="TECHNICAL_BLOCKER">Technical Blocker</option>
                <option value="TOOLING_ACCESS">Tooling & Access</option>
                <option value="WORKLOAD_SHIFT">Workload & Shift</option>
                <option value="PROCESS">Process</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          {/* Issues Card Stream */}
          <div style={{ display: 'grid', gap: '14px', marginTop: '16px' }}>
            {filtered.map((item) => (
              <article className="issue-card" key={item._id}>
                <div className="issue-card-top">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span className={`badge badge-${item.priority?.toLowerCase()}`}>
                        {item.priority}
                      </span>
                      <span className="badge badge-incident">
                        {item.category?.replace(/_/g, ' ')}
                      </span>
                      <span
                        className={`status-pill ${
                          item.status === 'RESOLVED'
                            ? 'status-completed'
                            : item.status === 'IN_REVIEW'
                            ? 'badge-pending'
                            : 'status-open'
                        }`}
                      >
                        {item.status?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <h3 style={{ margin: '6px 0 3px', fontSize: '15px', color: '#1e293b' }}>
                      {item.title}
                    </h3>
                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '12px' }}>
                      <span>
                        <User size={13} style={{ verticalAlign: '-2px', marginRight: '3px' }} />
                        Reported by: <strong>{item.engineer?.name || 'Staff Member'}</strong>{' '}
                        <small style={{ color: '#64748b' }}>({item.engineer?.role || 'Staff'})</small>
                      </span>
                      {item.tl && (
                        <span>
                          TL: <strong>{item.tl.name}</strong>
                        </span>
                      )}
                      <span>
                        <Clock size={13} style={{ verticalAlign: '-2px', marginRight: '3px' }} />
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {isTL && item.status !== 'RESOLVED' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setActiveIssue(item);
                        setResponseForm({
                          status: item.status === 'OPEN' ? 'IN_REVIEW' : item.status,
                          tlNotes: item.tlNotes || ''
                        });
                      }}
                    >
                      <MessageSquare size={14} /> Respond / Update
                    </button>
                  )}
                </div>

                <p style={{ margin: 0, fontSize: '12px', color: '#334155', lineHeight: '1.6', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px' }}>
                  {item.description}
                </p>

                {/* TL Response Display */}
                {item.tlNotes && (
                  <div className="issue-response-box">
                    <strong>
                      <CheckCircle2 size={14} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
                      Team Leader Guidance & Action
                    </strong>
                    <p>{item.tlNotes}</p>
                    {item.resolvedAt && (
                      <small style={{ color: '#15803d', display: 'block', marginTop: '6px' }}>
                        Resolved on: {new Date(item.resolvedAt).toLocaleString()}
                      </small>
                    )}
                  </div>
                )}
              </article>
            ))}

            {!filtered.length && (
              <div className="empty-state compact">
                <div className="empty-icon">
                  <ShieldCheck size={22} />
                </div>
                <strong>No issues reported in this view</strong>
                <p>
                  {isRE
                    ? 'If you encounter any system blockers, access problems, or shift difficulties, report them here directly to your TL.'
                    : 'Your engineers have not reported any open blockers.'}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* TL Response Modal */}
      {activeIssue && (
        <Modal title={`Respond to ${activeIssue.engineer?.name || 'Engineer'}`} onClose={() => setActiveIssue(null)}>
          <form className="form-stack modal-form" onSubmit={submitResponse}>
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', color: '#334155' }}>
              <strong>Issue: {activeIssue.title}</strong>
              <p style={{ margin: '4px 0 0', color: '#64748b' }}>{activeIssue.description}</p>
            </div>

            <label>
              Update Status
              <select
                value={responseForm.status}
                onChange={(e) => setResponseForm({ ...responseForm, status: e.target.value })}
              >
                <option value="OPEN">Open (Pending Review)</option>
                <option value="IN_REVIEW">Under Review / Working on resolution</option>
                <option value="RESOLVED">Resolved (Action completed)</option>
              </select>
            </label>

            <label>
              Team Leader Resolution Notes & Guidance
              <textarea
                rows="4"
                required
                placeholder="Provide assistance, next steps, workaround, or confirmation of fix..."
                value={responseForm.tlNotes}
                onChange={(e) => setResponseForm({ ...responseForm, tlNotes: e.target.value })}
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setActiveIssue(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Send Response'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
