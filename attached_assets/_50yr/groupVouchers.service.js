// =====================================================================
//  groupVouchers.service.js
//  Business logic for Seaboards Golden Jubilee group voucher orders.
//  Stack: Node + Express + Postgres (pg) + Stripe.
// =====================================================================
const crypto = require('crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---- Authoritative rate table (NEVER trust amounts from the client) --------
// Jubilee Half-Board rates, per room per night, in MAJOR currency units.
const RATES = {
  one_bedroom: 2300,
  two_bedroom: 3750,
};
const CURRENCY = process.env.VOUCHER_CURRENCY || 'SCR';
const MINOR_PER_MAJOR = 100; // SCR has 100 cents. (Zero-decimal currencies: set to 1.)

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
const voucherCode = () =>
  'SEA-JUB-' + crypto.randomBytes(4).toString('hex').toUpperCase();
const creditCode = () =>
  'EZZY-CR-' + crypto.randomBytes(4).toString('hex').toUpperCase();

function lineAmountMinor(apartment_type, nights) {
  const rate = RATES[apartment_type];
  if (!rate) throw new Error(`Unknown apartment_type: ${apartment_type}`);
  const n = Number(nights);
  if (!Number.isInteger(n) || n < 1) throw new Error('nights must be a positive integer');
  return rate * n * MINOR_PER_MAJOR;
}

// ---------------------------------------------------------------------------
//  Create a group order + its per-person payable lines.
//
//  INDEPENDENT mode  -> lines: [{ apartment_type, nights, payer_name, payer_email }, ...]
//  SPLIT mode        -> split: { apartment_type, nights }, and
//                       lines: [{ payer_name, payer_email, share_minor? }, ...]
//                       (if share_minor omitted, the room total is divided equally)
// ---------------------------------------------------------------------------
async function createGroupOrder({ mode, organiser_name, organiser_email, lines, split, due_by }) {
  if (!['independent', 'split'].includes(mode)) throw new Error('invalid mode');
  if (!organiser_name || !organiser_email) throw new Error('organiser details required');
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('at least one payer required');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const statusToken = token();
    let splitApt = null, splitNights = null;

    // Pre-compute line amounts server-side.
    let lineRows;
    if (mode === 'independent') {
      lineRows = lines.map((l) => ({
        apartment_type: l.apartment_type,
        nights: l.nights,
        amount_minor: lineAmountMinor(l.apartment_type, l.nights),
        payer_name: l.payer_name,
        payer_email: l.payer_email,
      }));
    } else {
      if (!split || !split.apartment_type || !split.nights) throw new Error('split config required');
      splitApt = split.apartment_type;
      splitNights = split.nights;
      const roomTotal = lineAmountMinor(splitApt, splitNights);
      const n = lines.length;
      const explicit = lines.every((l) => Number.isInteger(l.share_minor));
      if (explicit) {
        const sum = lines.reduce((s, l) => s + l.share_minor, 0);
        if (sum !== roomTotal)
          throw new Error(`shares (${sum}) must sum to room total (${roomTotal})`);
        lineRows = lines.map((l) => ({
          apartment_type: null, nights: null, amount_minor: l.share_minor,
          payer_name: l.payer_name, payer_email: l.payer_email,
        }));
      } else {
        // Divide equally; push any rounding remainder onto the first share.
        const base = Math.floor(roomTotal / n);
        const remainder = roomTotal - base * n;
        lineRows = lines.map((l, i) => ({
          apartment_type: null, nights: null,
          amount_minor: base + (i === 0 ? remainder : 0),
          payer_name: l.payer_name, payer_email: l.payer_email,
        }));
      }
    }

    const order = (await client.query(
      `insert into group_order
         (mode, organiser_name, organiser_email, split_apartment_type, split_nights,
          currency, due_by, status_token)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [mode, organiser_name, organiser_email, splitApt, splitNights, CURRENCY,
       due_by || null, statusToken]
    )).rows[0];

    const created = [];
    for (const r of lineRows) {
      const payTok = token();
      const row = (await client.query(
        `insert into voucher_line
           (group_order_id, apartment_type, nights, amount_minor,
            payer_name, payer_email, pay_token)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning *`,
        [order.id, r.apartment_type, r.nights, r.amount_minor,
         r.payer_name, r.payer_email, payTok]
      )).rows[0];
      created.push(row);
    }

    await client.query('COMMIT');
    return {
      order,
      statusToken,
      organiserUrl: `${APP_BASE_URL}/group/${statusToken}`,
      lines: created.map((l) => ({
        id: l.id,
        payer_name: l.payer_name,
        payer_email: l.payer_email,
        amount_minor: l.amount_minor,
        pay_link: `${APP_BASE_URL}/pay/${l.pay_token}`,
      })),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
//  Resolve a per-person link, then mint a fresh Stripe Checkout Session.
//  Called by GET /pay/:pay_token — sidesteps Stripe's 24h session expiry by
//  creating the session just-in-time when the payer actually clicks.
// ---------------------------------------------------------------------------
async function startCheckout(pay_token) {
  const line = (await pool.query(
    `select vl.*, go.mode, go.currency, go.status as order_status, go.due_by
       from voucher_line vl join group_order go on go.id = vl.group_order_id
      where vl.pay_token = $1`, [pay_token]
  )).rows[0];
  if (!line) return { error: 'not_found' };
  if (line.status === 'paid') return { error: 'already_paid', line };
  if (line.status === 'expired' || line.order_status !== 'open')
    return { error: 'closed', line };
  if (line.due_by && new Date(line.due_by) < new Date())
    return { error: 'closed', line };

  const descr = line.apartment_type
    ? `Golden Jubilee — ${line.apartment_type.replace('_', ' ')}, ${line.nights} night(s)`
    : 'Golden Jubilee — group voucher share';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: line.payer_email,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: line.currency.toLowerCase(),
        unit_amount: Number(line.amount_minor),
        product_data: { name: descr },
      },
    }],
    metadata: { line_id: line.id, group_order_id: line.group_order_id },
    success_url: `${APP_BASE_URL}/pay/${pay_token}/done?cs={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_BASE_URL}/pay/${pay_token}`,
  });

  await pool.query(
    `update voucher_line set stripe_session_id=$1, updated_at=now() where id=$2`,
    [session.id, line.id]
  );
  return { url: session.url };
}

// ---------------------------------------------------------------------------
//  Handle a completed Stripe Checkout Session (from the webhook). Idempotent.
// ---------------------------------------------------------------------------
async function handleSessionCompleted(session) {
  const lineId = session.metadata && session.metadata.line_id;
  if (!lineId) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const line = (await client.query(
      `select * from voucher_line where id=$1 for update`, [lineId]
    )).rows[0];
    if (!line || line.status === 'paid') { await client.query('COMMIT'); return; }

    const order = (await client.query(
      `select * from group_order where id=$1 for update`, [line.group_order_id]
    )).rows[0];

    if (order.mode === 'independent') {
      // Each paid line becomes its own voucher immediately.
      await client.query(
        `update voucher_line
            set status='paid', paid_at=now(), voucher_code=$1, updated_at=now()
          where id=$2`, [voucherCode(), line.id]
      );
      // Mark the order complete once every line is paid.
      const pending = (await client.query(
        `select count(*)::int c from voucher_line
          where group_order_id=$1 and status<>'paid'`, [order.id]
      )).rows[0].c;
      if (pending === 0)
        await client.query(`update group_order set status='complete', updated_at=now() where id=$1`, [order.id]);
    } else {
      // SPLIT: mark the share paid; issue the ONE shared voucher only when all paid.
      await client.query(
        `update voucher_line set status='paid', paid_at=now(), updated_at=now() where id=$1`, [line.id]
      );
      const pending = (await client.query(
        `select count(*)::int c from voucher_line
          where group_order_id=$1 and status<>'paid'`, [order.id]
      )).rows[0].c;
      if (pending === 0) {
        await client.query(
          `update group_order set status='complete', split_voucher_code=$1, updated_at=now() where id=$2`,
          [voucherCode(), order.id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
//  Organiser status view (safe to expose via the status_token URL).
// ---------------------------------------------------------------------------
async function getOrganiserView(status_token) {
  const order = (await pool.query(
    `select * from group_order where status_token=$1`, [status_token]
  )).rows[0];
  if (!order) return null;
  const lines = (await pool.query(
    `select id, payer_name, payer_email, amount_minor, status,
            voucher_code, credit_code, apartment_type, nights, pay_token
       from voucher_line where group_order_id=$1 order by created_at`, [order.id]
  )).rows;

  return {
    mode: order.mode,
    status: order.status,
    currency: order.currency,
    organiser_name: order.organiser_name,
    due_by: order.due_by,
    split_apartment_type: order.split_apartment_type,
    split_nights: order.split_nights,
    split_voucher_code: order.split_voucher_code,
    paid_count: lines.filter((l) => l.status === 'paid').length,
    total_count: lines.length,
    lines: lines.map((l) => ({
      id: l.id,
      payer_name: l.payer_name,
      payer_email: l.payer_email,
      amount_major: Number(l.amount_minor) / MINOR_PER_MAJOR,
      status: l.status,
      voucher_code: l.voucher_code,
      credit_code: l.credit_code,
      apartment_type: l.apartment_type,
      nights: l.nights,
      pay_link: `${APP_BASE_URL}/pay/${l.pay_token}`,
    })),
  };
}

// "Resend" simply returns the (stable) link again; wire your mailer here.
async function resendLine(status_token, line_id) {
  const row = (await pool.query(
    `select vl.pay_token, vl.payer_email, vl.status
       from voucher_line vl join group_order go on go.id=vl.group_order_id
      where go.status_token=$1 and vl.id=$2`, [status_token, line_id]
  )).rows[0];
  if (!row) return null;
  const pay_link = `${APP_BASE_URL}/pay/${row.pay_token}`;
  // TODO: send pay_link to row.payer_email via your mailer (e.g. 360dialog / SMTP).
  return { pay_link, payer_email: row.payer_email, status: row.status };
}

// ---------------------------------------------------------------------------
//  Sweep expired orders (run from a Replit Scheduled Deployment / cron).
//  Past due_by:
//    - mark unpaid lines 'expired'
//    - SPLIT mode: convert already-paid shares to Ezzy Group Credit (T&Cs Cl.5)
// ---------------------------------------------------------------------------
async function sweepExpired(now = new Date()) {
  const orders = (await pool.query(
    `select * from group_order where status='open' and due_by is not null and due_by < $1`, [now]
  )).rows;

  for (const order of orders) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `update voucher_line set status='expired', updated_at=now()
          where group_order_id=$1 and status='pending'`, [order.id]
      );
      if (order.mode === 'split') {
        // Any shares already paid become non-refundable Ezzy Group Credit.
        const paid = (await client.query(
          `select id from voucher_line where group_order_id=$1 and status='paid' and credit_code is null`,
          [order.id]
        )).rows;
        for (const p of paid) {
          await client.query(
            `update voucher_line set credit_code=$1, updated_at=now() where id=$2`,
            [creditCode(), p.id]
          );
        }
      }
      await client.query(`update group_order set status='expired', updated_at=now() where id=$1`, [order.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('sweep error', order.id, e.message);
    } finally {
      client.release();
    }
  }
  return { swept: orders.length };
}

module.exports = {
  pool, RATES, CURRENCY, MINOR_PER_MAJOR,
  createGroupOrder, startCheckout, handleSessionCompleted,
  getOrganiserView, resendLine, sweepExpired,
};
