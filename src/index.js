require('dotenv').config();
const express = require('express');
const { runPipeline } = require('./pipeline');
const { seedDemoData } = require('./confidenceCalibration');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: 'text/plain', limit: '2mb' }));

// Seed plausible historical reliability data so the demo doesn't start cold.
seedDemoData();

function checkSecret(req, res, next) {
  const provided = req.headers['x-webhook-secret'];
  if (process.env.WEBHOOK_SECRET && provided !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }
  next();
}

// Generic webhook: point your Vercel/Railway deploy-hook (or a log-tailing
// script) at POST /webhook/deploy-log with the raw log text as the body,
// or { "log": "..." } as JSON.
app.post('/webhook/deploy-log', checkSecret, async (req, res) => {
  const rawLog = typeof req.body === 'string' ? req.body : req.body.log;
  if (!rawLog) return res.status(400).json({ error: 'missing log payload' });

  // Respond immediately; run the pipeline async so the webhook doesn't time out.
  res.status(202).json({ status: 'accepted' });

  try {
    const result = await runPipeline(rawLog, { testCommand: req.body.testCommand });
    console.log('[pipeline] result:', result.status, result.errorClass);
  } catch (err) {
    console.error('[pipeline] error:', err);
  }
});

// Manual trigger for demo purposes: paste a log directly.
app.post('/demo/trigger', async (req, res) => {
  try {
    const result = await runPipeline(req.body.log, { testCommand: req.body.testCommand });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FIXORA listening on port ${PORT}`);
});
