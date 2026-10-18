export default function StatusBadge({ value }) {
  const labels = { IN_PROGRESS: 'In progress', WIP: 'In progress', OPEN: 'Open', ASSIGNED: 'Assigned', PENDING: 'Pending', RESOLVED: 'Resolved', CLOSED: 'Closed', COMPLETED: 'Completed', CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', INCIDENT: 'Incident', SERVICE_REQUEST: 'Service request', GENERAL_TASK: 'General task', MANAGER: 'Manager', TL: 'Team leader', SL: 'Shift lead', RE: 'Engineer' };
  return <span className={`badge badge-${String(value || '').toLowerCase()}`}>{labels[value] || value || '—'}</span>;
}
