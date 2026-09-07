/**
 * The security-relevant paths only. If these break, money or privacy is at risk.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToCents, onRequestPost } from './checkout.js';

// Verification now fails closed, so tests that expect to reach Stripe must opt
// out the same way local dev does.
const DEV = { STRIPE_SECRET_KEY: 'sk_test_x', ALLOW_UNVERIFIED_SUBMISSIONS: '1' };

const post = (body, headers = {}) =>
  new Request('https://beta.sbfloan.com/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Swap fetch for one that records what we would have sent to Stripe. */
async function captureStripeCall(fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push({ params: new URLSearchParams(init.body), headers: init.headers });
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await fn(); } finally { globalThis.fetch = realFetch; }
  return calls;
}

test('amount parsing rejects everything that is not honest money', () => {
  assert.equal(parseAmountToCents('36'), 3600);
  assert.equal(parseAmountToCents('36.50'), 3650);
  assert.equal(parseAmountToCents('$1,800.00'), 180000);

  // parseFloat() would happily return 12 for the first of these.
  for (const bad of ['12abc', '-50', '0', '0.5', '1e5', 'NaN', 'Infinity',
                     '99999999', '', null, undefined, {}, [], '10.999']) {
    assert.equal(parseAmountToCents(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('cross-origin POST is refused', async () => {
  const res = await onRequestPost({
    request: post({ amount: '18' }, { origin: 'https://evil.example' }),
    env: {},
  });
  assert.equal(res.status, 403);
});

test('frequency must be on the allowlist', async () => {
  const res = await onRequestPost({ request: post({ amount: '18', frequency: 'yearly' }), env: DEV });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_frequency');
});

test('oversized body is refused before parsing', async () => {
  const res = await onRequestPost({ request: post('x'.repeat(4096)), env: {} });
  assert.equal(res.status, 413);
});

test('a missing Turnstile secret fails closed', async () => {
  // Previously an unset secret meant "skip the check", so a forgotten env var
  // silently opened the endpoint.
  const res = await onRequestPost({
    request: post({ amount: '18' }),
    env: { STRIPE_SECRET_KEY: 'sk_test_x' },       // no secret, no dev flag
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'verification_failed');
});

test('redirect URLs come from our origin, never from the request body', async () => {
  const [call] = await captureStripeCall(async () => {
    const res = await onRequestPost({
      request: post({
        amount: '18',
        frequency: 'monthly',
        success_url: 'https://evil.example/steal',   // attempted open redirect
        cancel_url: 'https://evil.example/steal',
        mode: 'setup',                               // attempted mass assignment
      }),
      env: DEV,
    });
    assert.equal(res.status, 200);
  });
  assert.match(call.params.get('success_url'), /^https:\/\/beta\.sbfloan\.com\//);
  assert.match(call.params.get('cancel_url'), /^https:\/\/beta\.sbfloan\.com\//);
  assert.equal(call.params.get('mode'), 'subscription');   // not the injected 'setup'
  assert.equal(call.params.get('line_items[0][price_data][unit_amount]'), '1800');
  assert.equal(call.params.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.equal(call.params.get('line_items[0][price_data][product_data][name]'), 'Monthly donation');
});

test('weekly cadence maps to a weekly Stripe interval', async () => {
  const [call] = await captureStripeCall(async () => {
    const res = await onRequestPost({ request: post({ amount: '5', frequency: 'weekly' }), env: DEV });
    assert.equal(res.status, 200);
  });
  assert.equal(call.params.get('mode'), 'subscription');
  assert.equal(call.params.get('line_items[0][price_data][recurring][interval]'), 'week');
  assert.equal(call.params.get('line_items[0][price_data][unit_amount]'), '500');
});

test('two donors on one IP do not share a Checkout Session', async () => {
  // The key used to be amount+mode+ip+30s-bucket. Two people behind the same
  // NAT giving the same amount in the same window collided, and Stripe handed
  // the second one the first one's session — including their details.
  const calls = await captureStripeCall(async () => {
    for (let i = 0; i < 2; i++) {
      await onRequestPost({
        request: post({ amount: '18', frequency: 'once' }, { 'cf-connecting-ip': '203.0.113.7' }),
        env: DEV,
      });
    }
  });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].headers['idempotency-key'], calls[1].headers['idempotency-key'],
    'same-IP donors must not share an idempotency key');
});
