/**
 * The security-relevant paths only. If these break, money or inboxes are at risk.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToCents, onRequestPost } from './checkout.js';

const post = (body, headers = {}) =>
  new Request('https://beta.sbfloan.com/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

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
  const res = await onRequestPost({
    request: post({ amount: '18', frequency: 'yearly' }),
    env: { STRIPE_SECRET_KEY: 'sk_test_x' },
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_frequency');
});

test('weekly cadence maps to a weekly Stripe interval', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    sent = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await onRequestPost({
      request: post({ amount: '5', frequency: 'weekly' }),
      env: { STRIPE_SECRET_KEY: 'sk_test_x' },
    });
    assert.equal(res.status, 200);
    assert.equal(sent.get('mode'), 'subscription');
    assert.equal(sent.get('line_items[0][price_data][recurring][interval]'), 'week');
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '500');
  } finally { globalThis.fetch = realFetch; }
});

test('oversized body is refused before parsing', async () => {
  const res = await onRequestPost({
    request: post('x'.repeat(4096)),
    env: {},
  });
  assert.equal(res.status, 413);
});

test('redirect URLs come from our origin, never from the request body', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await onRequestPost({
      request: post({
        amount: '18',
        frequency: 'monthly',
        success_url: 'https://evil.example/steal',   // attacker attempts an open redirect
        cancel_url: 'https://evil.example/steal',
        mode: 'setup',
      }),
      env: { STRIPE_SECRET_KEY: 'sk_test_x' },
    });
    assert.equal(res.status, 200);
    assert.match(sent.get('success_url'), /^https:\/\/beta\.sbfloan\.com\//);
    assert.match(sent.get('cancel_url'), /^https:\/\/beta\.sbfloan\.com\//);
    assert.equal(sent.get('mode'), 'subscription');            // not the injected 'setup'
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '1800');
    assert.equal(sent.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(sent.get('line_items[0][price_data][product_data][name]'), 'Monthly donation');
  } finally {
    globalThis.fetch = realFetch;
  }
});
