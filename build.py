#!/usr/bin/env python3
"""Static generator for sbfloan.com.

Five pages share one chrome, so they're generated rather than hand-maintained —
a nav change in four copies is how nav changes drift. Output lands in public/
and is committed, so Cloudflare Pages needs no build step.

    python3 build.py
"""
import pathlib, datetime, hashlib, re

SITE = "https://sbfloan.com"
ORG = "Sepharadic Baltimore Fund"
ALT = "Sephardic Baltimore Funds"           # the old site's spelling — kept for search
VIDEO_ID = "yh6BLorQu9Q"
ZELLE_USER, ZELLE_HOST = "sepharadicbaltimorefund", "gmail.com"
TURNSTILE_SITEKEY = "0x4AAAAAAEq1FeGqB-zWpYFX"
# One-time gives in multiples of chai; recurring is a smaller weekly/monthly ladder.
PRESETS_ONCE = [18, 36, 72, 180, 360]
PRESETS_RECUR = [1, 5, 10, 18, 26, 36, 52]
OUT = pathlib.Path(__file__).parent / "public"


def fingerprint(rel):
    """Content-hash an asset and hard-link the hashed name beside it.

    /assets/* is served immutable for a year, which is only safe if the URL
    changes when the bytes do. Without this, an edit never reaches anyone who
    has already visited.
    """
    src = OUT / rel
    digest = hashlib.sha256(src.read_bytes()).hexdigest()[:10]
    stem, _, ext = rel.rpartition(".")
    hashed = f"{stem}.{digest}.{ext}"
    for old in (OUT / stem).parent.glob(pathlib.Path(stem).name + ".*." + ext):
        old.unlink()                      # drop the previous build's copy
    (OUT / hashed).write_bytes(src.read_bytes())
    return "/" + hashed


ASSETS = {}
TODAY = datetime.date.today().isoformat()

NAV = [("/about/", "About"), ("/donate/", "Donate")]   # Apply lives in the CTA button

CF_MARK = "M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"

ICONS = {
    "house": '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.6V21h13V9.6"/><path d="M10 21v-6h4v6"/>',
    "scroll": '<path d="M7 5v14"/><path d="M17 5v14"/><rect x="9" y="5" width="6" height="14" rx="1"/>'
              '<circle cx="7" cy="3.6" r="1.3"/><circle cx="17" cy="3.6" r="1.3"/>',
    "rings": '<circle cx="9.5" cy="14.5" r="5.2"/><circle cx="14.5" cy="14.5" r="5.2"/><path d="M12 9 10.6 5.4h2.8L12 9z"/>',
    "case": '<rect x="2.5" y="7.5" width="19" height="12.5" rx="2.5"/>'
            '<path d="M8.5 7.5V5.6a1.6 1.6 0 0 1 1.6-1.6h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9"/><path d="M2.5 12.6h19"/>',
    "card": '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 14.6h4"/>',
    "chat": '<path d="M20.5 12.4a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.3A7.5 7.5 0 1 1 20.5 12.4z"/>',
    "tick": '<path d="M4 12.5 9.5 18 20 6.5"/>',
    "cross": '<path d="M6 6l12 12M18 6 6 18"/>',
}

CATS = [
    ("Rent &amp; mortgage", "Housing costs, or a gap between one paycheck and the next.", "house"),
    ("Bar &amp; Bat Mitzvah", "A milestone arriving in a month that cannot absorb it.", "scroll"),
    ("A wedding", "The cost of marrying off a child.", "rings"),
    ("Finding a job", "Between jobs, or looking for a way back in.", "case"),
    ("Credit card debt", "Interest compounding faster than you can pay it down.", "card"),
    ("Something else", "Every situation is different. Tell us yours.", "chat"),
]


def shot(name, alt, w, h, eager=False):
    """WebP with a JPEG fallback, intrinsic size set so nothing reflows."""
    return (f'<picture class="shot">'
            f'<source srcset="/assets/img/{name}.webp" type="image/webp">'
            f'<img src="/assets/img/{name}.jpg" width="{w}" height="{h}" alt="{alt}"'
            f'{" fetchpriority=\"high\"" if eager else " loading=\"lazy\""}>'
            f'</picture>')


