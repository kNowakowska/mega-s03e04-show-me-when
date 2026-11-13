import { ack, fetchIncidents } from './api.js';

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const error = document.querySelector('[data-testid="error"]');
const incidentsById = new Map();
const ackedIds = new Set();
const pendingAcks = new Set();
const euRegions = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB']);
let loaded = false;
let polling = false;

function regionFor(locale) {
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return locale.match(/-([A-Z]{2})(?:-|$)/)?.[1];
  }
}

function formatOpenedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  if (euRegions.has(regionFor(locale))) {
    const parts = new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return get('day') + '/' + get('month') + '/' + get('year') + ' ' + get('hour') + ':' + get('minute') + ':' + get('second');
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}

function render() {
  const incidents = [...incidentsById.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  empty.hidden = !loaded || incidents.length > 0;
  list.replaceChildren();

  for (const incident of incidents) {
    const row = document.createElement('li');
    row.dataset.testid = 'incident-row';
    row.dataset.id = incident.id;
    row.className = 'row ' + incident.severity;

    for (const [className, value] of [
      ['id', incident.id],
      ['sev', incident.severity],
      ['what', incident.service + ' · ' + incident.region + ' · ' + incident.summary],
    ]) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = value;
      row.append(span);
    }

    const time = document.createElement('time');
    time.dateTime = incident.openedAt;
    time.textContent = formatOpenedAt(incident.openedAt);
    row.append(time);

    if (ackedIds.has(incident.id)) {
      const mark = document.createElement('span');
      mark.dataset.testid = 'acked';
      mark.textContent = 'Acked';
      mark.setAttribute('aria-label', 'Incident acknowledged');
      row.append(mark);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.testid = 'ack';
      button.textContent = pendingAcks.has(incident.id) ? 'Acknowledging…' : 'Ack';
      button.disabled = pendingAcks.has(incident.id);
      button.setAttribute('aria-label', 'Acknowledge ' + incident.id);
      row.append(button);
    }
    list.append(row);
  }
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const page = await fetchIncidents();
    for (const incident of page.incidents) incidentsById.set(incident.id, incident);
    loaded = true;
    error.hidden = true;
    error.textContent = '';
  } catch (cause) {
    error.textContent = 'Could not load incidents: ' + cause.message;
    error.hidden = false;
  } finally {
    loaded = true;
    loader.hidden = true;
    polling = false;
    render();
  }
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-testid="ack"]');
  if (!button || !list.contains(button)) return;
  const row = button.closest('[data-testid="incident-row"]');
  const id = row?.dataset.id;
  if (!id || pendingAcks.has(id) || ackedIds.has(id)) return;
  pendingAcks.add(id);
  error.hidden = true;
  render();
  try {
    await ack(id);
    ackedIds.add(id);
  } catch (cause) {
    error.textContent = 'Could not acknowledge ' + id + ': ' + cause.message;
    error.hidden = false;
  } finally {
    pendingAcks.delete(id);
    render();
  }
});

await refresh();
window.setInterval(refresh, 2000);
