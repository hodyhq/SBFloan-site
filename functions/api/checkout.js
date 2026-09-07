/**
 * POST /api/checkout — donor-chosen amount -> Stripe Checkout Session.
 *
 * Why this endpoint exists at all: Stripe supports customer-chosen amounts on
 * ONE-TIME prices (custom_unit_amount), but NOT on recurring ones. Letting a
 * donor pick their own monthly amount therefore requires minting the price
 * server-side at checkout time, which requires a secret key at runtime.
 *
 * Threat model (public, unauthenticated, talks to a live payment processor):
 *  - Open redirect: success_url / cancel_url are built from OUR origin. The
 *    client cannot supply or influence them. This is the big one.
 *  - Mass assignment: only `amount` and `frequency` are read. Nothing else
 *    from the request body reaches Stripe.
 *  - Amount tampering: parsed to integer cents, bounds-checked. No floats, no
 *    negatives, no NaN, no scientific notation.
 *  - Resource consumption: body cap + Turnstile. Note a created session bills
 *    nobody — the blast radius of abuse is clutter, not charges.
 *  - Key scope: the runtime key is RESTRICTED to Checkout Sessions + Prices
 *    write. It cannot read customers, refund, or move money.
 */

const MAX_BODY = 2 * 1024;
const MIN_CENTS = 100;          // $1
const MAX_CENTS = 5_000_000;    // $50,000 — above this, talk to a human
// Donor picks amount AND cadence. Weekly at $5 is the Erev Shabbat campaign —
// it's the same form pre-filled, not a separate product.
const FREQUENCIES = {
  once:    { mode: 'payment',      interval: null,    label: 'Donation' },
  weekly:  { mode: 'subscription', interval: 'week',  label: 'Weekly donation' },
  monthly: { mode: 'subscription', interval: 'month', label: 'Monthly donation' },
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * Accepts "36", "36.50", "$1,800.00". Rejects anything else outright rather
 * than coercing — parseFloat("12abc") === 12 is exactly the bug to avoid.
 */
export function parseAmountToCents(input) {
  const raw = String(input ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  if (cents < MIN_CENTS || cents > MAX_CENTS) return null;
  return cents;
}

async function verifyTurnstile(token, ip, env) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Fail CLOSED. An unconfigured secret used to mean "skip the check", which
    // turned a missing env var into a silently open endpoint.
    if (env.ALLOW_UNVERIFIED_SUBMISSIONS === '1') return true;   // local dev only
    console.error('turnstile: TURNSTILE_SECRET_KEY not configured — refusing');
    return false;
  }
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body });
  return r.ok && (await r.json()).success === true;
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) return json(403, { error: 'forbidden' });
    } catch { return json(403, { error: 'forbidden' }); }
  }

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
    return json(413, { error: 'too_large' });
  }

  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'too_large' });
    raw = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('shape');
  } catch { return json(400, { error: 'bad_request' }); }

  const cents = parseAmountToCents(raw.amount);
  if (cents === null) return json(400, { error: 'invalid_amount' });

  const freq = FREQUENCIES[String(raw.frequency ?? 'once')];
  if (!freq) return json(400, { error: 'invalid_frequency' });
  const { mode, interval, label } = freq;

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await verifyTurnstile(raw.turnstileToken, ip, env))) {
    return json(400, { error: 'verification_failed' });
  }

  if (!env.STRIPE_SECRET_KEY) {
    console.error('checkout: STRIPE_SECRET_KEY not configured');
    return json(500, { error: 'server_error' });
  }

  // Built from OUR origin, never from the request body. An attacker cannot
  // turn this endpoint into a redirector to their own domain.
  const success = `${url.origin}/donate/thank-you/?s={CHECKOUT_SESSION_ID}`;
  const cancel = `${url.origin}/donate/`;

  const form = new URLSearchParams({
    mode,
    success_url: success,
    cancel_url: cancel,
    submit_type: mode === 'payment' ? 'donate' : 'auto',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': label,
    'metadata[source]': 'sbfloan.com',
  });
  if (interval) {
    form.set('line_items[0][price_data][recurring][interval]', interval);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      // Opaque and unique per attempt. A deterministic key derived from amount
      // + IP + time bucket collides for two donors behind the same NAT, and
      // Stripe would hand the second one the first one's session.
      'idempotency-key': crypto.randomUUID(),
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    console.error('checkout: stripe rejected', res.status, data?.error?.code || '');
    return json(502, { error: 'checkout_failed' });
  }
  return json(200, { url: data.url });
}
