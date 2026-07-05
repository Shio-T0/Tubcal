import s from './ui.module.css';

export default function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className={s.toastStack}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${s.toast} ${t.type === 'error' ? s.toastError : ''} ${t.type === 'success' ? s.toastSuccess : ''}`}
        >
          <span className={s.toastDot} />
          {t.message}
        </div>
      ))}
    </div>
  );
}
