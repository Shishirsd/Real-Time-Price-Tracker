const express = require('express');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ─── State ──────────────────────────────────────────────────────────────────
let currentPrices = null;
let priceHistory = [];
let refreshInterval = 60; // seconds
let intervalTimer = null;
let sseClients = [];

const CSV_PATH = path.join(__dirname, 'price_history.csv');
const CSV_HEADER = 'timestamp,uae_price_aed,uae_price_usd,uae_exchange_rate,saudi_price_sar,saudi_price_usd,saudi_exchange_rate\n';

// ─── URL Targets ────────────────────────────────────────────────────────────
const URLS = {
  uae: 'https://livemetalprice.com/aluminum-price/uae',
  saudi: 'https://livemetalprice.com/aluminum-price/saudi-arabia'
};

// ─── CSV Setup ──────────────────────────────────────────────────────────────
function initCSV() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, CSV_HEADER, 'utf-8');
  }
}

function appendCSV(data) {
  const line = [
    data.timestamp,
    data.uae.priceLocal,
    data.uae.priceUSD,
    data.uae.exchangeRate,
    data.saudi.priceLocal,
    data.saudi.priceUSD,
    data.saudi.exchangeRate
  ].join(',') + '\n';
  fs.appendFileSync(CSV_PATH, line, 'utf-8');
}

function loadHistoryFromCSV() {
  if (!fs.existsSync(CSV_PATH)) return [];
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // skip header
  return lines.map(line => {
    const parts = line.split(',');
    return {
      timestamp: parts[0],
      uae: {
        priceLocal: parseFloat(parts[1]) || 0,
        priceUSD: parseFloat(parts[2]) || 0,
        exchangeRate: parseFloat(parts[3]) || 0
      },
      saudi: {
        priceLocal: parseFloat(parts[4]) || 0,
        priceUSD: parseFloat(parts[5]) || 0,
        exchangeRate: parseFloat(parts[6]) || 0
      }
    };
  }).filter(entry => entry.timestamp);
}

// ─── Scraper ────────────────────────────────────────────────────────────────
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.text();
}

function extractPriceFromHTML(html, country) {
  const $ = cheerio.load(html);
  const result = {
    country: country,
    priceLocal: 0,
    priceUSD: 0,
    exchangeRate: 0,
    currency: '',
    currencySymbol: '',
    lastUpdated: ''
  };

  // Method 1: Extract from JSON-LD structured data (most reliable)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const jsonData = JSON.parse($(el).text());
      const graph = jsonData['@graph'] || [jsonData];
      for (const item of graph) {
        if (item['@type'] === 'Product' && item.offers) {
          result.priceLocal = parseFloat(item.offers.price) || 0;
          result.currency = item.offers.priceCurrency || '';
        }
      }
    } catch (e) { /* skip malformed JSON-LD */ }
  });

  // Method 2: Extract from meta description as fallback
  if (result.priceLocal === 0) {
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const priceMatch = metaDesc.match(/([\d,]+\.?\d*)\s*per\s*unit/i);
    if (priceMatch) {
      result.priceLocal = parseFloat(priceMatch[1].replace(/,/g, '')) || 0;
    }
    const currMatch = metaDesc.match(/\((\w+)\)/);
    if (currMatch) result.currency = currMatch[1];
  }

  // Extract USD price from the page content (strip HTML comments first)
  const bodyText = $.html().replace(/<!--.*?-->/g, '');
  
  // Look for USD price in the page structure
  const usdPriceMatch = bodyText.match(/Price\s*\(USD\).*?\$\s*([\d,]+\.?\d*)/s);
  if (usdPriceMatch) {
    result.priceUSD = parseFloat(usdPriceMatch[1].replace(/,/g, '')) || 0;
  }

  // Look for exchange rate
  const exchangeMatch = bodyText.match(/1\s*USD\s*=\s*([\d.]+)/);
  if (exchangeMatch) {
    result.exchangeRate = parseFloat(exchangeMatch[1]) || 0;
  }

  // Derive USD price from local price and exchange rate if not found
  if (result.priceUSD === 0 && result.priceLocal > 0 && result.exchangeRate > 0) {
    result.priceUSD = parseFloat((result.priceLocal / result.exchangeRate).toFixed(2));
  }

  // Derive exchange rate if not found
  if (result.exchangeRate === 0 && result.priceLocal > 0 && result.priceUSD > 0) {
    result.exchangeRate = parseFloat((result.priceLocal / result.priceUSD).toFixed(4));
  }

  // Set currency info
  if (country === 'uae') {
    result.currency = result.currency || 'AED';
    result.currencySymbol = 'د.إ';
  } else {
    result.currency = result.currency || 'SAR';
    result.currencySymbol = 'ر.س';
  }

  // Extract last updated from page
  const updatedMatch = bodyText.match(/Last updated:\s*<!--.*?-->(.*?)(?:<|$)/s);
  if (updatedMatch) {
    result.lastUpdated = updatedMatch[1].replace(/<!--.*?-->/g, '').trim();
  }

  return result;
}

