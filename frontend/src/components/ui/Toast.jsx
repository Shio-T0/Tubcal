import s from './ui.module.css';

export default function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className={s.toastStack}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${s.toast} tc-float ${t.type === 'error' ? s.toastError : ''} ${t.type === 'success' ? s.toastSuccess : ''}`}
          role={t.type === 'error' ? 'alert' : 'status'}
        >
          <span className={s.toastDot} />
          <span className={s.toastText}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={s.toastAction}
              onClick={() => { t.action.run(); t.dismiss(); }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
