const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://es92.github.io/Singularity-Map/';
const SHARE_DIR = path.join(__dirname, 'share');
const IMG_DIR = path.join(SHARE_DIR, 'images');

const outcomes = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'outcomes.json'), 'utf8'));

function buildCards() {
    const cards = [];
    for (const t of outcomes.templates) {
        if (t.variants) {
            for (const [vKey, v] of Object.entries(t.variants)) {
                cards.push({
                    slug: `${t.id}--${vKey}`,
                    templateId: t.id,
                    variantKey: vKey,
                    title: t.title,
                    subtitle: v.subtitle,
                    mood: v.mood,
                    summary: v.summary,
                });
            }
        } else {
            cards.push({
                slug: t.id,
                templateId: t.id,
                variantKey: null,
                title: t.title,
                subtitle: t.subtitle || null,
                mood: t.mood,
                summary: t.summary,
            });
        }
    }
    return cards;
}

function cardHtml(card) {
    const moodColors = {
        utopian:  { color: '#00e088', bg: 'rgba(0,224,136,0.12)',  border: 'rgba(0,224,136,0.25)',  glow: 'rgba(0,224,136,0.15)' },
        dystopian:{ color: '#ff3366', bg: 'rgba(255,51,102,0.12)', border: 'rgba(255,51,102,0.25)', glow: 'rgba(255,51,102,0.15)' },
        mixed:    { color: '#ffaa22', bg: 'rgba(255,170,34,0.12)', border: 'rgba(255,170,34,0.25)', glow: 'rgba(255,170,34,0.12)' },
        stagnant: { color: '#7888aa', bg: 'rgba(120,136,170,0.12)',border: 'rgba(120,136,170,0.25)',glow: 'rgba(120,136,170,0.12)' },
        chaotic:  { color: '#aa44ff', bg: 'rgba(170,68,255,0.12)', border: 'rgba(170,68,255,0.25)', glow: 'rgba(170,68,255,0.15)' },
        catastrophic: { color: '#cc2244', bg: 'rgba(204,34,68,0.15)', border: 'rgba(204,34,68,0.3)', glow: 'rgba(204,34,68,0.2)' },
    };
    const m = moodColors[card.mood] || moodColors.mixed;

    const moodBgMap = {
        utopian:   `radial-gradient(ellipse at 50% 0%, rgba(0,224,136,0.15) 0%, rgba(0,224,136,0.03) 60%, transparent 100%)`,
        dystopian: `radial-gradient(ellipse at 50% 0%, rgba(255,51,102,0.15) 0%, rgba(255,51,102,0.03) 60%, transparent 100%)`,
        mixed:     `radial-gradient(ellipse at 30% 0%, rgba(255,170,34,0.12) 0%, transparent 50%), radial-gradient(ellipse at 70% 0%, rgba(0,200,255,0.08) 0%, transparent 50%)`,
        stagnant:  `radial-gradient(ellipse at 50% 0%, rgba(120,136,170,0.12) 0%, rgba(120,136,170,0.03) 60%, transparent 100%)`,
        chaotic:   `radial-gradient(ellipse at 40% 0%, rgba(170,68,255,0.15) 0%, transparent 50%), radial-gradient(ellipse at 60% 100%, rgba(255,51,102,0.08) 0%, transparent 50%)`,
        catastrophic: `radial-gradient(ellipse at 50% 0%, rgba(204,34,68,0.2) 0%, rgba(204,34,68,0.05) 60%, transparent 100%)`,
    };
    const heroGradient = moodBgMap[card.mood] || moodBgMap.mixed;

    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
    background:#08080f;
    color:#e4e4f0;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
    line-height:1.6;
    width:1200px;height:630px;
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
    -webkit-font-smoothing:antialiased;
}
.card{
    width:1200px;height:630px;
    display:flex;align-items:center;justify-content:center;
    text-align:center;
    padding:1.5rem 2.5rem;
    background:${heroGradient};
    border:1px solid ${m.border};
    border-radius:12px;
    position:relative;
}
.inner{max-width:1000px;margin:0 auto}
.title{
    font-size:3.5rem;font-weight:700;
    letter-spacing:-0.03em;line-height:1.1;
    margin-bottom:0.5rem;color:#e4e4f0;
}
.subtitle{
    font-size:1.5rem;font-weight:400;
    font-style:italic;margin-bottom:0.85rem;opacity:0.8;color:#e4e4f0;
}
.mood-badge{
    display:inline-block;
    padding:0.22rem 0.7rem;border-radius:20px;
    font-size:0.75rem;font-weight:600;
    text-transform:uppercase;letter-spacing:0.06em;
    background:${m.bg};color:${m.color};border:1px solid ${m.border};
    margin-bottom:1.25rem;
}
.summary{
    font-size:1.3rem;line-height:1.65;
    color:#9898b0;
}
</style></head>
<body>
<div class="card"><div class="inner">
    <h1 class="title">${esc(card.title)}</h1>
    ${card.subtitle ? `<div class="subtitle">${esc(card.subtitle)}</div>` : ''}
    <span class="mood-badge">${esc(card.mood)}</span>
    <div class="summary">${esc(card.summary)}</div>
