import { X } from 'lucide-react';
export default function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal">
      <header className="modal-header"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18}/></button></header>
      {children}
    </section>
  </div>;
}
