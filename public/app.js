/* ═══════════════════════════════════════════════════════════════════════════
   Aluminum Price Tracker — Client-Side Application
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ──────────────────────────────────────────────────────────────────
let eventSource = null;
let priceHistory = [];
let refreshCountdown = 0;
let countdownInterval = null;
let currentInterval = 60;
let isRefreshing = false;

// ─── DOM Elements ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Initialization ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connectSSE();
  loadHistory();
  setupScheduleControl();
});

// ─── SSE Connection ─────────────────────────────────────────────────────────
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  setConnectionStatus('connecting');

  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    console.log('[SSE] Connected');
    setConnectionStatus('connected');
    showToast('Connected to price feed', 'success');
  };

  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      switch (payload.type) {
        case 'price_update':
          updatePriceCards(payload.data);
          addToHistory(payload.data);
          startCountdown(currentInterval);
          break;
        case 'schedule_update':
          currentInterval = payload.data.interval;
          $('scheduleSelect').value = String(currentInterval);
          startCountdown(currentInterval);
          break;
        case 'connected':
          currentInterval = payload.data.interval;
          $('scheduleSelect').value = String(currentInterval);
          startCountdown(currentInterval);
          break;
        case 'error':
          showToast(`Error: ${payload.data.message}`, 'error');
          break;
      }
    } catch (e) {
      console.error('[SSE] Parse error:', e);
    }
  };

  eventSource.onerror = () => {
    console.warn('[SSE] Connection lost, reconnecting...');
    setConnectionStatus('disconnected');
    // EventSource auto-reconnects
  };
}

// ─── Connection Status ──────────────────────────────────────────────────────
function setConnectionStatus(status) {
  const badge = $('connectionBadge');
  const text = $('connectionText');

  badge.className = 'live-badge';

  switch (status) {
    case 'connected':
      badge.classList.add('connected');
      text.textContent = 'Live';
      break;
    case 'disconnected':
      badge.classList.add('disconnected');
      text.textContent = 'Reconnecting...';
      break;
    case 'connecting':
      text.textContent = 'Connecting...';
      break;
  }
}

// ─── Price Card Updates ─────────────────────────────────────────────────────
function updatePriceCards(data) {
  if (!data) return;

  // --- UAE ---
  updateCard('uae', {
    priceLocal: data.uae.priceLocal,
    priceUSD: data.uae.priceUSD,
    exchangeRate: data.uae.exchangeRate,
    change: data.uae.change,
    changePercent: data.uae.changePercent,
    currencySymbol: data.uae.currencySymbol || 'د.إ',
    currency: data.uae.currency || 'AED',
    timestamp: data.timestamp
  });

  // --- Saudi ---
  updateCard('saudi', {
    priceLocal: data.saudi.priceLocal,
    priceUSD: data.saudi.priceUSD,
    exchangeRate: data.saudi.exchangeRate,
    change: data.saudi.change,
    changePercent: data.saudi.changePercent,
    currencySymbol: data.saudi.currencySymbol || 'ر.س',
    currency: data.saudi.currency || 'SAR',
    timestamp: data.timestamp
  });

  // Reset refresh button
  setRefreshingState(false);
}

function updateCard(country, info) {
  const prefix = country === 'uae' ? 'uae' : 'saudi';
  const cardId = country === 'uae' ? 'cardUAE' : 'cardSaudi';

  // Price values
  const priceLocalEl = $(`${prefix}PriceLocal`);
  priceLocalEl.textContent = `${info.currencySymbol} ${formatNumber(info.priceLocal)}`;
  priceLocalEl.classList.add('price-updating');
  setTimeout(() => priceLocalEl.classList.remove('price-updating'), 500);

  $(`${prefix}PriceUSD`).textContent = `$${formatNumber(info.priceUSD)}`;
  $(`${prefix}ExchangeRate`).textContent = `1 USD = ${info.exchangeRate} ${info.currency}`;

  // Change indicator
  const changeEl = $(`${prefix}Change`);
  const arrowEl = $(`${prefix}Arrow`);
  const changeTextEl = $(`${prefix}ChangeText`);
  const change = parseFloat(info.changePercent);

  changeEl.className = 'price-change';
  if (change > 0) {
    changeEl.classList.add('up');
    arrowEl.textContent = '▲';
    changeTextEl.textContent = `+${info.changePercent}%`;
  } else if (change < 0) {
    changeEl.classList.add('down');
    arrowEl.textContent = '▼';
    changeTextEl.textContent = `${info.changePercent}%`;
  } else {
    changeEl.classList.add('neutral');
    arrowEl.textContent = '—';
    changeTextEl.textContent = '0.000%';
  }

  // Updated time
  const time = new Date(info.timestamp);
  $(`${prefix}Updated`).textContent = `Updated: ${time.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  })}`;

  // Flash effect
  const card = $(cardId);
  card.classList.remove('flash');
  void card.offsetWidth; // trigger reflow
  card.classList.add('flash');
}

// ─── History ────────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=50');
    const json = await res.json();
    if (json.status === 'ok' && json.data.length > 0) {
      priceHistory = json.data;
      renderHistoryTable();
      renderChart();
    }
  } catch (e) {
    console.warn('Failed to load history:', e);
  }
}

function addToHistory(data) {
  priceHistory.push({
    timestamp: data.timestamp,
    uae: {
      priceLocal: data.uae.priceLocal,
      priceUSD: data.uae.priceUSD,
      exchangeRate: data.uae.exchangeRate
    },
    saudi: {
      priceLocal: data.saudi.priceLocal,
      priceUSD: data.saudi.priceUSD,
      exchangeRate: data.saudi.exchangeRate
    }
  });

  // Keep last 50 in the table
  if (priceHistory.length > 50) {
    priceHistory = priceHistory.slice(-50);
  }

  renderHistoryTable();
  renderChart();
}

function renderHistoryTable() {
  const tbody = $('historyBody');
  $('historyCount').textContent = `${priceHistory.length} records`;

  if (priceHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No records yet</td></tr>`;
    return;
  }

  // Render in reverse order (newest first)
  const rows = [...priceHistory].reverse().map(entry => {
    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true
    });

    return `<tr>
      <td class="timestamp-col">${timeStr}</td>
      <td class="uae-col">${formatNumber(entry.uae.priceLocal)}</td>
      <td>$${formatNumber(entry.uae.priceUSD)}</td>
      <td>${entry.uae.exchangeRate}</td>
      <td class="saudi-col">${formatNumber(entry.saudi.priceLocal)}</td>
      <td>$${formatNumber(entry.saudi.priceUSD)}</td>
      <td>${entry.saudi.exchangeRate}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

// ─── Chart Rendering (Canvas) ───────────────────────────────────────────────
function renderChart() {
  const canvas = $('priceChart');
  const ctx = canvas.getContext('2d');
  const container = canvas.parentElement;

  // Set canvas size to match container
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.width = container.clientWidth + 'px';
  canvas.style.height = container.clientHeight + 'px';
  ctx.scale(dpr, dpr);

  const w = container.clientWidth;
  const h = container.clientHeight;

  // Clear
  ctx.clearRect(0, 0, w, h);

  if (priceHistory.length < 2) {
    // Draw empty state
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Chart will appear after 2+ data points', w / 2, h / 2);
    return;
  }

  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  // Data
  const uaeData = priceHistory.map(e => e.uae.priceLocal);
  const saudiData = priceHistory.map(e => e.saudi.priceLocal);
  const allValues = [...uaeData, ...saudiData].filter(v => v > 0);

  if (allValues.length === 0) return;

  const minVal = Math.min(...allValues) * 0.998;
  const maxVal = Math.max(...allValues) * 1.002;
  const range = maxVal - minVal || 1;

  // Helper to map value to Y
  const yMap = (val) => padding.top + chartH - ((val - minVal) / range) * chartH;
  const xMap = (i) => padding.left + (i / (priceHistory.length - 1)) * chartW;

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (i / gridLines) * chartH;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();

    // Y-axis labels
    const val = maxVal - (i / gridLines) * range;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(formatNumber(val), padding.left - 8, y + 3);
  }

  // Draw X-axis labels (timestamps)
  const labelCount = Math.min(priceHistory.length, 6);
  ctx.fillStyle = '#64748b';
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.floor(i / (labelCount - 1) * (priceHistory.length - 1));
    const time = new Date(priceHistory[idx].timestamp);
    const label = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillText(label, xMap(idx), h - 8);
  }

  // Draw UAE line (with gradient fill)
  drawLine(ctx, uaeData, xMap, yMap, '#c084fc', 'rgba(192, 132, 252, 0.08)', chartH, padding);

  // Draw Saudi line (with gradient fill)
  drawLine(ctx, saudiData, xMap, yMap, '#34d399', 'rgba(52, 211, 153, 0.08)', chartH, padding);

  // Draw dots at the latest points
  if (uaeData.length > 0) {
    const lastI = uaeData.length - 1;
    if (uaeData[lastI] > 0) {
      drawDot(ctx, xMap(lastI), yMap(uaeData[lastI]), '#c084fc');
    }
  }
  if (saudiData.length > 0) {
    const lastI = saudiData.length - 1;
    if (saudiData[lastI] > 0) {
      drawDot(ctx, xMap(lastI), yMap(saudiData[lastI]), '#34d399');
    }
  }
}

function drawLine(ctx, data, xMap, yMap, strokeColor, fillColor, chartH, padding) {
  if (data.length < 2) return;

  // Find first valid index
  let firstValid = data.findIndex(v => v > 0);
  if (firstValid === -1) return;

  // Draw fill
  ctx.beginPath();
  ctx.moveTo(xMap(firstValid), padding.top + chartH);
  ctx.lineTo(xMap(firstValid), yMap(data[firstValid]));

  for (let i = firstValid + 1; i < data.length; i++) {
    if (data[i] > 0) {
      ctx.lineTo(xMap(i), yMap(data[i]));
    }
  }

  // Find last valid
  let lastValid = firstValid;
  for (let i = data.length - 1; i >= firstValid; i--) {
    if (data[i] > 0) { lastValid = i; break; }
  }

  ctx.lineTo(xMap(lastValid), padding.top + chartH);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
  gradient.addColorStop(0, fillColor);
  gradient.addColorStop(1, 'transparent');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw stroke
  ctx.beginPath();
  ctx.moveTo(xMap(firstValid), yMap(data[firstValid]));

  for (let i = firstValid + 1; i < data.length; i++) {
    if (data[i] > 0) {
      ctx.lineTo(xMap(i), yMap(data[i]));
    }
  }

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawDot(ctx, x, y, color) {
  // Outer glow
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color + '33';
  ctx.fill();

  // Inner dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // White center
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// Redraw chart on resize
window.addEventListener('resize', () => {
  clearTimeout(window._chartResizeTimer);
  window._chartResizeTimer = setTimeout(renderChart, 200);
});

// ─── Schedule Control ───────────────────────────────────────────────────────
function setupScheduleControl() {
  $('scheduleSelect').addEventListener('change', async (e) => {
    const interval = parseInt(e.target.value);
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval })
      });
      const json = await res.json();
      if (json.status === 'ok') {
        currentInterval = json.interval;
        startCountdown(currentInterval);
        showToast(`Schedule updated: every ${formatInterval(currentInterval)}`, 'info');
      }
    } catch (e) {
      showToast('Failed to update schedule', 'error');
    }
  });
}

// ─── Manual Refresh ─────────────────────────────────────────────────────────
async function manualRefresh() {
  if (isRefreshing) return;
  setRefreshingState(true);

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const json = await res.json();
    if (json.status === 'ok') {
      showToast('Prices refreshed successfully', 'success');
    } else {
      showToast(`Refresh failed: ${json.message}`, 'error');
    }
  } catch (e) {
    showToast('Failed to refresh prices', 'error');
  }

  setRefreshingState(false);
}

function setRefreshingState(loading) {
  isRefreshing = loading;
  const btn = $('refreshBtn');
  const btnText = $('refreshBtnText');

  if (loading) {
    btn.disabled = true;
    btnText.innerHTML = '<span class="spinner"></span> Fetching...';
  } else {
    btn.disabled = false;
    btnText.textContent = 'Refresh Now';
  }
}

// ─── CSV Download ───────────────────────────────────────────────────────────
function downloadCSV() {
  window.open('/api/download-csv', '_blank');
}

// ─── Countdown Timer ────────────────────────────────────────────────────────
function startCountdown(seconds) {
  refreshCountdown = seconds;
  if (countdownInterval) clearInterval(countdownInterval);

  updateCountdownDisplay();

  countdownInterval = setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
      refreshCountdown = currentInterval;
    }
    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay() {
  const el = $('nextRefreshTimer');
  if (!el) return;

  if (refreshCountdown <= 0) {
    el.textContent = 'Refreshing...';
  } else {
    const min = Math.floor(refreshCountdown / 60);
    const sec = refreshCountdown % 60;
    el.textContent = `Next refresh: ${min > 0 ? min + 'm ' : ''}${sec}s`;
  }
}

// ─── Toast Notifications ────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;

  // Show
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-hide after 3 seconds
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ─── Utility Functions ──────────────────────────────────────────────────────
function formatNumber(num) {
  if (!num && num !== 0) return '—';
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatInterval(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}
