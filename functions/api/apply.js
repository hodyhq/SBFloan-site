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

const MAX_BODY = 48 * 1024;

const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const GUARANTORS = ['Yes, I can provide two guarantors', 'Yes, I can provide one guarantor',
  'No, I cannot provide any guarantors'];
const YES_NO = ['Yes', 'No'];

/** Section order drives both the PDF and the email table. */
export const SECTIONS = [
  { title: 'Applicant information', keys: ['name', 'dob', 'phone', 'email', 'address', 'marital', 'dependents'] },
  { title: 'Loan request', keys: ['amount', 'purpose', 'neededBy'] },
  { title: 'Repayment', keys: ['monthlyRepay', 'guarantors'] },
  { title: 'General eligibility', keys: ['overdue', 'overdueDetail', 'bankruptcy'] },
  { title: 'Final questions', keys: ['openToContact'] },
];

export const FIELDS = {
  name:          { label: 'Full name',                         max: 120,  required: true },
  dob:           { label: 'Date of birth',                     max: 10,   required: true, date: true },
  phone:         { label: 'Phone number',                      max: 40,   required: true },
  email:         { label: 'Email address',                     max: 254,  required: true, email: true },
  address:       { label: 'Home address',                      max: 300,  required: true, multiline: true },
  marital:       { label: 'Marital status',                    max: 20,   required: true, oneOf: MARITAL },
  dependents:    { label: 'Number of dependents',              max: 3,    required: true, digits: true },
  amount:        { label: 'Loan amount requested',             max: 20,   required: true, money: true },
  purpose:       { label: 'Purpose of the loan',               max: 1500, required: true, multiline: true },
  neededBy:      { label: 'Date funds are needed by',          max: 10,   required: true, date: true },
  monthlyRepay:  { label: 'Can repay monthly',                 max: 20,   required: true, money: true },
  guarantors:    { label: 'Guarantors',                        max: 60,   required: true, oneOf: GUARANTORS },
  overdue:       { label: 'Overdue bills or missed payments',  max: 5,    required: true, oneOf: YES_NO },
  overdueDetail: { label: 'Explanation',                       max: 1000, required: false, multiline: true },
  bankruptcy:    { label: 'Has ever filed for bankruptcy',     max: 5,    required: true, oneOf: YES_NO },
  openToContact: { label: 'Open to being contacted to discuss', max: 5,   required: true, oneOf: YES_NO },
  signature:     { label: 'Signed',                            max: 120,  required: true },
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

const prettyDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
};