def icon(name, size=24):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def head(title, desc, path, extra_ld=""):
    canonical = SITE + path
    ld = f"""{{
  "@context": "https://schema.org",
  "@graph": [
    {{
      "@type": "NGO",
      "@id": "{SITE}/#org",
      "name": "{ORG}",
      "alternateName": ["SBF", "{ALT}"],
      "url": "{SITE}/",
      "logo": "{SITE}/assets/img/logo.png",
      "description": "A Baltimore community fund providing interest-free loans and support to families, independent of any shul or political group.",
      "areaServed": {{ "@type": "City", "name": "Baltimore", "containedInPlace": {{ "@type": "State", "name": "Maryland" }} }},
      "nonprofitStatus": "Nonprofit501c3",
      "contactPoint": {{
        "@type": "ContactPoint",
        "contactType": "Application for assistance",
        "url": "{SITE}/apply/"
      }}
    }},
    {{
      "@type": "WebSite",
      "@id": "{SITE}/#website",
      "url": "{SITE}/",
      "name": "{ORG}",
      "publisher": {{ "@id": "{SITE}/#org" }},
      "inLanguage": "en-US"
    }}{extra_ld}
  ]
}}"""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{ORG}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE}/assets/img/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="/assets/img/logo.png" type="image/png">
<link rel="apple-touch-icon" href="/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Assistant:wght@400;500;600&display=swap">
<link rel="stylesheet" href="{ASSETS['css']}">
<script type="application/ld+json">{ld}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="page">
<div class="ambient" aria-hidden="true"></div>
"""


def header(active):
    links = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if href == active else ""}>{label}</a>'
        for href, label in NAV)
    mlinks = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if href == active else ""}>{label}</a>'
        for href, label in NAV)
    return f"""  <header class="hdr">
    <a class="brand" href="/">
      <img src="/assets/img/logo.png" width="40" height="40" alt="{ORG} logo">
      <span>Sepharadic<br>Baltimore Fund</span>
    </a>
    <nav class="nav" aria-label="Main">{links}
      <a class="btn btn--solid" href="/apply/">Apply for help</a>
    </nav>
    <button class="burger" type="button" aria-expanded="false" aria-controls="mnav" aria-label="Menu">
      <span></span><span></span><span></span>
    </button>
  </header>
  <nav class="mnav" id="mnav" aria-label="Main">{mlinks}<a href="/apply/">Apply for help</a></nav>
"""


def footer():
    def col(title, items):
        lis = "".join(f'<li><a href="{h}">{t}</a></li>' for h, t in items)
        return f'<div><h2>{title}</h2><ul>{lis}</ul></div>'
    return f"""</main>
<footer class="ftr">
  <div class="wrap">
    <div class="ftr-grid">
      <div>
        <a class="brand" href="/">
          <img src="/assets/img/logo.png" width="38" height="38" alt="">
          <span>{ORG}</span>
        </a>
        <p class="muted" style="margin-top:14px;max-width:340px">A community fund in Baltimore, independent of any shul or political group.</p>
      </div>
      {col("Fund", [("/about/", "About us"), ("/about/#how", "How it works"), ("/about/#video", "Watch the video")])}
      {col("Give", [("/donate/", "Donate"), ("/donate/#weekly", "Erev Shabbat campaign"), ("https://checkout.sbfloan.com/p/login/00gcQA4d89WUfjq7ss", "Donor portal")])}
      {col("Get help", [("/apply/", "Apply for help"), ("/#help", "What we help with")])}
    </div>
    <div class="ftr-btm">
      <span>&copy; {datetime.date.today().year} {ORG}</span>
      <span>Registered 501(c)(3) &middot; Contributions are tax-deductible to the extent allowed by law.</span>
    </div>
    <div class="credits">
      <span class="credit">
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="{CF_MARK}"/></svg>
        Secured by Cloudflare
      </span>
      <a class="credit" href="https://hody.dev" target="_blank" rel="noopener">
        <img src="/assets/img/hody.png" width="20" height="15" alt="">
        Built and powered by <strong>hody</strong>
      </a>
    </div>
  </div>
