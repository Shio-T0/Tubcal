import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

import { api } from '../../api/client.js';
import { useSubscriptions, useToast } from '../../state.jsx';
import { Button, SegmentedControl, Spinner } from '../ui/index.jsx';
import Modal from './Modal.jsx';
import s from './Modal.module.css';

const PLATFORMS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'github', label: 'GitHub' },
];

const PLACEHOLDERS = {
  youtube: '@handle, channel URL, or UC… id',
  reddit: 'subreddit name, e.g. programming',
  github: 'owner/repo or username',
};

export default function AddSubscriptionModal({
  open,
  onClose,
  initialPlatform = 'youtube',
  initialInput = null,
}) {
  const [platform, setPlatform] = useState(initialPlatform);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [adding, setAdding] = useState(false);
  const { refreshSubs } = useSubscriptions();
  const toast = useToast();
  const debounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      setPlatform(initialPlatform);
      setInput(initialInput || '');
      setPreview(null);
      setResolveError(null);
    }
  }, [open, initialPlatform, initialInput]);

  // debounced live resolve preview
  useEffect(() => {
    setPreview(null);
    setResolveError(null);
    clearTimeout(debounceRef.current);
    const value = input.trim();
    if (!value || value.length < 2) {
      setResolving(false);
      return undefined;
    }
    setResolving(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api(`/${platform}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ input: value }),
        });
        setPreview(data);
      } catch (e) {
        setResolveError(e.message);
      } finally {
        setResolving(false);
      }
    }, 650);
    return () => clearTimeout(debounceRef.current);
  }, [input, platform]);

  const add = async () => {
    setAdding(true);
    try {
      const row = await api('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ platform, input: input.trim() }),
      });
      toast(`Added ${row.display_name}`, 'success');
      await refreshSubs();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const previewName = preview
    ? platform === 'youtube'
      ? preview.title
      : platform === 'reddit'
        ? preview.title
        : preview.name
    : null;
  const previewThumb = preview
    ? platform === 'youtube'
      ? preview.thumbnail
      : platform === 'reddit' || platform === 'github'
        ? preview.icon
        : null
    : null;

  return (
    <Modal open={open} onClose={onClose} label="Add subscription" maxWidth={460}>
      <div className={s.modalBody}>
        <h2 className={s.modalTitle}>Add subscription</h2>
        <SegmentedControl
          options={PLATFORMS}
          value={platform}
          onChange={(p) => {
            setPlatform(p);
            setInput('');
          }}
        />
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && input.trim()) add();
          }}
          placeholder={PLACEHOLDERS[platform]}
          style={{
            padding: '11px 14px',
            borderRadius: 'var(--r-input)',
            border: '1px solid var(--border-glass-strong)',
            background: 'var(--surface-input)',
            color: 'var(--text-primary)',
            outline: 'none',
            fontSize: 14,
          }}
        />

        <div style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 12 }}>
          {resolving && <Spinner />}
          {!resolving && preview && (
            <>
              {previewThumb ? (
                <img
                  src={previewThumb}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--surface-glass-hover)',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                  }}
                >
                  {previewName?.charAt(0).toUpperCase()}
                </span>
              )}
              <div>
                <div style={{ fontWeight: 600 }}>{previewName}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Check size={12} /> found
                </div>
              </div>
            </>
          )}
          {!resolving && resolveError && (
            <span style={{ color: 'var(--danger)', fontSize: 13 }}>{resolveError}</span>
          )}
        </div>

        <Button onClick={add} disabled={!input.trim() || adding || resolving}>
          {adding ? 'Adding…' : 'Add subscription'}
        </Button>
      </div>
    </Modal>
  );
}