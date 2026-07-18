import { api } from '../api.js';
import { store } from '../store.js';
import { showToast } from '../utils/notifications.js';

const CHART_COLOR = '#6366f1';

export async function loadExecutiveSummary() {
  const panel = document.getElementById('executive-panel');
  if (!panel) return;

  // Same visibility rule as the fraud panel: executive numbers are ADMIN-only.
  if (store.currentUser?.role !== 'ADMIN') {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');

  try {
    const data = await api('/dashboard/executive-summary');
    renderCards(data);
    renderRevenueChart(data.dailySeries);
  } catch (err) {
    console.error('Executive summary error:', err);
    showToast('Error cargando resumen ejecutivo', 'error');
  }
}

function renderCards(data) {
  document.getElementById('exec-today-revenue').textContent = `₲${data.today.revenue.toLocaleString()}`;
  document.getElementById('exec-today-label').textContent = `Hoy · ${data.today.tickets} tickets`;

  document.getElementById('exec-week-revenue').textContent = `₲${data.week.revenue.toLocaleString()}`;
  document.getElementById('exec-week-label').textContent = `Últimos 7 días · ${data.week.tickets} tickets`;

  document.getElementById('exec-month-revenue').textContent = `₲${data.month.revenue.toLocaleString()}`;
  document.getElementById('exec-month-label').textContent = `Últimos 30 días · ${data.month.tickets} tickets`;
}

// Same CSS-bar approach as the anti-fraud evolution chart (.evo-*): no
// charting library in this project, and one bar per day is exactly that
// pattern with a date label instead of an hour label.
function renderRevenueChart(series) {
  const container = document.getElementById('exec-revenue-chart');
  if (!container) return;

  if (!series || series.length === 0) {
    container.innerHTML = '<div class="fraud-empty-msg">Sin datos para el gráfico</div>';
    return;
  }

  const maxRevenue = Math.max(1, ...series.map(d => d.revenue));
  const barWidth = Math.max(14, Math.floor(600 / series.length) - 4);

  const bars = series.map(d => {
    const height = (d.revenue / maxRevenue) * 100;
    const label = d.date.slice(5); // 'MM-DD'
    return `<div class="evo-hour-group">
      <div class="evo-bar" style="height:${height}%;background:${CHART_COLOR};width:${barWidth}px;"
        title="${d.date}: ₲${d.revenue.toLocaleString()} (${d.tickets} tickets)"></div>
      <div class="evo-hour-label">${label}</div>
    </div>`;
  }).join('');

  container.innerHTML = `<div class="evo-chart" style="position:relative;height:180px;">
    <div class="evo-bars-container">${bars}</div>
  </div>`;
}