</footer>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script src="{ASSETS['js']}" defer></script>
</body>
</html>
"""


HERO_RE = re.compile(r'(<div class="wrap">\s*)(<section[\s\S]*?</section>)', re.M)


def page(path, title, desc, body, extra_ld="", active=""):
    """The header and the page's first section share one navy band, so the top
    of every page has weight and the logo has a dark field to sit on."""
    m = HERO_RE.search(body)
    hero = m.group(2)
    rest = body[:m.start()] + '<div class="wrap">' + body[m.end():]
    band = ('<div class="heroband">\n<div class="wrap">\n' + header(active)
            + '\n' + hero + '\n</div>\n</div>\n<main id="main">\n')
    html = head(title, desc, path, extra_ld) + band + rest + footer()
    out = OUT / path.strip("/") / "index.html" if path != "/" else OUT / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(f"  {path:<22} {len(html):>6} bytes")


# ------------------------------------------------------------------ pages ----
def build_home():
    cards = "".join(
        f'<article class="card"><span style="color:var(--acc)">{icon(name)}</span>'
        f'<h3>{t}</h3><p class="muted">{c}</p></article>' for t, c, name in CATS)
    body = f"""<div class="wrap">
  <section class="herosplit reveal">
    <div class="herotext">
      <p class="pillbadge">Interest-free loans &middot; Baltimore</p>
      <h1>Help for our<br>community.</h1>
      <p class="lede">Interest-free loans and support for families in Baltimore &mdash; decided on the need of the person asking, and nothing else.</p>
      <div class="btnrow">
        <a class="btn btn--solid" href="/apply/">Apply for help</a>
        <a class="btn btn--ghost" href="/donate/">Donate</a>
      </div>
    </div>
    <div style="position:relative">
      {shot("hero", "A loan being handed across a kitchen table, with the written agreement beside it", 1400, 1050, eager=True)}
      <div class="badge">
        <div class="logomark"><img src="/assets/img/logo.png" width="80" height="80" alt=""></div>
        <span>Interest-free<br>since day one</span>
      </div>
    </div>
  </section>

  <section class="section" id="help">
    <div class="center" style="margin-bottom:28px">
      <p class="eyebrow">What we help with</p>
      <h2>Some of the reasons<br>people come to us.</h2>
    </div>
    <div class="grid grid--3">{cards}</div>
  </section>

  <section class="section">
    <div class="split">
      <div class="stack">
        <p class="eyebrow">Independent by design</p>
        <h2>We answer to no one<br>outside this community.</h2>
        <p class="muted">We are a nonprofit, independent of any shul or political group. That independence lets us decide every case on need alone &mdash; without the nonsense of politics.</p>
        <p class="muted">We cannot help with everything, and we will say so straight away if we cannot.</p>
      </div>
      <div>
        {shot("terms", "Two people agreeing the terms of a loan over a signed document", 1400, 933)}
      </div>
    </div>
  </section>

  <section class="section" id="weekly">
    <div class="split">
      <div class="stack">
        <p class="eyebrow">Ongoing campaign</p>
        <h2>$5 every Erev Shabbat.</h2>
        <p class="muted">A standing weekly gift given before Shabbat. On its own it is small. Together it is what keeps the fund ready.</p>
      </div>
      <div class="stack" style="align-items:flex-start">
        <span class="bignum">$5</span>
        <span class="small">every week &middot; cancel any time</span>
        <a class="btn btn--solid" href="/donate/?amount=5&amp;frequency=weekly">Join the campaign</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="split">
      <div>
        <a class="video" href="https://www.youtube.com/watch?v={VIDEO_ID}" target="_blank" rel="noopener">
          <img src="https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault.jpg" width="1280" height="720" loading="lazy"
               alt="Watch: about the {ORG}">
          <span class="play" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M8 5.2v13.6L19 12z"/></svg></span>
        </a>
      </div>
      <div class="stack">
        <p class="pillbadge">In their own words</p>
        <h2>Hear it from the people<br>who built the fund.</h2>
        <p class="muted">A short introduction to what SBF does and why it exists.</p>
      </div>
    </div>
  </section>

  <section class="section center">
    <h2>Help us be ready for the<br>next family who asks.</h2>
    <p class="lede">Donations here fund the loans and support we give to families in this community.</p>
    <div class="btnrow">
      <a class="btn btn--solid" href="/donate/">Donate now</a>
      <a class="btn btn--ghost" href="/about/">About the fund</a>
    </div>
  </section>
