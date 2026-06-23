const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post('/compile', (req, res) => {
  const chunks = [];

  req.on('error', (err) => {
    console.error('[stream error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
  });

  req.on('data', (chunk) => chunks.push(chunk));

  req.on('end', () => {
    const latex = Buffer.concat(chunks).toString('utf8');

    if (!latex.trim()) {
      return res.status(400).json({ error: 'Empty LaTeX source' });
    }

    const id = crypto.randomUUID();
    const dir = path.join('/tmp', id);

    try {
      fs.mkdirSync(dir);
    } catch (e) {
      return res.status(500).json({ error: 'Cannot create temp dir', message: e.message });
    }

    const texFile = path.join(dir, 'doc.tex');
    try {
      fs.writeFileSync(texFile, latex, 'utf8');
    } catch (e) {
      cleanup(dir);
      return res.status(500).json({ error: 'Cannot write tex file', message: e.message });
    }

    // stdio: 'ignore' prevents pdflatex stdout/stderr from blocking the pipe buffer
    const child = spawn('pdflatex', [
      '-interaction=nonstopmode',
      `-output-directory=${dir}`,
      texFile,
    ], { stdio: 'ignore' });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      cleanup(dir);
      if (!res.headersSent) res.status(504).json({ error: 'Compilation timeout' });
    }, 25000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const pdfPath = path.join(dir, 'doc.pdf');

      if (code === 0 && fs.existsSync(pdfPath)) {
        const pdf = fs.readFileSync(pdfPath);
        cleanup(dir);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="cv.pdf"');
        return res.send(pdf);
      }

      const logPath = path.join(dir, 'doc.log');
      const log = fs.existsSync(logPath)
        ? fs.readFileSync(logPath, 'utf8').slice(-3000)
        : `pdflatex exited with code ${code}`;
      cleanup(dir);
      console.error('[compile error]', log.slice(0, 300));
      if (!res.headersSent) res.status(500).json({ error: 'Compilation failed', log });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanup(dir);
      if (!res.headersSent) res.status(500).json({ error: 'pdflatex not found', message: err.message });
    });
  });
});

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LaTeX compiler ready on :${PORT}`));
