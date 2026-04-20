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
    <title>${esc(displayTitle)} — AI Singularity Map</title>
    <meta name="description" content="${esc(truncDesc)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${BASE_URL}share/${card.slug}.html">
    <meta property="og:title" content="AI Singularity Map: See what your AI future could be">
    <meta property="og:description" content="I got: ${esc(displayTitle)}">
    <meta property="og:image" content="${imgUrl}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="AI Singularity Map: See what your AI future could be">
    <meta name="twitter:description" content="I got: ${esc(displayTitle)}">
    <meta name="twitter:image" content="${imgUrl}">
    <style>
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{
            background:#08080f;
            color:#e4e4f0;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
            line-height:1.6;
            min-height:100vh;
            display:flex;align-items:center;justify-content:center;
            padding:2rem 1.5rem;
            -webkit-font-smoothing:antialiased;
        }
        .wrap{width:100%;max-width:720px;text-align:center}
        .lead{
            font-size:0.8rem;font-weight:600;
            text-transform:uppercase;letter-spacing:0.12em;
            color:#7888aa;margin-bottom:1.25rem;
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
            color:#9898b0;
        }
        .cta{
            display:inline-block;
            padding:0.9rem 1.75rem;
            font-size:1rem;font-weight:600;
            color:#08080f;background:#00c8ff;
            border-radius:8px;text-decoration:none;
            transition:transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cta:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,200,255,0.25)}
        .tagline{
            margin-top:1rem;
            font-size:0.9rem;color:#7888aa;
        }
        @media (max-width:560px){
            .title{font-size:2rem}
            .subtitle{font-size:1.05rem}
            .card{padding:1.75rem 1.25rem}
        }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="lead">I got</div>
        <div class="card">
            <h1 class="title">${esc(card.title)}</h1>
            ${card.subtitle ? `<div class="subtitle">${esc(card.subtitle)}</div>` : ''}
            <span class="mood-badge">${esc(card.mood)}</span>
            <div class="summary">${esc(card.summary)}</div>
        </div>
        <a class="cta" href="${BASE_URL}">Explore your own &rarr;</a>
        <div class="tagline">AI Singularity Map &mdash; explore possible AI futures</div>
    </div>
</body>
</html>`;
}

async function main() {
    const htmlOnly = process.argv.includes('--html-only');

    fs.mkdirSync(IMG_DIR, { recursive: true });

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

    await browser.close();
    console.log(`\nDone! Generated ${cards.length} images + ${cards.length} HTML pages in share/`);
}

main().catch(err => { console.error(err); process.exit(1); });
