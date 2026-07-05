import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, X } from 'lucide-react';

import s from './Modal.module.css';

export default function Modal({ open, onClose, onMinimize, label, maxWidth = 720, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Keep Tab focus inside the dialog.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
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
