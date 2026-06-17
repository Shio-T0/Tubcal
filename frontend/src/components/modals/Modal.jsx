import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, X } from 'lucide-react';

import s from './Modal.module.css';

export default function Modal({ open, onClose, onMinimize, label, maxWidth = 720, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={s.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={s.panel}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {onMinimize && (
          <button
            className={s.minimize}
            onClick={onMinimize}
            aria-label="Pop out to corner"
            title="Keep watching while you browse"
          >
            <Minimize2 size={15} />
          </button>
        )}
        <button className={s.close} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
