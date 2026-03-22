'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const PORT = 0; // auto-assign

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

function startServer() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost`);
            let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
            if (filePath.endsWith('/')) filePath += 'index.html';

            const ext = path.extname(filePath);
            const mime = MIME[ext] || 'application/octet-stream';

            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': mime });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

// Scenarios to run — each returns a config object
const SCENARIOS = [
    {
        name: 'Default speed, positive answer',
        morph: 1500, roll: 1500, answerIndex: 0, expand: true,
    },
    {
        name: 'Default speed, negative answer (count=3)',
        morph: 1500, roll: 1500, answerIndex: 1, expand: true,
    },
    {
        name: 'Fast morph',
        morph: 300, roll: null, answerIndex: 0, expand: true,
    },
    {
        name: 'Slow morph',
        morph: 3000, roll: 3000, answerIndex: 0, expand: true,
    },
    {
        name: 'Multiple sequential answers',
        morph: 600, roll: null, answerIndex: 0, expand: true, repeat: 3,
    },
    {
        name: 'Reset then answer',
        morph: 1500, roll: 1500, answerIndex: 0, expand: true, resetFirst: true,
    },
    {
        name: 'Compact mode',
        morph: 1500, roll: 1500, answerIndex: 0, expand: false,
    },
];

async function runScenario(page, baseUrl, scenario) {
    await page.goto(baseUrl + '/timeline-animation-test.html');
    await page.waitForSelector('.question-card');

    // Enable recording via the toggle (the polling loop handles start/stop)
    await page.evaluate(() => {
        document.getElementById('recordToggle').checked = true;
    });

    // Configure morph speed
    await page.evaluate((ms) => window.animator.setMorphDuration(ms), scenario.morph);
    if (scenario.roll !== null && scenario.roll !== undefined) {
        await page.evaluate((ms) => window.animator.setRollDuration(ms), scenario.roll);
    }

    // Toggle expand/compact
    if (!scenario.expand) {
        await page.evaluate(() => {
            document.getElementById('timeline').classList.add('timeline-light');
        });
    }

    // Pre-fill some answers if resetFirst is set
    if (scenario.resetFirst) {
        await page.click('.answer-card:first-child');
        const maxWaitPre = (scenario.morph || 1500) * 2 + 3000;
        await page.waitForFunction(() => !window.animator.isAnimating(), { timeout: maxWaitPre });
        await page.waitForTimeout(150);

        await page.evaluate(() => {
            counter = 0;
            window.animator.reset();
            window.__recorder.clearTraces();
            window.__lastTrace = null;
        });
        await page.waitForTimeout(200);
    }

    const iterations = scenario.repeat || 1;
    const traces = [];

    for (let iter = 0; iter < iterations; iter++) {
        // Clear previous trace before each iteration
        await page.evaluate(() => { window.__lastTrace = null; });

        const selector = scenario.answerIndex === 0
            ? '.answer-card:first-child'
            : '.answer-card:last-child';
        await page.click(selector);

        const maxWait = (scenario.morph || 1500) + (scenario.roll || scenario.morph || 1500) + 3000;
        await page.waitForFunction(() => window.__lastTrace !== null, { timeout: maxWait });

        const trace = await page.evaluate(() => window.__lastTrace);
        traces.push(trace);

        // Brief pause between iterations
        if (iter < iterations - 1) await page.waitForTimeout(200);
    }

    // Run validator on each trace
    const validatorResults = await page.evaluate((tracesJSON) => {
        const v = new AnimationValidator();
        return tracesJSON.map(t => v.validate(t, document.getElementById('app')));
    }, traces);

    return { traces, validatorResults };
}

function printResults(scenario, validatorResults, index) {
    const allPass = validatorResults.every(r => r.pass);
    const prefix = allPass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${prefix}  ${index + 1}. ${scenario.name}`);

    for (let t = 0; t < validatorResults.length; t++) {
        const result = validatorResults[t];
        if (validatorResults.length > 1) {
            console.log(`       Iteration ${t + 1}:`);
        }
        for (const r of result.results) {
            if (!r.pass) {
                const count = r.violations.length;
                console.log(`         \x1b[31m\u2717\x1b[0m ${r.rule}: ${count} violation(s)`);
                for (const v of r.violations.slice(0, 3)) {
                    console.log(`           f${v.frame || '?'} ${v.element || ''}${v.index !== undefined ? '[' + v.index + ']' : ''}: ${v.detail}`);
                }
                if (count > 3) {
                    console.log(`           ... and ${count - 3} more`);
                }
            }
        }
    }
}

async function main() {
    console.log('\nAnimation Validator — Playwright Test Runner\n');

    const { server, port } = await startServer();
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`  Static server on ${baseUrl}\n`);

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (e) {
        console.error('Could not launch browser. Run: npx playwright install chromium');
        server.close();
        process.exit(2);
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let totalPass = 0;
    let totalFail = 0;

    for (let i = 0; i < SCENARIOS.length; i++) {
        const scenario = SCENARIOS[i];
        const page = await context.newPage();
        try {
            const { validatorResults } = await runScenario(page, baseUrl, scenario);
            printResults(scenario, validatorResults, i);
            if (validatorResults.every(r => r.pass)) totalPass++;
            else totalFail++;
        } catch (err) {
            console.log(`  \x1b[31mERROR\x1b[0m  ${i + 1}. ${scenario.name}: ${err.message}`);
            totalFail++;
        }
        await page.close();
    }

    console.log(`\n  ${totalPass + totalFail} scenarios: ${totalPass} passed, ${totalFail} failed\n`);

    await browser.close();
    server.close();
    process.exit(totalFail > 0 ? 1 : 0);
}

main();