</div></div>
</body></html>`;
}

function sharePageHtml(card) {
    const imgUrl = `${BASE_URL}share/images/${card.slug}.png`;
    const desc = card.subtitle
        ? `${card.title}: ${card.subtitle} — ${card.summary}`
        : `${card.title} — ${card.summary}`;
    const truncDesc = desc.length > 200 ? desc.slice(0, 197) + '...' : desc;
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const displayTitle = card.subtitle ? `${card.title}: ${card.subtitle}` : card.title;

    const moodColors = {
        utopian:      { color: '#00e088', bg: 'rgba(0,224,136,0.12)',  border: 'rgba(0,224,136,0.25)' },
        dystopian:    { color: '#ff3366', bg: 'rgba(255,51,102,0.12)', border: 'rgba(255,51,102,0.25)' },
        mixed:        { color: '#ffaa22', bg: 'rgba(255,170,34,0.12)', border: 'rgba(255,170,34,0.25)' },
        stagnant:     { color: '#7888aa', bg: 'rgba(120,136,170,0.12)',border: 'rgba(120,136,170,0.25)' },
        chaotic:      { color: '#aa44ff', bg: 'rgba(170,68,255,0.12)', border: 'rgba(170,68,255,0.25)' },
        catastrophic: { color: '#cc2244', bg: 'rgba(204,34,68,0.15)',  border: 'rgba(204,34,68,0.3)' },
    };
    const m = moodColors[card.mood] || moodColors.mixed;

    const moodBgMap = {
        utopian:      `radial-gradient(ellipse at 50% 0%, rgba(0,224,136,0.15) 0%, rgba(0,224,136,0.03) 60%, transparent 100%)`,
        dystopian:    `radial-gradient(ellipse at 50% 0%, rgba(255,51,102,0.15) 0%, rgba(255,51,102,0.03) 60%, transparent 100%)`,
        mixed:        `radial-gradient(ellipse at 30% 0%, rgba(255,170,34,0.12) 0%, transparent 50%), radial-gradient(ellipse at 70% 0%, rgba(0,200,255,0.08) 0%, transparent 50%)`,
        stagnant:     `radial-gradient(ellipse at 50% 0%, rgba(120,136,170,0.12) 0%, rgba(120,136,170,0.03) 60%, transparent 100%)`,
        chaotic:      `radial-gradient(ellipse at 40% 0%, rgba(170,68,255,0.15) 0%, transparent 50%), radial-gradient(ellipse at 60% 100%, rgba(255,51,102,0.08) 0%, transparent 50%)`,
        catastrophic: `radial-gradient(ellipse at 50% 0%, rgba(204,34,68,0.2) 0%, rgba(204,34,68,0.05) 60%, transparent 100%)`,
    };
    const heroGradient = moodBgMap[card.mood] || moodBgMap.mixed;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(displayTitle)} — Singularity Possibilities Map</title>
    <meta name="description" content="${esc(truncDesc)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${BASE_URL}share/${card.slug}.html">
    <meta property="og:title" content="Singularity Possibilities Map: See what your AI future could be">
    <meta property="og:description" content="I got: ${esc(displayTitle)}">
    <meta property="og:image" content="${imgUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Singularity Possibilities Map: See what your AI future could be">
    <meta name="twitter:description" content="I got: ${esc(displayTitle)}">
    <meta name="twitter:image" content="${imgUrl}">
    <style>
        :root{
            --bg:#08080f;
            --text:#e4e4f0;
            --text-secondary:#9898b0;
            --text-dim:#7888aa;
            --accent:#00c8ff;
            --accent-2:#7c5cff;
            --accent-glow:rgba(0,200,255,0.15);
            --border:#222238;
            --border-hover:#3a3a58;
            --bg-card:#1a1a2c;
            --bg-card-hover:#22223a;
            --mood-dystopian:#ff3366;
            --ease:cubic-bezier(0.4,0,0.2,1);
        }
        [data-theme="light"]{
            --bg:#f6f6fb;
            --text:#1a1a2e;
            --text-secondary:#4e4e6a;
            --text-dim:#8888a4;
            --accent:#0090cc;
            --accent-2:#6a48e0;
            --accent-glow:rgba(0,144,204,0.08);
            --border:#d4d4e4;
            --border-hover:#b0b0c8;
            --bg-card:#ffffff;
            --bg-card-hover:#f0f0f8;
            --mood-dystopian:#d42050;
        }
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{
            background:var(--bg);
            color:var(--text);
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
            line-height:1.6;
            min-height:100vh;
            display:flex;flex-direction:column;align-items:center;
            padding:3rem 1.5rem;
            -webkit-font-smoothing:antialiased;
        }
        .theme-toggle{
            position:fixed;top:1rem;right:1rem;
            width:36px;height:36px;border-radius:50%;
            background:var(--bg-card);border:1px solid var(--border);
            color:var(--text-secondary);cursor:pointer;
            display:flex;align-items:center;justify-content:center;
            font-size:1.05rem;z-index:50;
            transition:all 0.2s var(--ease);
        }
        .theme-toggle:hover{
            border-color:var(--border-hover);color:var(--text);
            background:var(--bg-card-hover);
        }
        .wrap{width:100%;max-width:720px;text-align:center}
        .lead{
            font-size:0.8rem;font-weight:600;
            text-transform:uppercase;letter-spacing:0.12em;
            color:var(--text-dim);margin-bottom:1.25rem;
        }
        .card{
            padding:2.5rem 2rem;
            background:${heroGradient};
            border:1px solid ${m.border};
            border-radius:12px;
            margin-bottom:2rem;
        }
        .title{
            font-size:2.75rem;font-weight:700;
            letter-spacing:-0.03em;line-height:1.1;
            margin-bottom:0.5rem;
        }
        .subtitle{
            font-size:1.2rem;font-weight:400;
            font-style:italic;margin-bottom:1rem;opacity:0.8;
        }
        .mood-badge{
            display:inline-block;
            padding:0.22rem 0.7rem;border-radius:20px;
            font-size:0.72rem;font-weight:600;
            text-transform:uppercase;letter-spacing:0.06em;
            background:${m.bg};color:${m.color};border:1px solid ${m.border};
            margin-bottom:1.25rem;
        }
        .summary{
            font-size:1.05rem;line-height:1.65;
            color:var(--text-secondary);
        }
        .cta{
            display:inline-block;
            padding:0.9rem 1.75rem;
            font-size:1rem;font-weight:600;
            color:var(--bg);background:var(--accent);
            border-radius:8px;text-decoration:none;
            transition:transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cta:hover{transform:translateY(-1px);box-shadow:0 6px 20px var(--accent-glow)}
        .tagline{
            margin-top:1rem;
            font-size:0.9rem;color:var(--text-dim);
        }
        /* Personalized timeline (injected by share-vignettes.js when query params present) */
        #personalized-timeline:empty{display:none}
        .share-vignette-intro{
            max-width:640px;margin:2.5rem auto 0.75rem;
            font-size:0.9rem;color:var(--text-secondary);text-align:left;
        }
        .share-vignette-intro strong{color:var(--text);font-weight:600}
        .outcome-timeline{max-width:640px;margin:0.5rem auto 2rem;text-align:left}
        .timeline{position:relative;padding-left:2.5rem;display:flow-root}
        .timeline-event{position:relative;padding-top:1.2rem}
        .tl-dot{
            position:absolute;
            left:calc(-2.5rem + 3px);top:0.55rem;
            width:10px;height:10px;border-radius:50%;
            background:var(--accent);
            box-shadow:0 0 8px var(--accent-glow);
            border:2px solid var(--bg);z-index:1;
        }
        .tl-vline-seg{
            position:absolute;
            left:calc(-2.5rem + 7px);width:2px;
            background:linear-gradient(to bottom,var(--accent),var(--accent-2));
            opacity:0.3;border-radius:1px;pointer-events:none;
        }
        .tl-hline{
            position:absolute;
            left:-1.85rem;top:calc(0.55rem + 4px);
            right:0;height:1px;
            background:var(--border);opacity:0.6;z-index:-1;
        }
        .timeline-top-row{
            display:grid;grid-template-columns:1fr auto;
            gap:0 0.5rem;align-items:center;margin-bottom:0.35rem;
        }
        .timeline-year{
            font-size:0.8rem;font-weight:700;
            letter-spacing:0.04em;white-space:nowrap;
        }
        .timeline-desc{color:var(--text-secondary);font-size:0.88rem;line-height:1.6}
        .timeline-desc > :first-child{margin-top:0}
        .timeline-desc > :last-child{margin-bottom:0}
        .timeline-desc p{margin:0.6em 0}
        .timeline-desc strong{font-weight:600;color:var(--text)}
        .timeline-desc em{font-style:italic}
        .world-vignette-heading,.personal-vignette-heading{
            font-size:0.82rem;font-weight:600;
        }
        .heading-world,.heading-world .timeline-year{color:var(--text-secondary)}
        .heading-personal,.heading-personal .timeline-year{color:var(--text)}
        .heading-professional,.heading-professional .timeline-year{color:var(--accent-2)}
        .heading-death,.heading-death .timeline-year{color:var(--mood-dystopian)}
        .dot-world{background:var(--text-secondary) !important;box-shadow:none !important}
        .dot-personal{background:var(--accent) !important;box-shadow:0 0 8px var(--accent-glow) !important}
        .dot-professional{background:var(--accent-2) !important;box-shadow:0 0 8px rgba(124,92,255,0.3) !important}
        .dot-death{background:var(--mood-dystopian) !important;box-shadow:0 0 8px rgba(255,51,102,0.3) !important}
        @media (max-width:560px){
            .title{font-size:2rem}
            .subtitle{font-size:1.05rem}
            .card{padding:1.75rem 1.25rem}
            .theme-toggle{top:0.5rem}
        }
    </style>
</head>
<body>
    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle light/dark mode">&#9790;</button>
    <div class="wrap">
        <div class="lead">I got</div>
        <div class="card">
            <h1 class="title">${esc(card.title)}</h1>
            ${card.subtitle ? `<div class="subtitle">${esc(card.subtitle)}</div>` : ''}
            <span class="mood-badge">${esc(card.mood)}</span>
            <div class="summary">${esc(card.summary)}</div>
        </div>
        <div id="personalized-timeline"></div>
        <a class="cta" href="${BASE_URL}">Explore your own &rarr;</a>
        <div class="tagline">Singularity Possibilities Map &mdash; explore possible AI futures</div>
    </div>
    <script>
    (function() {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || (!saved && window.matchMedia('(prefers-color-scheme: light)').matches)) document.documentElement.setAttribute('data-theme', 'light');
        const btn = document.getElementById('theme-toggle');
        function updateIcon() {
            btn.innerHTML = document.documentElement.getAttribute('data-theme') === 'light' ? '&#9728;' : '&#9790;';
        }
        updateIcon();
        btn.addEventListener('click', function() {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            if (isLight) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('theme', 'dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
            }
            updateIcon();
        });
    })();
    </script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="../graph.js"></script>
    <script src="../engine.js"></script>
    <script src="share-vignettes.js"></script>
</body>
</html>`;
}

