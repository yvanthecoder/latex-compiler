const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post('/compile', (req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const latex = Buffer.concat(chunks).toString('utf8');

    if (!latex.trim()) {
      return res.status(400).json({ error: 'Empty LaTeX source' });
    }

    const id = crypto.randomUUID();
    const dir = path.join('/tmp', id);

    try {
      fs.mkdirSync(dir);
      const texFile = path.join(dir, 'doc.tex');
      fs.writeFileSync(texFile, latex, 'utf8');

      execSync(
        `pdflatex -interaction=nonstopmode -output-directory="${dir}" "${texFile}"`,
        { timeout: 30000 }
      );

      const pdfPath = path.join(dir, 'doc.pdf');
      if (!fs.existsSync(pdfPath)) {
        throw new Error('PDF not generated');
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="cv.pdf"');
      res.send(fs.readFileSync(pdfPath));
    } catch (err) {
      const logPath = path.join(dir, 'doc.log');
      const log = fs.existsSync(logPath)
        ? fs.readFileSync(logPath, 'utf8').slice(-3000)
        : err.message;
      console.error('[compile error]', log);
      res.status(500).json({ error: 'Compilation failed', log });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LaTeX compiler ready on :${PORT}`));
