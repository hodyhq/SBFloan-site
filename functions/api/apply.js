/**
 * POST /api/apply — hardship application -> PDF -> email.
 *
 * Threat model (public, unauthenticated, writes into a human's inbox):
 *  - Open attachment relay: the PDF is built HERE from validated fields. A
 *    client-supplied file is never accepted, so the only thing that can ever
 *    reach the inbox is a document we composed.
 *  - Open mail relay: the recipient comes from env, never from the request.
 *  - Header/HTML injection: control chars stripped; every value HTML-escaped
 *    before it goes near the email body.
 *  - Unrestricted resource consumption (OWASP API4): body size cap, per-field
 *    length caps, Turnstile, and an early Content-Length rejection.
 *  - Information disclosure: errors are generic; nothing user-supplied is
 *    echoed back and no applicant data is ever logged.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const MAX_BODY = 32 * 1024;

// Allowlists — anything not on them is rejected outright, not coerced.
const HELP_TYPES = ['Rent or mortgage', 'Bar or Bat Mitzvah', 'A wedding',
  'Finding a job', 'Credit card debt', 'Something else'];
const TIMELINES = ['Immediately', 'Within two weeks', 'Within a month', 'Flexible'];
const CONTACT_TIMES = ['Morning', 'Afternoon', 'Evening', 'Any time'];
const YES_NO = ['Yes', 'No'];
const HEARD = ['A friend or family member', 'Someone at shul', 'A search engine',
  'Social media', 'Somewhere else'];

const FIELDS = {
  name:      { max: 120,  required: true },
  email:     { max: 254,  required: true, email: true },
  phone:     { max: 40,   required: true },
  bestTime:  { max: 40,   required: false, oneOf: CONTACT_TIMES },
  helpType:  { max: 60,   required: true,  oneOf: HELP_TYPES },
  amount:    { max: 20,   required: true,  money: true },
  timeline:  { max: 40,   required: true,  oneOf: TIMELINES },
  before:    { max: 10,   required: true,  oneOf: YES_NO },
  situation: { max: 2000, required: true },
  heard:     { max: 60,   required: false, oneOf: HEARD },
};

const LABELS = {
  name: 'Full name', email: 'Email address', phone: 'Phone number',
  bestTime: 'Best time to reach', helpType: 'Type of help', amount: 'Amount requested',
  timeline: 'Needed by', before: 'Received help before', situation: 'Their situation',
  heard: 'How they heard about SBF',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Strip control characters (incl. CR/LF) so nothing can forge a header or line. */
const clean = (v) => String(v ?? '')
  .replace(/\r\n?/g, '\n')                                 // normalise newlines first
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')    // drop every other control char
  .trim();

