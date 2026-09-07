<div align="center">

<img src="public/assets/img/logo.png" width="90" alt="Sepharadic Baltimore Fund">

# Sepharadic Baltimore Fund

**[sbfloan.com](https://sbfloan.com)**

A community fund in Baltimore, Maryland providing emergency loans and support to
families — independent of any shul or political group, and decided on the need of
the person asking. Registered 501(c)(3).

</div>

---

## About the fund

The Sepharadic Baltimore Fund helps neighbours through hard months: rent and
mortgage, a bar or bat mitzvah, a wedding, finding work, credit card debt, or
anything else. There is no membership, no affiliation requirement, and no
threshold to clear.

If you need help, the whole first step is [one form](https://sbfloan.com/apply/).

---

## About this repository

This is the source of the website. It is public so that anyone in the community
can see how it works and help improve it.

### How it's built

Static HTML served by **Cloudflare Pages**, with two small serverless functions
doing the only dynamic work on the site. No framework, no tracker, no analytics,
and one 8 KB JavaScript file.

```
build.py              regenerates public/ — five pages share one set of templates
public/               the generated site (committed; Pages needs no build step)
  assets/css/         one stylesheet, mobile-first
  assets/js/site.js   the only client JS on the site
functions/api/
  apply.js            application → PDF (rendered here) → email via Resend
  checkout.js         donor-chosen amount → Stripe Checkout Session
```

### Two things worth knowing

**No applicant data is stored, anywhere.** When someone submits an application the
PDF is composed in memory, attached to a single email, and discarded. There is no
database, no log of submissions, and nothing to leak. The website could be taken
offline tomorrow and no one's private circumstances would go with it.

**Donors choose the amount and the cadence.** One-time, weekly, or monthly, at any
figure. Stripe supports customer-chosen amounts on one-time prices but *not* on
recurring ones, which is why `checkout.js` mints the price server-side at checkout
time rather than using a fixed Payment Link.

---

## Contributing

Improvements are welcome — a typo, a clearer sentence, a layout fix on a phone
nobody tested, better accessibility. You do not need permission to start.

1. **Fork** this repository to your own account.
2. **Make your change** on a branch:
   ```bash
   git checkout -b fix/clearer-apply-copy
   ```
3. **Edit the right file.** This is the one thing that trips people up — see below.
4. **Check it still works:**
   ```bash
   npm install
   python3 build.py     # regenerate the site
   npm test             # security tests must stay green
   npm run dev          # look at it: http://localhost:8788
   ```
5. **Open a pull request** against `main`, describing what you changed and why.

### Which file do I edit?

> [!IMPORTANT]
> **Do not edit the HTML in `public/` directly — your change will be overwritten.**
> Every page is generated from `build.py`, so that a change to the nav or the footer
> lands on all five pages instead of four.

| To change… | Edit | Then |
|---|---|---|
| Page copy, headings, structure | `build.py` | `python3 build.py` |
| Colours, spacing, layout | `public/assets/css/site.css` | — |
| Form behaviour, donate widget | `public/assets/js/site.js` | — |
| What the application asks | `build.py` **and** `functions/api/apply.js` | keep the allowlists in sync |
| Donation presets | `PRESETS_ONCE` / `PRESETS_RECUR` in `build.py` | `python3 build.py` |

Commit the regenerated files in `public/` along with your source change — the site
is served straight from the repo.

### Things to keep in mind

- **No email addresses or phone numbers on the site.** This is deliberate, to keep
  the fund's inbox out of scrapers. The Zelle handle is assembled in JavaScript
  rather than sitting in the HTML, and is never a `mailto:` link.
- **The two functions are public and unauthenticated.** Read the header comment in
  each before changing it — the validation, the server-built redirect URLs, and the
  server-side PDF rendering are all load-bearing, not ceremony.
- **Keep it accessible.** Real labels on every field, visible focus rings, and 4.5:1
  contrast minimum. Someone applying here may be doing it stressed, on an old phone,
  at midnight.
- **No analytics or third-party scripts.** People applying for financial help should
  not be tracked for doing so.

### Local secrets

Copy `.dev.vars.example` to `.dev.vars` and fill it in. That file is gitignored and
must never be committed. Production values live in the Cloudflare Pages dashboard.

---

## Licence

Code is MIT — reuse it, including for another community fund.
Content, copy, branding and the logo remain © Sepharadic Baltimore Fund.
