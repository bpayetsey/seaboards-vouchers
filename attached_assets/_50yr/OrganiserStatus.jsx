// =====================================================================
//  OrganiserStatus.jsx
//  Drop into your React/Vite app. Route example: /group/:statusToken
//  Shows each payer's status with copy-link + resend, and the issued
//  voucher / credit codes. Brand: Seaboards navy & jubilee gold.
// =====================================================================
import { useEffect, useState, useCallback } from 'react';

const NAVY = '#1F3A5F', GOLD = '#B8860B', INK = '#2A2E35', MUTED = '#6B7280';
const API = import.meta.env?.VITE_API_BASE || '';

const chip = (status) => {
  const map = {
    paid:    { bg: '#E6F4EA', fg: '#1B7A3D', label: 'Paid' },
    pending: { bg: '#FFF4D6', fg: '#8A6300', label: 'Pending' },
    expired: { bg: '#F3E3E3', fg: '#9A2A2A', label: 'Expired' },
    refunded:{ bg: '#EAEAEA', fg: '#555',    label: 'Refunded' },
  };
  return map[status] || map.pending;
};

export default function OrganiserStatus({ statusToken }) {
  const token = statusToken || window.location.pathname.split('/').pop();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/group-orders/${token}`);
      if (!r.ok) throw new Error('Order not found');
      setData(await r.json());
    } catch (e) { setErr(e.message); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const copy = async (link, id) => {
    await navigator.clipboard.writeText(link);
    setCopied(id); setTimeout(() => setCopied(null), 1500);
  };
  const resend = async (lineId) => {
    await fetch(`${API}/api/group-orders/${token}/lines/${lineId}/resend`, { method: 'POST' });
    setCopied('resent-' + lineId); setTimeout(() => setCopied(null), 1500);
  };

  if (err)  return <div style={S.wrap}><p style={{ color: '#9A2A2A' }}>{err}</p></div>;
  if (!data) return <div style={S.wrap}><p style={{ color: MUTED }}>Loading…</p></div>;

  const fmt = (n) => `${data.currency} ${Number(n).toLocaleString()}`;
  const pct = data.total_count ? Math.round((data.paid_count / data.total_count) * 100) : 0;

  return (
    <div style={S.wrap}>
      <div style={S.eyebrow}>Golden Jubilee · Group Booking</div>
      <h1 style={S.h1}>{data.organiser_name}’s group</h1>
      <p style={S.sub}>
        {data.mode === 'split'
          ? `Splitting one ${data.split_apartment_type?.replace('_', ' ')} (${data.split_nights} night${data.split_nights > 1 ? 's' : ''}) across ${data.total_count} people.`
          : `${data.total_count} individual voucher${data.total_count > 1 ? 's' : ''}.`}
      </p>

      <div style={S.progressRow}>
        <div style={S.progressTrack}>
          <div style={{ ...S.progressFill, width: `${pct}%` }} />
        </div>
        <span style={S.progressLabel}>{data.paid_count}/{data.total_count} paid</span>
      </div>

      {data.mode === 'split' && data.split_voucher_code && (
        <div style={S.banner}>
          All shares paid — voucher issued: <strong>{data.split_voucher_code}</strong>
        </div>
      )}

      <div style={S.list}>
        {data.lines.map((l) => {
          const c = chip(l.status);
          return (
            <div key={l.id} style={S.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.name}>{l.payer_name}</div>
                <div style={S.meta}>
                  {l.payer_email} · {fmt(l.amount_major)}
                  {l.voucher_code && <> · <span style={{ color: NAVY }}>{l.voucher_code}</span></>}
                  {l.credit_code && <> · <span style={{ color: GOLD }}>Credit {l.credit_code}</span></>}
                </div>
              </div>
              <span style={{ ...S.chip, background: c.bg, color: c.fg }}>{c.label}</span>
              {l.status === 'pending' && (
                <div style={S.actions}>
                  <button style={S.btnGhost} onClick={() => copy(l.pay_link, l.id)}>
                    {copied === l.id ? 'Copied' : 'Copy link'}
                  </button>
                  <button style={S.btnSolid} onClick={() => resend(l.id)}>
                    {copied === 'resent-' + l.id ? 'Sent' : 'Resend'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button style={S.refresh} onClick={load}>Refresh</button>
    </div>
  );
}

const S = {
  wrap: { maxWidth: 680, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, sans-serif', color: INK },
  eyebrow: { color: GOLD, fontWeight: 700, letterSpacing: '.22em', fontSize: 12, textTransform: 'uppercase' },
  h1: { color: NAVY, fontSize: 28, margin: '6px 0 2px', fontFamily: 'Georgia, serif' },
  sub: { color: MUTED, margin: '0 0 20px' },
  progressRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 },
  progressTrack: { flex: 1, height: 8, background: '#ECE7DC', borderRadius: 999 },
  progressFill: { height: 8, background: GOLD, borderRadius: 999, transition: 'width .4s' },
  progressLabel: { fontSize: 13, color: NAVY, fontWeight: 600, whiteSpace: 'nowrap' },
  banner: { background: '#E8EEF4', color: NAVY, padding: '12px 14px', borderRadius: 10, marginBottom: 18, fontSize: 14 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid #ECE7DC', borderRadius: 12, flexWrap: 'wrap' },
  name: { fontWeight: 600, color: NAVY },
  meta: { fontSize: 12.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis' },
  chip: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 },
  actions: { display: 'flex', gap: 8 },
  btnGhost: { border: `1px solid ${NAVY}`, color: NAVY, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  btnSolid: { border: 'none', color: '#fff', background: NAVY, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  refresh: { marginTop: 22, border: `1px solid ${GOLD}`, color: GOLD, background: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
};