// ──────────────────────────────────────────────────────────────────────
// Root-level og-image.png — the social card for the homepage itself.
// Renders a branching-tree SVG (echoing the favicon / brand motif) with
// the brand title and tagline overlaid. Deterministic: no RNG, so a
// re-run on the same code produces a byte-stable image.
// ──────────────────────────────────────────────────────────────────────
function ogImageHtml({ title = 'Singularity Possibilities Map',
                       subtitle = 'Choose your own adventure through the future of AI.' } = {}) {
    const W = 1200, H = 630;
    const origin = { x: 100, y: H / 2 };

    // Recursive binary tree: each node splits into 2 children, dividing
    // its vertical band in half. Five levels gives 32 endpoints — a
    // density that looks busy enough to read as "many futures" without
    // turning into noise.
    const branches = [];   // { x1, y1, x2, y2 }
    const endpoints = [];  // { x, y }
    const DEPTH = 5;
    const TOTAL_X = W - origin.x - 30;
    // Step shrinks per level so later splits cluster toward the right
    // edge — gives the tree a natural "spreading" silhouette.
    const SHRINK = 0.85;
    let stepSum = 0;
    for (let i = 0; i < DEPTH; i++) stepSum += Math.pow(SHRINK, i);
    const X0 = TOTAL_X / stepSum;

    (function build(node, yLo, yHi, depthRem, step) {
        if (depthRem === 0) { endpoints.push(node); return; }
        const yMid = (yLo + yHi) / 2;
        const upY = (yLo + yMid) / 2;
        const dnY = (yMid + yHi) / 2;
        const childX = node.x + step;
        branches.push({ x1: node.x, y1: node.y, x2: childX, y2: upY });
        branches.push({ x1: node.x, y1: node.y, x2: childX, y2: dnY });
        build({ x: childX, y: upY }, yLo, yMid, depthRem - 1, step * SHRINK);
        build({ x: childX, y: dnY }, yMid, yHi, depthRem - 1, step * SHRINK);
    })(origin, 60, H - 60, DEPTH, X0);

    const pathsSvg = branches.map(b => {
        // Smooth horizontal cubic bezier — control points share the
        // endpoint's y so the curve enters/leaves horizontally.
        const dx = b.x2 - b.x1;
        const cp1x = b.x1 + dx * 0.5, cp1y = b.y1;
        const cp2x = b.x2 - dx * 0.5, cp2y = b.y2;
        return `<path d="M${b.x1.toFixed(1)},${b.y1.toFixed(1)} C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${b.x2.toFixed(1)},${b.y2.toFixed(1)}"/>`;
    }).join('\n');

    const dotsSvg = endpoints.map(e =>
        `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="4"/>`
    ).join('\n');

    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body {
    width:${W}px; height:${H}px;
    background:#08080f;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
    -webkit-font-smoothing:antialiased;
    overflow:hidden;
    position:relative;
}
.bg {
    position:absolute; inset:0;
    background:radial-gradient(ellipse at 65% 50%, rgba(0,200,255,0.06) 0%, transparent 60%);
}
svg.tree { position:absolute; inset:0; width:100%; height:100%; }
.branch { fill:none; stroke:url(#branch-gradient); stroke-width:1.6; stroke-linecap:round; opacity:0.85; }
.endpoint { fill:#ff9933; }
.title-wrap {
    position:absolute; left:0; right:0;
    top:50%; transform:translateY(-50%);
    text-align:center;
    padding:0 4rem;
    z-index:2;
}
.title {
    font-size:120px; font-weight:700;
    letter-spacing:-0.035em; line-height:1.0;
    color:#ffffff;
    text-shadow:0 4px 32px rgba(8,8,15,0.85), 0 1px 8px rgba(8,8,15,0.95);
    margin-bottom:1.2rem;
}
.subtitle {
    font-size:34px; font-weight:400;
    color:#c8c8d8;
    text-shadow:0 2px 12px rgba(8,8,15,0.9);
    letter-spacing:-0.005em;
    opacity:0.92;
}
</style>
</head>
<body>
<div class="bg"></div>
<svg class="tree" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="branch-gradient" gradientUnits="userSpaceOnUse"
                        x1="${origin.x}" y1="0" x2="${W - 30}" y2="0">
            <stop offset="0%"  stop-color="#00c8ff"/>
            <stop offset="55%" stop-color="#7fbfa0"/>
            <stop offset="100%" stop-color="#ffaa22"/>
        </linearGradient>
    </defs>
    <g class="branch">
${pathsSvg}
    </g>
    <g class="endpoint">
${dotsSvg}
    </g>
</svg>
<div class="title-wrap">
    <div class="title">${esc(title)}</div>
    <div class="subtitle">${esc(subtitle)}</div>
</div>
</body>
</html>`;
}

async function renderOgImage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.setContent(ogImageHtml(), { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(__dirname, 'og-image.png'), type: 'png' });
    await page.close();
}

async function main() {
    const htmlOnly = process.argv.includes('--html-only');
    const ogOnly   = process.argv.includes('--og-only');

    fs.mkdirSync(IMG_DIR, { recursive: true });

    if (ogOnly) {
        console.log('Rendering og-image.png...');
        const browser = await puppeteer.launch({ headless: 'new' });
        await renderOgImage(browser);
        await browser.close();
        console.log('  ✓ og-image.png');
        return;
    }

    const cards = buildCards();
    console.log(`Generating ${cards.length} share ${htmlOnly ? 'HTML pages' : 'cards'}...`);

    if (htmlOnly) {
        for (const card of cards) {
            const sharePage = sharePageHtml(card);
            fs.writeFileSync(path.join(SHARE_DIR, `${card.slug}.html`), sharePage);
            console.log(`  ✓ ${card.slug}.html`);
        }
        console.log(`\nDone! Regenerated ${cards.length} HTML pages in share/ (images unchanged).`);
        return;
    }

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

    for (const card of cards) {
        const html = cardHtml(card);
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.screenshot({ path: path.join(IMG_DIR, `${card.slug}.png`), type: 'png' });

        const sharePage = sharePageHtml(card);
        fs.writeFileSync(path.join(SHARE_DIR, `${card.slug}.html`), sharePage);

        console.log(`  ✓ ${card.slug}`);
    }
    await page.close();

    console.log('Rendering og-image.png...');
    await renderOgImage(browser);
    console.log('  ✓ og-image.png');

    await browser.close();
    console.log(`\nDone! Generated ${cards.length} share images + HTML pages + 1 og-image.png`);
}

main().catch(err => { console.error(err); process.exit(1); });
