/* sbfloan.com — the only client JS on the site. No framework, no tracking. */
(() => {
  'use strict';

  /* ---- mobile nav ---- */
  const burger = document.querySelector('.burger');
  const mnav = document.getElementById('mnav');
  if (burger && mnav) {
    burger.addEventListener('click', () => {
      const open = mnav.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---- Zelle address: assembled here so it isn't sitting in the served HTML
          as a harvestable string, and never rendered as a mailto: link. ---- */
  const z = document.querySelector('[data-zu]');
  if (z) {
    const addr = `${z.dataset.zu}@${z.dataset.zh}`;
    z.textContent = addr;
    const copy = document.getElementById('copy-zelle');
    if (copy) {
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(addr); copy.textContent = 'Copied'; }
        catch { copy.textContent = 'Press to select, then copy'; }
        setTimeout(() => { copy.textContent = 'Copy address'; }, 2400);
      });
    }
  }

  const show = (el, kind, msg) => {
    if (!el) return;
    el.hidden = false;
    el.dataset.kind = kind;
    el.textContent = msg;
  };

  /* ---- donate ---- */
  const dform = document.getElementById('donate-form');
  if (dform) {
    const status = document.getElementById('donate-status');
    const go = document.getElementById('donate-go');
    const freqBtns = [...document.querySelectorAll('#freq [data-freq]')];
    const sets = [...document.querySelectorAll('[data-set]')];
    const hint = document.getElementById('amt-hint');
    let frequency = 'once';

    const activeSet = () => sets.find((s) => !s.hidden);
    const amountButtons = () => [...activeSet().querySelectorAll('[data-amount]')];

    const clearAmount = () => {
      sets.forEach((s) => {
        s.querySelectorAll('[data-amount]').forEach((b) => b.setAttribute('aria-checked', 'false'));
      });
    };

    const setFrequency = (f) => {
      frequency = f;
      freqBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.freq === f)));
      const want = f === 'once' ? 'once' : 'recur';
      sets.forEach((s) => { s.hidden = s.dataset.set !== want; });
      clearAmount();
      if (hint) {
        hint.textContent = f === 'once'
          ? 'One-time gifts in multiples of chai. Give any other amount in the last box.'
          : `Choose a ${f} amount, or give any other amount in the last box.`;
      }
    };

    freqBtns.forEach((b) => b.addEventListener('click', () => setFrequency(b.dataset.freq)));

    sets.forEach((set) => {
      set.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-amount]');
        if (!btn) return;
        clearAmount();
        btn.setAttribute('aria-checked', 'true');
        set.querySelectorAll('.custom').forEach((i) => { i.value = ''; });
      });
      set.querySelectorAll('.custom').forEach((input) => {
        input.addEventListener('input', clearAmount);
      });
    });

    const chosenAmount = () => {
      const set = activeSet();
      const picked = set.querySelector('[data-amount][aria-checked="true"]');
      if (picked) return picked.dataset.amount;
      const custom = set.querySelector('.custom');
      return custom && custom.value.trim() ? custom.value.trim() : '';
    };

    // Deep link: /donate/?amount=5&frequency=weekly (the Erev Shabbat campaign).
    const q = new URLSearchParams(location.search);
    const qf = q.get('frequency');
    setFrequency(['once', 'weekly', 'monthly'].includes(qf) ? qf : 'once');
    const qa = q.get('amount');
    if (qa) {
      const match = amountButtons().find((b) => b.dataset.amount === qa);
      if (match) match.setAttribute('aria-checked', 'true');
      else { const c = activeSet().querySelector('.custom'); if (c) c.value = qa; }
    }

    dform.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = chosenAmount();
      if (!amount) { show(status, 'err', 'Choose an amount first.'); return; }
      go.disabled = true;
      show(status, 'ok', 'Taking you to secure checkout…');
      try {
        const r = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount, frequency }),
        });
        const d = await r.json();
        if (r.ok && d.url) { location.href = d.url; return; }
        show(status, 'err', d.error === 'invalid_amount'
          ? 'That amount does not look right. Enter between $1 and $50,000.'
          : 'Something went wrong starting checkout. Please try again.');
      } catch {
        show(status, 'err', 'Could not reach the server. Please try again.');
      }
      go.disabled = false;
    });
  }

  /* ---- apply ---- */
  const aform = document.getElementById('apply-form');
  if (aform) {
    const status = document.getElementById('apply-status');
    const go = document.getElementById('apply-go');
    aform.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!aform.checkValidity()) {
        aform.reportValidity();
        return;
      }
      const fd = new FormData(aform);
      const payload = Object.fromEntries(fd.entries());
      payload.consent = aform.consent.checked;
      go.disabled = true;
      show(status, 'ok', 'Sending your application…');
      try {
        const r = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          aform.reset();
          show(status, 'ok', 'Sent. Someone from the fund will be in touch. Nothing was stored on this website.');
        } else if (d.error === 'invalid') {
          show(status, 'err', 'Some answers need another look. Check the required fields and try again.');
        } else {
          show(status, 'err', 'Something went wrong sending your application. Please try again.');
        }
      } catch {
        show(status, 'err', 'Could not reach the server. Please try again.');
      }
      go.disabled = false;
    });
  }
})();
