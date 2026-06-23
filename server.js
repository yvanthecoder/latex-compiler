const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();

// Single persistent browser instance — launched once, reused for every request
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    headless: true,
    timeout: 60000,
  });
  browserInstance.on('disconnected', () => {
    console.log('[browser] disconnected — will relaunch on next request');
    browserInstance = null;
  });
  console.log('[browser] launched');
  return browserInstance;
}

// Pre-warm: launch browser at server start so the first request is instant
getBrowser()
  .then(() => console.log('[browser] ready'))
  .catch(err => console.error('[browser] pre-warm failed:', err.message));

app.get('/health', (_, res) => res.json({ status: 'ok', browser: !!browserInstance && browserInstance.isConnected() }));

app.post('/compile', (req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    let page;
    try {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return res.status(400).json({ error: 'Empty body' });

      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      let cv;
      try {
        cv = JSON.parse(cleaned);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON', detail: e.message, preview: raw.slice(0, 200) });
      }

      if (!cv.name) return res.status(400).json({ error: 'Missing cv.name' });

      const html = buildHtml(cv);
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: false,
        margin: { top: '1.15cm', bottom: '1.15cm', left: '1.15cm', right: '1.15cm' },
      });

      await page.close();
      page = null;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="cv.pdf"');
      res.send(Buffer.from(pdf));
    } catch (err) {
      console.error('[compile error]', err.message);
      if (page) { try { await page.close(); } catch (_) {} }
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });
  req.on('error', () => {
    if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
  });
});

function e(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildHtml(cv) {
  const { name = '', title = '', contact = {}, skills = [], experience = [], education = [], projects = [], certifications = [] } = cv;

  const contactParts = [contact.phone, contact.email, contact.location].filter(Boolean).map(e);
  const contactLine = contactParts.join(' &nbsp;|&nbsp; ');

  const linkParts = [];
  if (contact.linkedin) linkParts.push(`<a href="${e(contact.linkedin)}">LinkedIn</a>`);
  if (contact.github) linkParts.push(`<a href="${e(contact.github)}">GitHub</a>`);
  if (contact.portfolio) linkParts.push(`<a href="${e(contact.portfolio)}">Portfolio</a>`);
  const linksLine = linkParts.join(' &nbsp;|&nbsp; ');

  const skillsHtml = skills.map(s =>
    `<div class="sk"><span class="sk-label">${e(s.label)} :</span> ${e(s.value)}</div>`
  ).join('');

  const expHtml = experience.map(ex => `
<div class="exp">
  <div class="row-sb"><span class="bold">${e(ex.title)}</span><span class="italic">${e(ex.company)}${ex.location ? ', ' + e(ex.location) : ''}</span></div>
  <div class="italic small">${e(ex.period)}</div>
  ${ex.bullets && ex.bullets.length ? `<ul>${ex.bullets.map(b => `<li>${e(b)}</li>`).join('')}</ul>` : ''}
</div>`).join('');

  const eduHtml = education.map(ed => `
<div class="edu">
  <div class="row-sb"><span class="bold">${e(ed.degree)}</span><span class="italic">${e(ed.location)}${ed.period ? ' ' + e(ed.period) : ''}</span></div>
  ${ed.description ? `<div class="justify small">${e(ed.description)}</div>` : ''}
</div>`).join('');

  const projHtml = projects.map(p => `
<div class="proj">
  <div class="bold">${e(p.title)}</div>
  ${p.stack ? `<div class="italic small">Stack : ${e(p.stack)}</div>` : ''}
  ${p.bullets && p.bullets.length ? `<ul>${p.bullets.map(b => `<li>${e(b)}</li>`).join('')}</ul>` : ''}
</div>`).join('');

  const certHtml = certifications.length
    ? `<ul>${certifications.map(c => `<li>${e(c)}</li>`).join('')}</ul>`
    : '';

  const section = (title, content) => content ? `
<div class="section">
  <div class="section-title">${title}</div>
  ${content}
</div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Liberation Serif', 'Times New Roman', Georgia, serif;
  font-size: 10pt;
  line-height: 1.35;
  color: #000;
  background: #fff;
}
a { color: #000; text-decoration: none; }

.header { text-align: center; margin-bottom: 5px; }
.header-name { font-size: 17pt; font-weight: bold; letter-spacing: 0.5px; }
.header-title { font-size: 11pt; margin-top: 2px; }
.header-contact { margin-top: 3px; font-size: 9.5pt; }
.header-links { margin-top: 1px; font-size: 9.5pt; }

.section { margin-top: 7px; }
.section-title {
  font-size: 11pt;
  font-weight: bold;
  border-bottom: 0.7px solid #000;
  padding-bottom: 1px;
  margin-bottom: 4px;
}

.sk { margin-bottom: 2px; font-size: 9.8pt; }
.sk-label { font-weight: bold; }

.exp { margin-bottom: 5px; }
.edu { margin-bottom: 4px; }
.proj { margin-bottom: 4px; }

.row-sb { display: flex; justify-content: space-between; align-items: baseline; }

ul { margin-left: 14px; margin-top: 2px; }
li { margin-bottom: 1px; font-size: 9.8pt; text-align: justify; }

.bold { font-weight: bold; }
.italic { font-style: italic; }
.small { font-size: 9.5pt; }
.justify { text-align: justify; }
</style>
</head>
<body>
<div class="header">
  <div class="header-name">${e(name)}</div>
  ${title ? `<div class="header-title">${e(title)}</div>` : ''}
  ${contactLine ? `<div class="header-contact">${contactLine}</div>` : ''}
  ${linksLine ? `<div class="header-links">${linksLine}</div>` : ''}
</div>
${section('Compétences', skillsHtml)}
${section('Expérience professionnelle', expHtml)}
${section('Formation', eduHtml)}
${section('Projets personnels', projHtml)}
${section('Certifications et réalisations', certHtml)}
</body>
</html>`;
}

process.on('uncaughtException', err => console.error('[uncaughtException]', err.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CV PDF compiler ready on :${PORT}`));