const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function validate(raw) {
  const out = {}, errors = [];
  for (const [key, rule] of Object.entries(FIELDS)) {
    const value = clean(raw[key]);
    if (!value) {
      if (rule.required) errors.push(key);
      out[key] = '';
      continue;
    }
    if (value.length > rule.max) { errors.push(key); continue; }
    if (rule.oneOf && !rule.oneOf.includes(value)) { errors.push(key); continue; }
    // Deliberately permissive: one @, no whitespace. Real validation is the reply.
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { errors.push(key); continue; }
    if (rule.money && !/^\$?\s?\d{1,3}(,?\d{3})*(\.\d{1,2})?$/.test(value)) { errors.push(key); continue; }
    out[key] = value;
  }
  if (raw.consent !== true && raw.consent !== 'true') errors.push('consent');
  return { data: out, errors };
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

async function buildPdf(d, receivedAt) {
  const doc = await PDFDocument.create();
  doc.setTitle('SBF application');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const M = 56, W = 595.28, H = 841.89, RIGHT = W - M * 2;
  const ink = rgb(0.05, 0.11, 0.19), soft = rgb(0.36, 0.42, 0.5), accent = rgb(0.17, 0.42, 0.8);

  let page = doc.addPage([W, H]);
  let y = H - M;

  const wrap = (text, font, size) => {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > RIGHT && line) { lines.push(line); line = word; }
        else line = next;
      }
      lines.push(line);
    }
    return lines;
  };
  const need = (h) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; } };
  const write = (text, { font = reg, size = 11, color = ink, gap = 5 } = {}) => {
    for (const line of wrap(text, font, size)) {
      need(size + gap);
      page.drawText(line, { x: M, y: y - size, size, font, color });
      y -= size + gap;
    }
  };

  write('Sepharadic Baltimore Fund', { font: bold, size: 19, gap: 4 });
  write('Application for help', { size: 13, color: accent, gap: 3 });
  write(`Received ${receivedAt}`, { size: 9.5, color: soft, gap: 18 });

  for (const key of Object.keys(FIELDS)) {
    const value = d[key];
    if (!value) continue;
    need(46);
    write(LABELS[key].toUpperCase(), { font: bold, size: 8, color: soft, gap: 4 });
    write(value, { size: 11.5, gap: key === 'situation' ? 4 : 14 });
    if (key === 'situation') y -= 10;
  }

  need(40);
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: rgb(0.85, 0.88, 0.92) });
  y -= 16;
  write('Submitted via sbfloan.com. The applicant confirmed the information is accurate '
      + 'and that SBF may contact them. No copy of this application is stored on the website.',
      { size: 8.5, color: soft });

  return doc.save();
}

export async function onRequestPost({ request, env }) {
  // Same-origin only. No cookies are involved, so this is defence in depth
  // rather than the CSRF control itself.
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return json(403, { error: 'forbidden' });
    } catch { return json(403, { error: 'forbidden' }); }
  }

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) return json(413, { error: 'too_large' });

  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'too_large' });
    raw = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('shape');
  } catch { return json(400, { error: 'bad_request' }); }

  // Honeypot: a field no human sees. Answer 200 so a bot learns nothing.
  if (clean(raw.website)) return json(200, { ok: true });

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await verifyTurnstile(raw.turnstileToken, ip, env))) {
    return json(400, { error: 'verification_failed' });
  }

  const { data, errors } = validate(raw);
  if (errors.length) return json(400, { error: 'invalid', fields: errors });

  if (!env.RESEND_API_KEY || !env.APPLY_TO || !env.APPLY_FROM) {
    console.error('apply: mail env not configured');
    return json(500, { error: 'server_error' });
  }

  const receivedAt = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeStyle: 'short', timeZone: 'America/New_York',
  }).format(new Date());

  let pdf;
  try { pdf = await buildPdf(data, receivedAt); }
  catch (e) { console.error('apply: pdf render failed', e?.message); return json(500, { error: 'server_error' }); }

  // btoa is byte-oriented; chunk so a large PDF can't blow the argument limit.
  let bin = '';
  for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));

  const row = (k, v) => `<tr><td style="padding:6px 14px 6px 0;color:#667;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#111">${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.APPLY_FROM,
      to: [env.APPLY_TO],
      reply_to: data.email,
      // Subject is composed from a validated allowlist value plus a
      // length-capped, control-char-stripped name. Nothing raw reaches it.
      subject: `Application — ${data.helpType} — ${data.name.slice(0, 60)}`,
      html: `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6">
        <p style="margin:0 0 4px"><strong>New application</strong> via sbfloan.com</p>
        <p style="margin:0 0 16px;color:#667">${escapeHtml(receivedAt)}</p>
        <table style="border-collapse:collapse">${Object.keys(FIELDS).filter((k) => data[k]).map((k) => row(LABELS[k], data[k])).join('')}</table>
        <p style="margin:18px 0 0;color:#667">The same details are attached as a PDF. Replying goes to the applicant.</p>
      </div>`,
      attachments: [{ filename: `SBF-application-${Date.now()}.pdf`, content: btoa(bin) }],
    }),
  });

  if (!res.ok) {
    console.error('apply: resend rejected', res.status);   // status only — never the payload
    return json(502, { error: 'send_failed' });
  }
  return json(200, { ok: true });
}
