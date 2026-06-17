import s from './ui.module.css';

export function Button({ variant = 'solid', children, ...rest }) {
  const cls = { solid: s.btnSolid, ghost: s.btnGhost, danger: s.btnDanger }[variant];
  return (
    <button className={`${s.btn} ${cls}`} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ title, spinning = false, children, ...rest }) {
  return (
    <button className={s.iconBtn} title={title} aria-label={title} {...rest}>
      <span className={spinning ? s.spinning : undefined} style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </button>
  );
}

export function Badge({ color, children }) {
  return (
    <span className={s.badge} style={color ? { '--badge-c': color } : undefined}>
      {children}
    </span>
  );
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div className={s.segmented} role="tablist">
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const label = typeof opt === 'string' ? opt : opt.label;
        return (
          <button
            key={val}
            role="tab"
            aria-selected={val === value}
            className={`${s.segment} ${val === value ? s.segmentActive : ''}`}
            onClick={() => onChange(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner() {
  return <div className={s.spinner} role="status" aria-label="Loading" />;
}

export function EmptyState({ icon, color, title, subtitle, action, suggestions, onSuggestion }) {
  return (
    <div className={`${s.empty} glass`} style={{ borderRadius: 'var(--r-modal)', '--empty-c': color }}>
      <div className={s.emptyIcon}>{icon}</div>
      <h2 className={s.emptyTitle}>{title}</h2>
      <p className={s.emptySub}>{subtitle}</p>
      {action}
      {suggestions?.length > 0 && (
        <div className={s.suggestions}>
          {suggestions.map((sug) => (
            <button key={sug} className={s.suggestion} onClick={() => onSuggestion(sug)}>
              {sug}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
