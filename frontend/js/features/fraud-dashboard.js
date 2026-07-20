import { api } from '../api.js';
import { store } from '../store.js';
import { escapeHtml, todayLocalStr, skeletonRows } from '../utils/formatters.js';
import { showToast } from '../utils/notifications.js';

let fraudRefreshInterval = null;

const ALERT_STATUSES = ['PENDIENTE', 'REVISADA', 'DESESTIMADA', 'ESCALADA'];
const ALERT_STATUS_LABELS = {
  PENDIENTE: 'Pendiente', REVISADA: 'Revisada', DESESTIMADA: 'Desestimada', ESCALADA: 'Escalada',
};

// ─── Init ────────────────────────────────────────────────────
export function initFraudPanel() {
  const panel = document.getElementById('fraud-panel');
  if (!panel) return;

  // Only show for ADMIN
  if (store.currentUser?.role !== 'ADMIN') {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  // Set date to today
  const picker = document.getElementById('fraud-date-picker');
  if (picker) {
    picker.value = todayLocalStr();
    picker.max = todayLocalStr();
  }

  loadFraudData();
  setupAutoRefresh();
}

// ─── Auto-refresh ────────────────────────────────────────────
function setupAutoRefresh() {
  if (fraudRefreshInterval) clearInterval(fraudRefreshInterval);

  const picker = document.getElementById('fraud-date-picker');
  const today = todayLocalStr();

  if (picker && picker.value === today) {
    fraudRefreshInterval = setInterval(() => loadFraudData(), 60000);
  }
}

export function onFraudDateChange() {
  loadFraudData();
  setupAutoRefresh();
}

export function stopFraudRefresh() {
  if (fraudRefreshInterval) {
    clearInterval(fraudRefreshInterval);
    fraudRefreshInterval = null;
  }
}

// ─── Load all data ───────────────────────────────────────────
async function loadFraudData() {
  const picker = document.getElementById('fraud-date-picker');
  const date = picker?.value || todayLocalStr();

  try {
    const [summary, alerts, evolution, suspicious] = await Promise.all([
      api(`/dashboard/fraud-summary?date=${date}`),
      api(`/dashboard/alerts?date=${date}`),
      api(`/dashboard/gratuitos-evolution?date=${date}`),
      api(`/dashboard/suspicious-operations?date=${date}`)
    ]);

    renderAlerts(alerts);
    renderRiskTable(summary);
    renderCashBalance(summary);
    renderEvolutionChart(evolution);
    renderSuspiciousOps(suspicious);
    loadAlertHistory();
  } catch (err) {
    console.error('Fraud panel error:', err);
    showToast('Error cargando panel anti-fraude', 'error');
  }
}

// ─── A. Alerts ───────────────────────────────────────────────
function renderAlerts(data) {
  const container = document.getElementById('fraud-alerts');
  if (!container) return;

  if (!data.alerts || data.alerts.length === 0) {
    container.innerHTML = `<div class="fraud-empty-msg">✓ Sin alertas activas para esta fecha.</div>`;
    return;
  }

  container.innerHTML = data.alerts.map(a => `
    <div class="alert-card alert-${a.nivel.toLowerCase()}">
      <div class="alert-card-top">
        <span class="alert-badge alert-badge-${a.nivel.toLowerCase()}">${a.nivel}</span>
        <span class="alert-cajero">${escapeHtml(a.cajero_nombre)}</span>
      </div>
      <div class="alert-mensaje">${escapeHtml(a.mensaje)}</div>
      <div class="alert-detalle">${escapeHtml(a.detalle)}</div>
      ${a.db_id ? `<div style="margin-top:.6rem">
        <select class="select-input alert-status-select" data-alert-id="${a.db_id}" style="width:auto;font-size:.75rem;padding:.25rem .5rem">
          ${ALERT_STATUSES.map(s => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${ALERT_STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </div>` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.alert-status-select').forEach((sel) => {
    sel.addEventListener('change', () => handleAlertStatusChange(sel.dataset.alertId, sel.value));
  });
}

// ─── F. Alert History ────────────────────────────────────────
async function handleAlertStatusChange(alertId, status) {
  try {
    await api(`/dashboard/alerts-history/${alertId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast('Estado actualizado', 'success');
    loadAlertHistory();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

export async function loadAlertHistory() {
  const tbody = document.getElementById('alert-history-tbody');
  if (!tbody) return;
  tbody.innerHTML = skeletonRows(6);

  try {
    const status = document.getElementById('alert-history-status')?.value || '';
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('limit', '100');

    const data = await api(`/dashboard/alerts-history?${params.toString()}`);

    if (!data.entries || data.entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin alertas registradas</td></tr>';
      return;
    }

    tbody.innerHTML = data.entries.map(e => `
      <tr>
        <td>${new Date(e.date).toLocaleDateString('es-ES')}</td>
        <td>${escapeHtml(e.cajero_nombre || '—')}</td>
        <td><span class="alert-badge alert-badge-${e.nivel.toLowerCase()}">${e.nivel}</span></td>
        <td>${escapeHtml(e.tipo)}</td>
        <td>${escapeHtml(e.mensaje)}</td>
        <td>
          <select class="select-input alert-status-select" data-alert-id="${e.id}" style="width:auto;font-size:.75rem;padding:.25rem .5rem">
            ${ALERT_STATUSES.map(s => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${ALERT_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('.alert-status-select').forEach((sel) => {
      sel.addEventListener('change', () => handleAlertStatusChange(sel.dataset.alertId, sel.value));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${err.message}</td></tr>`;
  }
}

// ─── B. Risk Table ───────────────────────────────────────────
function renderRiskTable(data) {
  const tbody = document.getElementById('fraud-risk-tbody');
  if (!tbody) return;

  if (!data.cajeros || data.cajeros.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Sin datos para esta fecha</td></tr>';
    return;
  }

  tbody.innerHTML = data.cajeros.map(c => {
    const pctColor = c.pct_gratuitos_hoy > 30 ? 'var(--danger)' : c.pct_gratuitos_hoy > 20 ? 'var(--warning)' : 'var(--success)';
    const diffColor = c.diferencia_pp >= 20 ? 'var(--danger)' : c.diferencia_pp >= 10 ? 'var(--warning)' : 'var(--success)';
    const diffSign = c.diferencia_pp > 0 ? '+' : '';
    const brechaHtml = c.brecha_ingresos === 0
      ? '<span style="color:var(--success)">✓ OK</span>'
      : `<span style="color:var(--danger)">−₲${c.brecha_ingresos.toLocaleString()}</span>`;

    const riskClass = c.nivel_riesgo === 'CRITICO' ? 'risk-critico' : c.nivel_riesgo === 'AVISO' ? 'risk-aviso' : 'risk-normal';

    return `<tr>
      <td><strong>${escapeHtml(c.cajero_nombre)}</strong></td>
      <td>${c.total_adults}</td>
      <td>${c.total_children} / ${c.total_locals}</td>
      <td>
        <div class="risk-pct-bar">
          <div class="risk-pct-fill" style="width:${Math.min(c.pct_gratuitos_hoy, 100)}%;background:${pctColor}"></div>
        </div>
        <span style="color:${pctColor};font-weight:700;font-size:.8rem">${c.pct_gratuitos_hoy}%</span>
      </td>
      <td style="color:var(--text-muted)">${c.historico_pct_gratuitos}%</td>
      <td style="color:${diffColor};font-weight:700">${diffSign}${c.diferencia_pp}pp</td>
      <td>${brechaHtml}</td>
      <td><span class="risk-badge ${riskClass}">${c.nivel_riesgo}</span></td>
    </tr>`;
  }).join('');
}

// ─── C. Cash Balance ─────────────────────────────────────────
function renderCashBalance(data) {
  const container = document.getElementById('fraud-cash-bars');
  const totalEl = document.getElementById('fraud-cash-total');
  if (!container) return;

  if (!data.cajeros || data.cajeros.length === 0) {
    container.innerHTML = '<div class="fraud-empty-msg">Sin datos</div>';
    if (totalEl) totalEl.innerHTML = '';
    return;
  }

  container.innerHTML = data.cajeros.map(c => {
    const pct = c.ingresos_esperados > 0 ? Math.min((c.ingresos_declarados / c.ingresos_esperados) * 100, 100) : 100;
    const barColor = pct >= 100 ? 'var(--success)' : 'var(--danger)';

    return `<div class="cash-bar-row">
      <div class="cash-bar-label">${escapeHtml(c.cajero_nombre)}</div>
      <div class="cash-bar-track">
        <div class="cash-bar-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div class="cash-bar-values">
        <span>₲${c.ingresos_declarados.toLocaleString()} / ₲${c.ingresos_esperados.toLocaleString()}</span>
        ${c.brecha_ingresos > 0 ? `<span class="cash-bar-brecha">−₲${c.brecha_ingresos.toLocaleString()}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  if (totalEl) {
    const t = data.totales;
    if (t.brecha_total === 0) {
      totalEl.innerHTML = '<span class="cash-total-ok">✓ Cuadre correcto</span>';
    } else {
      totalEl.innerHTML = `<span class="cash-total-gap">Brecha total: −₲${t.brecha_total.toLocaleString()}</span>`;
    }
  }
}

// ─── D. Evolution Chart ──────────────────────────────────────
const CHART_COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

function renderEvolutionChart(data) {
  const container = document.getElementById('fraud-evolution-body');
  const legendEl = document.getElementById('fraud-evolution-legend');
  if (!container) return;

  if (!data.series || data.series.length === 0) {
    container.innerHTML = '<div class="fraud-empty-msg">Sin datos para el gráfico</div>';
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  // Find max pct for Y scale
  let maxPct = data.limit_pct + 10;
  for (const s of data.series) {
    for (const d of s.data) {
      if (d.pct_gratuitos > maxPct) maxPct = d.pct_gratuitos + 10;
    }
  }
  maxPct = Math.ceil(maxPct / 10) * 10; // round up to nearest 10

  // Only show blocks with at least one data point
  const allHours = data.series[0]?.data.map(d => d.hora) || [];
  const activeHours = allHours.filter(h => {
    return data.series.some(s => {
      const point = s.data.find(d => d.hora === h);
      return point && point.total > 0;
    });
  });

  if (activeHours.length === 0) {
    container.innerHTML = '<div class="fraud-empty-msg">Sin actividad registrada</div>';
    return;
  }

  const barWidth = Math.max(16, Math.floor(600 / (activeHours.length * data.series.length)));
  const limitPct = data.limit_pct;
  const limitTop = ((maxPct - limitPct) / maxPct) * 100;

  let chartHtml = `<div class="evo-chart" style="position:relative;height:220px;">`;

  // Limit line
  chartHtml += `<div class="evo-limit-line" style="top:${limitTop}%;" title="Límite: ${limitPct}%">
    <span class="evo-limit-label">${limitPct}%</span>
  </div>`;

  // Y axis marks
  chartHtml += `<div class="evo-y-mark" style="bottom:0"><span>0%</span></div>`;
  chartHtml += `<div class="evo-y-mark" style="bottom:${(limitPct / maxPct) * 100}%"><span>${limitPct}%</span></div>`;
  chartHtml += `<div class="evo-y-mark" style="bottom:100%"><span>${maxPct}%</span></div>`;

  // Bars container
  chartHtml += `<div class="evo-bars-container">`;

  for (const hour of activeHours) {
    chartHtml += `<div class="evo-hour-group">`;
    for (let si = 0; si < data.series.length; si++) {
      const s = data.series[si];
      const point = s.data.find(d => d.hora === hour);
      const pct = point ? point.pct_gratuitos : 0;
      const total = point ? point.total : 0;
      const height = (pct / maxPct) * 100;
      const color = CHART_COLORS[si % CHART_COLORS.length];
      const overLimit = pct > limitPct;

      chartHtml += `<div class="evo-bar${overLimit ? ' evo-bar-over' : ''}" 
        style="height:${height}%;background:${color};width:${barWidth}px;" 
        title="${s.cajero_nombre}: ${pct}% (${total} tickets)">
      </div>`;
    }
    chartHtml += `<div class="evo-hour-label">${hour}</div>`;
    chartHtml += `</div>`;
  }

  chartHtml += `</div></div>`;

  container.innerHTML = chartHtml;

  // Legend
  if (legendEl) {
    legendEl.innerHTML = data.series.map((s, i) => {
      const color = CHART_COLORS[i % CHART_COLORS.length];
      return `<span class="evo-legend-item"><span class="evo-legend-dot" style="background:${color}"></span>${escapeHtml(s.cajero_nombre)}</span>`;
    }).join('');
  }

  // Warning note
  const noteEl = document.getElementById('fraud-evolution-note');
  if (noteEl) {
    let warnings = [];
    for (const s of data.series) {
      let consecutive = 0;
      for (const d of s.data) {
        if (d.total > 0 && d.pct_gratuitos > limitPct) consecutive++;
        else consecutive = 0;
        if (consecutive > 2) {
          warnings.push(s.cajero_nombre);
          break;
        }
      }
    }
    noteEl.innerHTML = warnings.length > 0
      ? `⚠️ ${warnings.join(', ')} supera${warnings.length > 1 ? 'n' : ''} el límite de forma sostenida (más de 2 bloques consecutivos).`
      : '';
  }
}

// ─── E. Suspicious Operations ────────────────────────────────
let showOnlySuspicious = false;

export function toggleSuspiciousFilter(onlyFlagged) {
  showOnlySuspicious = onlyFlagged;
  const rows = document.querySelectorAll('#fraud-suspicious-tbody tr');
  rows.forEach(row => {
    if (onlyFlagged && !row.classList.contains('suspicious-row')) {
      row.style.display = 'none';
    } else {
      row.style.display = '';
    }
  });

  // Update button states
  document.getElementById('btn-susp-all').classList.toggle('btn-active', !onlyFlagged);
  document.getElementById('btn-susp-flagged').classList.toggle('btn-active', onlyFlagged);
}

function renderSuspiciousOps(data) {
  const tbody = document.getElementById('fraud-suspicious-tbody');
  const countEl = document.getElementById('fraud-suspicious-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = `${data.total_sospechosas || 0} sospechosa${data.total_sospechosas !== 1 ? 's' : ''} de ${data.total} operaciones`;

  if (!data.operations || data.operations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Sin operaciones para esta fecha</td></tr>';
    return;
  }

  tbody.innerHTML = data.operations.map(op => {
    const rowClass = op.sospechoso ? 'suspicious-row' : '';
    const freeTotal = op.total_children + op.total_locals;
    const freeHighlight = freeTotal >= op.total_adults ? 'style="color:var(--danger);font-weight:700"' : '';

    return `<tr class="${rowClass}">
      <td>${escapeHtml(op.hora)}</td>
      <td ${op.sospechoso ? 'style="color:var(--danger);font-weight:700"' : ''}>${escapeHtml(op.cajero_nombre)}</td>
      <td>${op.total_adults} / <span ${freeHighlight}>${freeTotal}</span></td>
      <td>₲${op.total_amount.toLocaleString()}</td>
      <td style="font-family:monospace;font-size:.78rem">${op.operation_code}</td>
      <td>${op.sospechoso ? `<span class="susp-reason">${escapeHtml(op.razon)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
    </tr>`;
  }).join('');
}