async function fetchAllPrices() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Fetching aluminum prices...`);

  try {
    const [uaeHtml, saudiHtml] = await Promise.all([
      fetchPage(URLS.uae),
      fetchPage(URLS.saudi)
    ]);

    const uae = extractPriceFromHTML(uaeHtml, 'uae');
    const saudi = extractPriceFromHTML(saudiHtml, 'saudi');

    const previousPrices = currentPrices;

    currentPrices = {
      timestamp,
      fetchedAt: new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }),
      uae: {
        ...uae,
        change: previousPrices ? (uae.priceLocal - previousPrices.uae.priceLocal) : 0,
        changePercent: previousPrices && previousPrices.uae.priceLocal > 0
          ? (((uae.priceLocal - previousPrices.uae.priceLocal) / previousPrices.uae.priceLocal) * 100).toFixed(3)
          : '0.000'
      },
      saudi: {
        ...saudi,
        change: previousPrices ? (saudi.priceLocal - previousPrices.saudi.priceLocal) : 0,
        changePercent: previousPrices && previousPrices.saudi.priceLocal > 0
          ? (((saudi.priceLocal - previousPrices.saudi.priceLocal) / previousPrices.saudi.priceLocal) * 100).toFixed(3)
          : '0.000'
      },
      refreshInterval
    };

    // Log to CSV
    appendCSV({
      timestamp,
      uae: { priceLocal: uae.priceLocal, priceUSD: uae.priceUSD, exchangeRate: uae.exchangeRate },
      saudi: { priceLocal: saudi.priceLocal, priceUSD: saudi.priceUSD, exchangeRate: saudi.exchangeRate }
    });

    // Add to in-memory history (keep last 200)
    priceHistory.push({
      timestamp,
      uae: { priceLocal: uae.priceLocal, priceUSD: uae.priceUSD, exchangeRate: uae.exchangeRate },
      saudi: { priceLocal: saudi.priceLocal, priceUSD: saudi.priceUSD, exchangeRate: saudi.exchangeRate }
    });
    if (priceHistory.length > 200) priceHistory = priceHistory.slice(-200);

    // Broadcast to SSE clients
    broadcastSSE({ type: 'price_update', data: currentPrices });

    console.log(`  ✅ UAE: ${uae.currencySymbol}${uae.priceLocal.toLocaleString()} | Saudi: ${saudi.currencySymbol}${saudi.priceLocal.toLocaleString()}`);
    return currentPrices;
  } catch (error) {
    console.error(`  ❌ Fetch error:`, error.message);
    broadcastSSE({ type: 'error', data: { message: error.message, timestamp } });
    throw error;
  }
}

// ─── SSE (Server-Sent Events) ───────────────────────────────────────────────
function broadcastSSE(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients = sseClients.filter(client => {
    try {
      client.write(data);
      return true;
    } catch {
      return false;
    }
  });
}

// ─── Scheduling ─────────────────────────────────────────────────────────────
function startScheduler() {
  stopScheduler();
  console.log(`⏱️  Auto-refresh every ${refreshInterval} seconds`);
  intervalTimer = setInterval(() => fetchAllPrices().catch(() => {}), refreshInterval * 1000);
  broadcastSSE({ type: 'schedule_update', data: { interval: refreshInterval } });
}

function stopScheduler() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────────────────────────

// GET current prices
app.get('/api/prices', (req, res) => {
  if (!currentPrices) {
    return res.json({ status: 'loading', message: 'Prices not yet fetched. Please wait...' });
  }
  res.json({ status: 'ok', data: currentPrices });
});

// GET price history
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = priceHistory.slice(-limit);
  res.json({ status: 'ok', data: history, total: priceHistory.length });
});

// POST manual refresh
app.post('/api/refresh', async (req, res) => {
  try {
    const prices = await fetchAllPrices();
    res.json({ status: 'ok', data: prices });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// POST update schedule
app.post('/api/schedule', (req, res) => {
  const { interval } = req.body;
  const validIntervals = [30, 60, 120, 300, 600, 900, 1800, 3600];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({
      status: 'error',
      message: `Invalid interval. Valid values: ${validIntervals.join(', ')} seconds`
    });
  }
  refreshInterval = interval;
  startScheduler();
  console.log(`⏱️  Schedule updated to every ${interval} seconds`);
  res.json({ status: 'ok', interval: refreshInterval });
});

// GET current schedule
app.get('/api/schedule', (req, res) => {
  res.json({ status: 'ok', interval: refreshInterval });
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial data
  if (currentPrices) {
    res.write(`data: ${JSON.stringify({ type: 'price_update', data: currentPrices })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'connected', data: { interval: refreshInterval } })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Download CSV
app.get('/api/download-csv', (req, res) => {
  if (!fs.existsSync(CSV_PATH)) {
    return res.status(404).json({ status: 'error', message: 'No price history yet' });
  }
  res.download(CSV_PATH, 'aluminum_price_history.csv');
});

// ─── Start ──────────────────────────────────────────────────────────────────
initCSV();

// Load existing history
priceHistory = loadHistoryFromCSV();
console.log(`📂 Loaded ${priceHistory.length} historical records from CSV`);

app.listen(PORT, async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   🏭  Aluminum Price Tracker — Live Dashboard           ║');
  console.log('║                                                          ║');
  console.log(`║   🌐  http://localhost:${PORT}                            ║`);
  console.log('║                                                          ║');
  console.log('║   📊  Tracking: UAE (AED) & Saudi Arabia (SAR)           ║');
  console.log(`║   ⏱️   Refresh: every ${String(refreshInterval).padEnd(4)} seconds                     ║`);
  console.log('║                                                          ║');
  console.log('║   Press Ctrl+C to stop                                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Initial fetch
  try {
    await fetchAllPrices();
  } catch (err) {
    console.error('Initial fetch failed, will retry on schedule:', err.message);
  }

  startScheduler();
});