export function validate(raw) {
  const out = {}, errors = [];
  for (const [key, rule] of Object.entries(FIELDS)) {
    const value = clean(raw[key]);
    if (!value) {
      if (rule.required) errors.push(key);
      out[key] = '';
      continue;
    }
    // Newlines belong only in the fields that are genuinely multi-line. A
    // newline in a single-line field (name, especially) would flow into the
    // email subject, which is where header injection lives.
    const v = rule.multiline ? value : value.replace(/\n+/g, ' ').trim();
    if (v.length > rule.max) { errors.push(key); continue; }
    if (rule.oneOf && !rule.oneOf.includes(v)) { errors.push(key); continue; }
    if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { errors.push(key); continue; }
    if (rule.digits && !/^\d{1,3}$/.test(v)) { errors.push(key); continue; }
    if (rule.money && !/^\$?\s?\d{1,3}(,?\d{3})*(\.\d{1,2})?$/.test(v)) { errors.push(key); continue; }
    if (rule.date && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors.push(key); continue; }
    out[key] = rule.date ? prettyDate(v) : v;
  }
  // Saying yes to overdue bills makes the explanation mandatory.
  if (out.overdue === 'Yes' && !out.overdueDetail) errors.push('overdueDetail');
  if (raw.declaration !== true && raw.declaration !== 'true') errors.push('declaration');
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

const NAVY = rgb(0.055, 0.16, 0.32);
const ACCENT = rgb(0.30, 0.65, 0.94);
const INK = rgb(0.07, 0.11, 0.18);
const SOFT = rgb(0.42, 0.48, 0.56);
const HAIR = rgb(0.88, 0.90, 0.93);
const BAND = rgb(0.965, 0.975, 0.99);

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 52;
const LABEL_W = 148;
const VAL_X = MARGIN + LABEL_W;
const VAL_W = PAGE_W - MARGIN - VAL_X - 8;

export async function buildPdf(d, receivedAt) {
  const doc = await PDFDocument.create();
  doc.setTitle('SBF loan application');
  doc.setSubject('Interest-Free Loan Program application');
  doc.setProducer('sbfloan.com');

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const pages = [];
  let page, y;

  const wrap = (text, font, size, width) => {
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (!para) { lines.push(''); continue; }
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
    }
    return lines;
  };

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); pages.push(page); y = PAGE_H - MARGIN; };
  const room = (h) => { if (y - h < MARGIN + 30) newPage(); };

  newPage();

  // masthead
  page.drawRectangle({ x: 0, y: PAGE_H - 104, width: PAGE_W, height: 104, color: NAVY });
  page.drawRectangle({ x: 0, y: PAGE_H - 107, width: PAGE_W, height: 3, color: ACCENT });
  page.drawText('Sepharadic Baltimore Fund', { x: MARGIN, y: PAGE_H - 50, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Interest-Free Loan Program \u2014 application', {
    x: MARGIN, y: PAGE_H - 70, size: 10.5, font: reg, color: rgb(0.72, 0.83, 0.94) });
  const stamp = 'Received ' + receivedAt;
  page.drawText(stamp, { x: PAGE_W - MARGIN - reg.widthOfTextAtSize(stamp, 8.5), y: PAGE_H - 88,
    size: 8.5, font: reg, color: rgb(0.60, 0.72, 0.86) });
  y = PAGE_H - 104 - 32;

  // the three numbers a reviewer looks for first
  const chips = [['Amount requested', d.amount], ['Can repay monthly', d.monthlyRepay], ['Needed by', d.neededBy]];
  const chipW = (PAGE_W - MARGIN * 2 - 16) / 3;
  chips.forEach(([label, value], i) => {
    const x = MARGIN + i * (chipW + 8);
    page.drawRectangle({ x, y: y - 46, width: chipW, height: 46, color: BAND });
    page.drawRectangle({ x, y: y - 46, width: 2.5, height: 46, color: ACCENT });
    page.drawText(label.toUpperCase(), { x: x + 12, y: y - 17, size: 6.8, font: bold, color: SOFT });
    page.drawText((wrap(value || '\u2014', bold, 12.5, chipW - 24)[0] || ''), {
      x: x + 12, y: y - 34, size: 12.5, font: bold, color: INK });
  });
  y -= 46 + 26;

  const heading = (title) => {
    room(42);
    page.drawText(title.toUpperCase(), { x: MARGIN, y: y - 10, size: 8.5, font: bold, color: ACCENT });
    page.drawLine({ start: { x: MARGIN, y: y - 18 }, end: { x: PAGE_W - MARGIN, y: y - 18 },
      thickness: 0.9, color: ACCENT });
    y -= 30;
  };

  const row = (label, value, shaded) => {
    // Labels wrap too. A fixed label column plus an unwrapped label meant long
    // questions ran straight into the value ("...missed paymentYes").
    const labelLines = wrap(label, bold, 9, LABEL_W - 18);
    const valueLines = wrap(value, reg, 10.5, VAL_W);
    const h = Math.max(25, valueLines.length * 14 + 11, labelLines.length * 12 + 12);
    room(h);
    if (shaded) page.drawRectangle({ x: MARGIN, y: y - h, width: PAGE_W - MARGIN * 2, height: h, color: BAND });
    labelLines.forEach((line, i) => page.drawText(line, {
      x: MARGIN + 8, y: y - 17 - i * 12, size: 9, font: bold, color: SOFT }));
    valueLines.forEach((line, i) => page.drawText(line, {
      x: VAL_X, y: y - 17 - i * 14, size: 10.5, font: reg, color: INK }));
    y -= h;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: HAIR });
  };

  for (const section of SECTIONS) {
    const present = section.keys.filter((k) => d[k]);
    if (!present.length) continue;
    heading(section.title);
    present.forEach((key, i) => row(FIELDS[key].label, d[key], i % 2 === 1));
    y -= 18;
  }

  // declaration + signature
  room(92);
  page.drawRectangle({ x: MARGIN, y: y - 80, width: PAGE_W - MARGIN * 2, height: 80, color: BAND });
  page.drawRectangle({ x: MARGIN, y: y - 80, width: 2.5, height: 80, color: ACCENT });
  page.drawText('DECLARATION', { x: MARGIN + 14, y: y - 20, size: 7.5, font: bold, color: SOFT });
  page.drawText('I declare that the information provided is true and complete.', {
    x: MARGIN + 14, y: y - 38, size: 10, font: italic, color: INK });
  page.drawText('Signed', { x: MARGIN + 14, y: y - 64, size: 8, font: bold, color: SOFT });
  page.drawText(d.signature, { x: MARGIN + 58, y: y - 65, size: 11.5, font: bold, color: INK });
  page.drawText(receivedAt, { x: PAGE_W - MARGIN - 14 - reg.widthOfTextAtSize(receivedAt, 9), y: y - 64,
    size: 9, font: reg, color: SOFT });
  y -= 80;

  // footer on every page
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: MARGIN, y: MARGIN - 14 }, end: { x: PAGE_W - MARGIN, y: MARGIN - 14 },
      thickness: 0.5, color: HAIR });
    pg.drawText('Submitted via sbfloan.com \u2014 no copy is stored on the website.', {
      x: MARGIN, y: MARGIN - 26, size: 7.5, font: reg, color: SOFT });
    const n = 'Page ' + (i + 1) + ' of ' + pages.length;
    pg.drawText(n, { x: PAGE_W - MARGIN - reg.widthOfTextAtSize(n, 7.5), y: MARGIN - 26,
      size: 7.5, font: reg, color: SOFT });
  });

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
    dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York',
  }).format(new Date());

  let pdf;
  try { pdf = await buildPdf(data, receivedAt); }
  catch (e) { console.error('apply: pdf render failed', e?.message); return json(500, { error: 'server_error' }); }

  // btoa is byte-oriented; chunk so a large PDF can't blow the argument limit.
  let bin = '';
  for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));

  const rows = SECTIONS.flatMap((sec) => {
    const present = sec.keys.filter((k) => data[k]);
    if (!present.length) return [];
    return [
      `<tr><td colspan="2" style="padding:16px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#1B54D4;font-weight:700">${escapeHtml(sec.title)}</td></tr>`,
      ...present.map((k) =>
        `<tr><td style="padding:5px 16px 5px 0;color:#667;white-space:nowrap;vertical-align:top">${escapeHtml(FIELDS[k].label)}</td>`
        + `<td style="padding:5px 0;color:#111">${escapeHtml(data[k]).replace(/\n/g, '<br>')}</td></tr>`),
    ];
  }).join('');

  const safeName = data.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'applicant';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.APPLY_FROM,
      to: [env.APPLY_TO],
      reply_to: data.email,
      // Subject is composed from a validated allowlist value plus a
      // length-capped, control-char-stripped name. Nothing raw reaches it.
      subject: `Loan application — ${data.name.slice(0, 60)} — ${data.amount}`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">
        <p style="margin:0 0 2px"><strong style="font-size:16px">New loan application</strong></p>
        <p style="margin:0 0 18px;color:#667">${escapeHtml(receivedAt)} &middot; via sbfloan.com</p>
        <table style="border-collapse:collapse;width:100%;max-width:640px">${rows}</table>
        <p style="margin:22px 0 0;padding-top:14px;border-top:1px solid #e6e6e6;color:#667;font-size:13px">
          The full application is attached as a PDF. Replying to this email goes to the applicant.
        </p>
      </div>`,
      attachments: [{ filename: `SBF-application-${safeName}.pdf`, content: btoa(bin) }],
    }),
  });

  if (!res.ok) {
    console.error('apply: resend rejected', res.status);   // status only — never the payload
    return json(502, { error: 'send_failed' });
  }
  return json(200, { ok: true });
}
