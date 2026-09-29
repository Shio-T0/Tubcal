// Subscribe / unsubscribe to a YouTube channel — on the channel page and under
// the player. `sub` is your subscription row when you already follow it.

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';

import { api } from '../../api/client.js';
import { useSubscriptions, useToast } from '../../state.jsx';
import b from './subscribe.module.css';

/** The subscription row for a channel id, if you follow it. */
export function useSubscription(channelId) {
  const { subs } = useSubscriptions();
  return channelId ? subs.youtube.find((x) => x.source_id === channelId) : undefined;
}

export function SubscribeButton({ channelId, sub, name, small = false }) {
  const { refreshSubs } = useSubscriptions();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const subscribed = !!sub;

  const toggle = async (e) => {
    e.stopPropagation();
    if (subscribed && !window.confirm(`Unsubscribe from ${name}?`)) return;
    setBusy(true);
    try {
      if (subscribed) {
        await api(`/subscriptions/${sub.id}`, { method: 'DELETE' });
        toast(`Unsubscribed from ${name}`, 'info');
      } else {
        await api('/subscriptions', { method: 'POST', body: JSON.stringify({ platform: 'youtube', input: channelId }) });
        toast(`Subscribed to ${name}`, 'success');
      }
      await refreshSubs();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`${subscribed ? b.subbed : b.subscribe} ${small ? b.small : ''}`}
      onClick={toggle}
      disabled={busy}
      title={subscribed ? `Unsubscribe from ${name}` : `Subscribe to ${name}`}
    >
      {busy ? '…' : subscribed ? <><Check size={14} /> Subscribed</> : <><Plus size={14} /> Subscribe</>}
    </button>
  );
}
