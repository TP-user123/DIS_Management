import { LoaderCircle } from 'lucide-react';

export default function LoadingState({ title = 'Loading', detail = 'Please wait while this section updates.', compact = false }) {
  return (
    <div className={`loading-state${compact ? ' loading-state-compact' : ''}`} role="status" aria-live="polite">
      <LoaderCircle className="loading-state-spinner" size={compact ? 19 : 24} aria-hidden="true" />
      <div className="loading-state-copy">
        <strong>{title}</strong>
        {!compact && <small>{detail}</small>}
      </div>
      {!compact && <div className="loading-state-skeleton" aria-hidden="true"><i /><i /><i /></div>}
    </div>
  );
}
