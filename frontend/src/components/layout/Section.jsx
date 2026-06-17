import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

import s from './Section.module.css';

export function SectionHead({ kicker, title, note, color, children }) {
  return (
    <div className={s.head} style={{ '--signal-local': color }}>
      <div className={s.headText}>
        <span className="kicker" style={color ? { color } : undefined}>
          {kicker}
        </span>
        <h1 className={s.title}>{title}</h1>
        {note && <p className={s.note}>{note}</p>}
      </div>
      <div className={s.controls}>{children}</div>
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className={s.searchWrap}>
      <span className={s.searchIcon}>
        <Search size={15} />
      </span>
      <input
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {value && (
        <button className={s.searchClear} onClick={() => onChange('')} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Receiving({ label = 'receiving signal' }) {
  return (
    <div className={s.receiving} role="status">
      <span className={s.receivingLabel}>{label}</span>
      <div className={s.receivingBar} />
      <div className={s.receivingBar} style={{ opacity: 0.6 }} />
      <div className={s.receivingBar} style={{ opacity: 0.3 }} />
    </div>
  );
}

export function ErrorBox({ message }) {
  return <div className={s.errorBox}>signal lost — {message}</div>;
}

/** Debounce a changing value (used by the section search bars). */
export function useDebounced(value, delay = 550) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const chipStyles = s;
