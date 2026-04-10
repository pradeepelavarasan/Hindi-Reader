const express = require('express');
const router  = express.Router();
const storage = require('../storage');

const ADMIN_KEY = process.env.ADMIN_KEY;

router.get('/stats', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).send('Unauthorized');
  }

  const scans = await storage.listAllScans();

  // ---- Per-device aggregation (table) --------------------------------
  const devices = {};
  for (const scan of scans) {
    const id = scan.deviceId || 'unknown';
    if (!devices[id]) {
      devices[id] = { pages: 0, words: 0, lines: 0, lastScan: scan.createdAt };
    }
    devices[id].pages++;
    devices[id].words += scan.wordCount || 0;
    devices[id].lines += scan.lineCount || 0;
    if (scan.createdAt > devices[id].lastScan) {
      devices[id].lastScan = scan.createdAt;
    }
  }

  const rows = Object.entries(devices).sort((a, b) => b[1].pages - a[1].pages);
  const totalPages = rows.reduce((s, [, d]) => s + d.pages, 0);
  const totalWords = rows.reduce((s, [, d]) => s + d.words, 0);
  const totalLines = rows.reduce((s, [, d]) => s + d.lines, 0);

  // ---- 30-day chart data ---------------------------------------------
  const today = new Date();
  const days  = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const dayMap = {};
  for (const day of days) dayMap[day] = { scans: 0, users: new Set() };

  for (const scan of scans) {
    const day = (scan.createdAt || '').slice(0, 10);
    if (dayMap[day]) {
      dayMap[day].scans++;
      dayMap[day].users.add(scan.deviceId || 'unknown');
    }
  }

  const chartData = days.map(day => ({
    date:  day,
    label: new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    scans: dayMap[day].scans,
    users: dayMap[day].users.size
  }));

  const maxVal = Math.max(...chartData.map(d => Math.max(d.scans, d.users)), 1);

  const chartBars = chartData.map(d => {
    const scanH = Math.round((d.scans / maxVal) * 100);
    const userH = Math.round((d.users / maxVal) * 100);
    const isWeekend = [0, 6].includes(new Date(d.date + 'T00:00:00').getDay());
    return `
    <div class="bar-group${isWeekend ? ' weekend' : ''}">
      <div class="bar-wrap">
        <div class="bar bar-scans" style="height:${scanH}%" title="${d.scans} pages"></div>
        <div class="bar bar-users" style="height:${userH}%" title="${d.users} users"></div>
      </div>
      <div class="bar-label">${d.label}</div>
    </div>`;
  }).join('');

  const tableRows = rows.map(([id, d], i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="id">${id.slice(0, 8)}…</td>
      <td>${d.pages}</td>
      <td>${d.words}</td>
      <td>${d.lines}</td>
      <td>${new Date(d.lastScan).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hindi Reader — Usage Stats</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; color: #1a1a1a; }
    .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 22px; margin: 0; }
    .generated { color: #aaa; font-size: 12px; text-align: right; }

    .summary { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .card { background: white; border-radius: 12px; padding: 16px 24px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); min-width: 120px; }
    .card-val { font-size: 28px; font-weight: 700; color: #d4500a; }
    .card-label { font-size: 13px; color: #777; margin-top: 2px; }

    .chart-box { background: white; border-radius: 12px; padding: 20px 20px 12px; box-shadow: 0 1px 6px rgba(0,0,0,0.08); margin-bottom: 24px; }
    .chart-title { font-size: 14px; font-weight: 600; color: #555; margin-bottom: 16px; display: flex; align-items: center; gap: 16px; }
    .legend { display: flex; gap: 12px; }
    .legend-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #777; font-weight: 400; }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
    .legend-dot.scans { background: #d4500a; }
    .legend-dot.users { background: #f39c12; }

    .chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; overflow-x: auto; padding-bottom: 4px; }
    .bar-group { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 22px; flex: 1; }
    .bar-group.weekend .bar-label { color: #bbb; }
    .bar-wrap { display: flex; align-items: flex-end; gap: 2px; height: 100px; width: 100%; justify-content: center; }
    .bar { width: 8px; border-radius: 3px 3px 0 0; min-height: 2px; transition: opacity 0.15s; }
    .bar:hover { opacity: 0.75; }
    .bar-scans { background: #d4500a; }
    .bar-users { background: #f39c12; }
    .bar-label { font-size: 9px; color: #999; white-space: nowrap; transform: rotate(-45deg); transform-origin: top center; margin-top: 6px; }

    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,0.08); }
    th { background: #d4500a; color: white; padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 600; }
    td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fff8f5; }
    .tfoot td { font-weight: 700; background: #fef3ed; color: #d4500a; }
    .id { font-family: monospace; font-size: 13px; color: #555; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Hindi Reader — Usage Stats</h1>
    <div class="generated">Generated ${new Date().toLocaleString('en-IN')}</div>
  </div>

  <div class="summary">
    <div class="card"><div class="card-val">${rows.length}</div><div class="card-label">Unique Devices</div></div>
    <div class="card"><div class="card-val">${totalPages}</div><div class="card-label">Pages Scanned</div></div>
    <div class="card"><div class="card-val">${totalWords}</div><div class="card-label">Words Translated</div></div>
    <div class="card"><div class="card-val">${totalLines}</div><div class="card-label">Lines Translated</div></div>
  </div>

  <div class="chart-box">
    <div class="chart-title">
      Last 30 Days
      <div class="legend">
        <div class="legend-item"><div class="legend-dot scans"></div> Pages scanned</div>
        <div class="legend-item"><div class="legend-dot users"></div> Unique users</div>
      </div>
    </div>
    <div class="chart">${chartBars}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Device ID</th>
        <th>Pages Scanned</th>
        <th>Words Translated</th>
        <th>Lines Translated</th>
        <th>Last Scan</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr class="tfoot">
        <td colspan="2">Total</td>
        <td>${totalPages}</td>
        <td>${totalWords}</td>
        <td>${totalLines}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`);
});

module.exports = router;