</div>"""
    video_ld = f""",
    {{
      "@type": "VideoObject",
      "name": "About the {ORG}",
      "description": "An introduction to the {ORG}, a Baltimore community fund providing emergency help to families.",
      "thumbnailUrl": "https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault.jpg",
      "uploadDate": "2021-02-01",
      "embedUrl": "https://www.youtube.com/embed/{VIDEO_ID}",
      "publisher": {{ "@id": "{SITE}/#org" }}
    }}"""
    page("/", f"{ORG} — Emergency Help for Our Community",
         "Interest-free loans and support for families in Baltimore. Independent of any shul or political group. Decided on need alone.",
         body, video_ld, active="/")


def build_about():
    steps = [
        ("You apply", "One form, from your phone. It goes to the people who review it &mdash; not to a shul, and not onto any list."),
        ("We talk it through", "Someone from the fund reaches out to understand the situation. A conversation, and you set the pace."),
        ("Funds go out", "If we can help, we agree on repayment together before anything moves."),
    ]
    stepcards = "".join(
        f'<article class="card"><span class="pip">{i+1}</span><h3>{t}</h3><p class="muted">{c}</p></article>'
        for i, (t, c) in enumerate(steps))
    facts = ["Registered 501(c)(3) nonprofit", "A receipt is emailed for every card donation",
             "Contributions are tax-deductible to the extent allowed by law",
             "Funds are distributed within our Baltimore community"]
    factlist = "".join(
        f'<li style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">'
        f'<span style="color:var(--acc);flex-shrink:0">{icon("tick", 19)}</span>'
        f'<span class="muted">{f}</span></li>' for f in facts)
    faqs = [
        ("Do I need to be a member of a shul to apply?",
         "No. The Sepharadic Baltimore Fund is independent of any shul or political group. You do not need to be a member anywhere, know anyone, or be owed a favor."),
        ("Is my application confidential?",
         "Your application goes to the people who review it and is treated with discretion. It does not go to a shul and it does not go onto any list."),
        ("What if I cannot repay?",
         "Repayment is discussed with you before anything is agreed. We cannot help with everything, and we will say so straight away if we cannot."),
        ("What can I ask for help with?",
         "Rent and mortgage, a bar or bat mitzvah, a wedding, finding a job, credit card debt, or something else entirely. There is no threshold to clear."),
    ]
    faq_html = "".join(
        f'<details class="card" style="cursor:pointer"><summary style="font-family:var(--display);font-weight:600;font-size:1.06rem">{q}</summary>'
        f'<p class="muted" style="margin-top:10px">{a}</p></details>' for q, a in faqs)
    faq_ld = ",\n    " + """{
      "@type": "FAQPage",
      "mainEntity": [""" + ",".join(
        f'{{"@type":"Question","name":{q!r},"acceptedAnswer":{{"@type":"Answer","text":{a!r}}}}}'
        for q, a in faqs).replace("'", '"') + "]\n    }"

    body = f"""<div class="wrap">
  <section class="hero reveal">
    <div class="logomark" style="margin-bottom:6px"><img src="/assets/img/logo.png" width="80" height="80" alt=""></div>
    <p class="pillbadge">About the fund</p>
    <h1>A fund with no<br>other agenda.</h1>
    <p class="lede">Built by members of this community. No affiliation, no membership, and no interest in anything other than helping.</p>
    <div class="btnrow">
      <a class="btn btn--solid" href="/apply/">Apply for help</a>
      <a class="btn btn--ghost" href="/donate/">Donate</a>
    </div>
  </section>

  <section class="section">
    <div class="split">
      <div>
        {shot("about", "Members of the fund reviewing applications together around a table", 1400, 933)}
      </div>
      <div class="stack">
        <p class="pillbadge">Why we exist</p>
        <h2>Nobody should have to explain their hardest month to someone who has a stake in the answer.</h2>
      </div>
      <div class="stack">
        <p class="muted">Most people in a tight spot already know where they could ask. What stops them is everything attached to asking &mdash; who finds out, who feels owed, and what it means next time they walk into shul.</p>
        <p class="muted">SBF was built to remove all of that. We are a nonprofit, independent of any shul or political group, funded by donations from people in this community.</p>
      </div>
    </div>
  </section>

  <section class="section" id="how">
    <div class="center" style="margin-bottom:28px">
      <p class="eyebrow">How it works</p>
      <h2>Three steps, and none<br>of them are difficult.</h2>
    </div>
    <div class="grid grid--3">{stepcards}</div>
  </section>

  <section class="section" id="video">
    <div class="split">
      <div class="stack">
        <p class="eyebrow">In their own words</p>
        <h2>Hear it from the people<br>who built the fund.</h2>
        <p class="muted">A short introduction to what SBF does and why it exists.</p>
      </div>
      <div>
        <a class="video" href="https://www.youtube.com/watch?v={VIDEO_ID}" target="_blank" rel="noopener">
          <img src="https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault.jpg" width="1280" height="720" loading="lazy" alt="Watch: about the {ORG}">
          <span class="play" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M8 5.2v13.6L19 12z"/></svg></span>
        </a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="split">
      <div class="stack">
        <p class="eyebrow">Giving with confidence</p>
        <h2>Your donation is<br>tax-deductible.</h2>
        <p class="muted">Card donations are processed by Stripe and generate an emailed receipt, so you have a record for tax time without asking us for one.</p>
      </div>
      <div><ul>{factlist}</ul></div>
    </div>
  </section>

  <section class="section">
    <div class="center" style="margin-bottom:24px">
      <p class="pillbadge">Who runs the fund</p>
      <h2>The people reviewing your<br>application live here too.</h2>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;padding:44px 26px;
                border:2px dashed var(--line-2);border-radius:28px">
      <p class="muted" style="max-width:620px;text-align:center">[BOARD &amp; TRUSTEES &mdash; to supply.
      Names and roles, or a single paragraph if the fund prefers to stay unnamed.]</p>
    </div>
  </section>

  <section class="section">
    <div class="center" style="margin-bottom:24px">
      <p class="eyebrow">Common questions</p>
      <h2>Before you apply.</h2>
    </div>
    <div class="grid">{faq_html}</div>
  </section>

  <section class="section center">
    <h2>Whether you need help or want<br>to give it, it starts the same way.</h2>
    <div class="btnrow">
      <a class="btn btn--solid" href="/apply/">Apply for help</a>
      <a class="btn btn--ghost" href="/donate/">Donate</a>
    </div>
  </section>
</div>"""
    page("/about/", f"About the {ORG} — Baltimore",
         "A nonprofit community fund built by members of this community. How it works, who runs it, and why independence matters.",
         body, faq_ld, active="/about/")


def build_donate():
    def amt_set(values, kind, hidden):
        btns = "".join(
            f'<button class="amt" type="button" role="radio" aria-checked="false" data-amount="{a}">${a}</button>'
            for a in values)
        return (f'<div class="amounts" data-set="{kind}" role="radiogroup" '
                f'aria-label="Amount"{" hidden" if hidden else ""}>{btns}'
                f'<label class="amt amt--other" for="custom-{kind}">'
                f'<span aria-hidden="true">$</span>'
                f'<input id="custom-{kind}" class="custom" type="text" inputmode="decimal" '
                f'placeholder="Other" autocomplete="off" aria-label="Other amount in dollars"></label></div>')
    amounts = amt_set(PRESETS_ONCE, "once", False) + amt_set(PRESETS_RECUR, "recur", True)
    body = f"""<div class="wrap">
  <section class="hero reveal">
    <div class="logomark" style="margin-bottom:6px"><img src="/assets/img/logo.png" width="80" height="80" alt=""></div>
    <p class="pillbadge">Make a donation</p>
    <h1>Give what you want,<br>as often as you want.</h1>
    <p class="lede">You choose the amount and you choose how often. Every donation goes back out to a family in our own community.</p>
  </section>

  <section class="section">
    <form class="formcard" id="donate-form" style="max-width:720px;margin:0 auto" novalidate>
      <fieldset style="border:0;padding:0;margin:0 0 24px">
        <legend class="field" style="margin-bottom:12px">How often?</legend>
        <div class="amounts" style="grid-template-columns:repeat(3,minmax(0,1fr))" role="radiogroup" aria-label="Frequency" id="freq">
          <button class="amt" type="button" role="radio" aria-checked="true" data-freq="once">One time</button>
          <button class="amt" type="button" role="radio" aria-checked="false" data-freq="weekly">Weekly</button>
          <button class="amt" type="button" role="radio" aria-checked="false" data-freq="monthly">Monthly</button>
        </div>
      </fieldset>

      <fieldset style="border:0;padding:0;margin:0">
        <legend class="field" style="margin-bottom:12px">How much?</legend>
        <div id="amounts">{amounts}</div>
      </fieldset>

      <p class="small" style="margin-top:14px" id="amt-hint">One-time gifts in multiples of chai. Give any other amount in the last box.</p>

      <div class="cf-turnstile" data-sitekey="{TURNSTILE_SITEKEY}" data-theme="dark" style="margin-top:18px"></div>
      <div style="display:flex;flex-direction:column;align-items:stretch;gap:14px;margin-top:24px">
        <button class="btn btn--solid" type="submit" id="donate-go">Continue to secure checkout</button>
        <span class="small" style="text-align:center">Processed securely by Stripe. Your card details never touch our servers.</span>
      </div>
      <p class="status" id="donate-status" role="status" aria-live="polite" hidden></p>
    </form>
  </section>

  <section class="section">
    <div class="split">
      <div class="stack">
        <p class="pillbadge">Repaid, then lent again</p>
        <h2>Every dollar goes<br>back out.</h2>
        <p class="muted">Loans are repaid into the same fund and lent to the next family. A donation here does not get spent once &mdash; it keeps working.</p>
      </div>
      <div>
        {shot("repayment", "A monthly repayment being placed into an envelope beside a calendar", 1254, 1254)}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="grid">
      <article class="card" id="weekly">
        <p class="eyebrow">Ongoing campaign</p>
        <h2 style="font-size:1.7rem">$5 every Erev Shabbat</h2>
        <p class="muted">A standing weekly gift given before Shabbat. Small on its own; together it keeps the fund ready.</p>
        <a class="btn btn--ghost" href="/donate/?amount=5&amp;frequency=weekly" style="margin-top:4px">Set it up</a>
      </article>
      <article class="card">
        <p class="eyebrow">No processing cut</p>
        <h2 style="font-size:1.7rem">Give by Zelle</h2>
        <p class="muted">Open your banking app, choose Send with Zelle, and send to:</p>
        <p class="note"><span data-zu="{ZELLE_USER}" data-zh="{ZELLE_HOST}">Loading&hellip;</span></p>
        <button class="btn btn--ghost" type="button" id="copy-zelle" style="margin-top:4px">Copy address</button>
      </article>
    </div>
  </section>

  <section class="section">
    <div class="split">
      <div class="stack">
        <p class="eyebrow">Already giving?</p>
        <h2>Manage it yourself,<br>any time.</h2>
        <p class="muted">Update your card, change your amount, or stop a recurring gift from the donor portal.</p>
      </div>
      <div>
        <a class="btn btn--solid" href="https://checkout.sbfloan.com/p/login/00gcQA4d89WUfjq7ss" target="_blank" rel="noopener">Open donor portal</a>
      </div>
    </div>
  </section>
</div>"""
    page("/donate/", f"Donate to the {ORG} — 501(c)(3)",
         "Give any amount, once a week or once a month. Tax-deductible donations that go straight back out to families in Baltimore.",
         body, active="/donate/")


def build_apply():
    def opts(items):
        return "".join(f'<option>{i}</option>' for i in items)

    def field(fid, label, kind="text", req=True, span=False, **attrs):
        extra = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
        star = ' <span class="req">*</span>' if req else ""
        return (f'<div{" class=\"span2\"" if span else ""}>'
                f'<label class="field" for="{fid}">{label}{star}</label>'
                f'<input class="input" id="{fid}" name="{fid}" type="{kind}"'
                f'{" required" if req else ""} {extra}></div>')

    def select(fid, label, items, req=True, span=False):
        star = ' <span class="req">*</span>' if req else ""
        return (f'<div{" class=\"span2\"" if span else ""}>'
                f'<label class="field" for="{fid}">{label}{star}</label>'
                f'<select class="select" id="{fid}" name="{fid}"{" required" if req else ""}>'
                f'<option value="">Choose one</option>{opts(items)}</select></div>')

    def area(fid, label, ph, maxlen, req=True, wrapper="", cls=""):
        star = ' <span class="req">*</span>' if req else ""
        return (f'<div class="span2"{wrapper}>'
                f'<label class="field" for="{fid}">{label}{star}</label>'
                f'<textarea class="textarea{cls}" id="{fid}" name="{fid}"{" required" if req else ""} '
                f'maxlength="{maxlen}" placeholder="{ph}"></textarea></div>')

    nexts = [("We read it", "It goes to the people who review it, and is treated with discretion."),
             ("We reach out", "Someone from the fund contacts you to understand what would genuinely help."),
             ("We agree terms", "If we can help, we agree repayment together. We will say so straight away if we cannot.")]
    nextlist = "".join(
        f'<li style="display:flex;gap:14px;padding:13px 0;{"" if i == 2 else "border-bottom:1px solid var(--line)"}">'
        f'<span class="pip pip--sm">{i+1}</span><span><strong style="display:block">{t}</strong>'
        f'<span class="muted" style="font-size:.9rem">{c}</span></span></li>'
        for i, (t, c) in enumerate(nexts))
    nevers = ["Your Social Security number", "Bank logins or account numbers",
              "Documents uploaded through this form"]
    neverlist = "".join(
        f'<li style="display:flex;gap:11px;padding:7px 0"><span style="color:var(--acc);flex-shrink:0">{icon("cross", 17)}</span>'
        f'<span class="muted" style="font-size:.9rem">{n}</span></li>' for n in nevers)

    body = f"""<div class="wrap">
  <section class="hero reveal">
    <div class="logomark" style="margin-bottom:6px"><img src="/assets/img/logo.png" width="80" height="80" alt=""></div>
    <p class="pillbadge">Interest-free loan program</p>
    <h1>Tell us what<br>you need.</h1>
    <p class="lede">One form, reviewed by people from this community. You do not need to be a member anywhere, know anyone, or be owed a favor.</p>
  </section>

  <section class="section">
    <div class="applygrid">
      <form class="formcard" id="apply-form" novalidate>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="legend"><span class="pip">1</span><h3>Applicant information</h3></legend>
          <div class="fields">
            {field("name", "Full name", span=True, autocomplete="name", maxlength="120", placeholder="First and last name")}
            {field("dob", "Date of birth", kind="date", autocomplete="bday")}
            {field("phone", "Phone number", kind="tel", autocomplete="tel", maxlength="40", placeholder="(410) 000-0000")}
            {field("email", "Email address", kind="email", span=True, autocomplete="email", maxlength="254", placeholder="you@example.com")}
            {area("address", "Home address", "Street, city, state and ZIP", 300, cls=" textarea--short")}
            {select("marital", "Marital status", ["Single", "Married", "Divorced", "Widowed"])}
            {field("dependents", "Number of dependents", kind="number", min="0", max="20", inputmode="numeric", placeholder="0")}
          </div>
        </fieldset>

        <fieldset style="border:0;padding:0;margin:0">
          <legend class="legend"><span class="pip">2</span><h3>Loan request</h3></legend>
          <div class="fields">
            {field("amount", "Loan amount requested", inputmode="decimal", maxlength="20", placeholder="$ 0.00")}
            {field("neededBy", "Date funds are needed by", kind="date")}
            {area("purpose", "Purpose of the loan", "What the money is for, and anything about the situation you want us to know. There is no wrong way to write this.", 1500)}
          </div>
        </fieldset>

        <fieldset style="border:0;padding:0;margin:0">
          <legend class="legend"><span class="pip">3</span><h3>Repayment</h3></legend>
          <div class="fields">
            {field("monthlyRepay", "How much can you afford to repay monthly?", inputmode="decimal", maxlength="20", placeholder="$ 0.00")}
            {select("guarantors", "Can you provide guarantors?", ["Yes, I can provide two guarantors", "Yes, I can provide one guarantor", "No, I cannot provide any guarantors"])}
          </div>
        </fieldset>

        <fieldset style="border:0;padding:0;margin:0">
          <legend class="legend"><span class="pip">4</span><h3>General eligibility</h3></legend>
          <div class="fields">
            {select("overdue", "Do you have overdue bills or missed payments?", ["Yes", "No"])}
            {select("bankruptcy", "Have you ever filed for bankruptcy?", ["Yes", "No"])}
            {area("overdueDetail", "If yes, please explain", "A sentence or two is fine.", 1000, req=False, wrapper=' id="overdue-detail" hidden')}
          </div>
        </fieldset>

        <fieldset style="border:0;padding:0;margin:0">
          <legend class="legend"><span class="pip">5</span><h3>Final questions</h3></legend>
          <div class="fields">
            {select("openToContact", "Are you open to us contacting you to discuss your application?", ["Yes", "No"], span=True)}
          </div>
        </fieldset>

        <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>

        <label class="check" for="declaration">
          <input id="declaration" name="declaration" type="checkbox" required>
          <span class="muted">I declare that the information provided is true and complete. <span class="req">*</span></span>
        </label>

        <div style="margin-top:18px">
          <label class="field" for="signature">Signature <span class="req">*</span></label>
          <input class="input" id="signature" name="signature" required maxlength="120"
                 autocomplete="off" placeholder="Type your full name">
          <p class="small" style="margin-top:8px">Typing your name here counts as your signature. Today's date is recorded automatically.</p>
        </div>

        <div class="cf-turnstile" data-sitekey="{TURNSTILE_SITEKEY}" data-theme="dark" style="margin-top:18px"></div>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:24px">
          <button class="btn btn--solid" type="submit" id="apply-go">Submit application</button>
        </div>
        <p class="status" id="apply-status" role="status" aria-live="polite" hidden></p>
      </form>

      <aside style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><h3>What happens next</h3><ul>{nextlist}</ul></div>
        <div class="card"><h3>What we never ask for</h3><ul>{neverlist}</ul>
          <p class="small" style="padding-top:12px;border-top:1px solid var(--line)">We will never ask for these &mdash; not by email, text, or phone.</p></div>
        <div class="card"><h3>Not sure if you qualify?</h3>
          <p class="muted">There is no qualifying, and no threshold to clear. If money is the problem, ask &mdash; the worst outcome is that we say we cannot help this time.</p></div>
      </aside>
    </div>
  </section>
</div>"""
    page("/apply/", f"Apply for an Interest-Free Loan — {ORG}",
         "One confidential form. No membership required, no affiliation needed. Interest-free loans for families in Baltimore.",
         body, active="/apply/")


def build_thanks():
    body = f"""<div class="wrap">
  <section class="hero reveal" style="min-height:46vh">
    <p class="eyebrow">Thank you</p>
    <h1>Thank you for<br>supporting our community.</h1>
    <p class="lede">Your receipt is on its way by email. Every dollar goes back out to a family here in Baltimore.</p>
    <div class="btnrow">
      <a class="btn btn--solid" href="/">Back to the fund</a>
      <a class="btn btn--ghost" href="https://checkout.sbfloan.com/p/login/00gcQA4d89WUfjq7ss" target="_blank" rel="noopener">Manage your giving</a>
    </div>
  </section>
</div>"""
    page("/donate/thank-you/", f"Thank You — {ORG}",
         "Thank you for supporting the Sepharadic Baltimore Fund.", body, active="/donate/")


# --------------------------------------------------------------- non-HTML ----
def build_meta():
    urls = ["/", "/about/", "/donate/", "/apply/"]
    entries = "".join(
        f"\n  <url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod>"
        f"<changefreq>monthly</changefreq><priority>{'1.0' if u == '/' else '0.8'}</priority></url>"
        for u in urls)
    (OUT / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}\n</urlset>\n')

    (OUT / "robots.txt").write_text(
        "User-agent: *\nAllow: /\n\n"
        "# Answer engines are welcome — being findable is the point.\n"
        f"Sitemap: {SITE}/sitemap.xml\n")

    (OUT / "llms.txt").write_text(f"""# {ORG}

> A community fund in Baltimore, Maryland providing emergency loans and support
> to families. Independent of any shul or political group. Registered 501(c)(3).

## What it is

The {ORG} (SBF) gives emergency financial help to families in the Baltimore
Sephardic community. Decisions are made on the need of the person asking and
nothing else — there is no membership, no affiliation requirement, and no
political consideration.

## What it helps with

Rent and mortgage, a bar or bat mitzvah, a wedding, finding a job, credit card
debt, and anything else. There is no threshold to clear.

## How to get help

Apply at {SITE}/apply/ — one form, reviewed by people from the community, treated
with discretion. SBF never asks for a Social Security number, bank logins, or
account numbers.

## How to give

Donate at {SITE}/donate/ — any amount, one time or recurring weekly or monthly.
Card payments are processed by Stripe; Zelle is also accepted. Contributions are
tax-deductible to the extent allowed by law.

## Pages

- {SITE}/ — home
- {SITE}/about/ — about the fund, how it works, common questions
- {SITE}/donate/ — donate
- {SITE}/apply/ — apply for help
""")

    # Old WordPress URLs -> new routes. Preserves whatever link equity exists.
    (OUT / "_redirects").write_text(
        "/make-a-donation/*     /donate/            301\n"
        "/zelle-instructions/*  /donate/            301\n"
        "/donation-successful/* /donate/thank-you/  301\n"
        "/contact/*             /apply/             301\n"
        "/home-3/*              /                   301\n")

    (OUT / "_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://i.ytimg.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'

/api/*
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable
""")
    print("  sitemap.xml, robots.txt, llms.txt, _redirects, _headers")


if __name__ == "__main__":
    print("building sbfloan.com")
    ASSETS["css"] = fingerprint("assets/css/site.css")
    ASSETS["js"] = fingerprint("assets/js/site.js")
    print(f"  {ASSETS['css']}\n  {ASSETS['js']}")
    build_home(); build_about(); build_donate(); build_apply(); build_thanks()
    build_meta()
    print("done")
