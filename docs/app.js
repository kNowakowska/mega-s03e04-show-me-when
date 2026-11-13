import { ack, fetchIncidents } from './api.js';

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const error = document.querySelector('[data-testid="error"]');
const newBar = document.querySelector('[data-testid="new-bar"]');
const incidentsById = new Map();
const pendingNew = new Map();
const ackedIds = new Set();
const pendingAcks = new Set();
const euRegions = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB']);
let visibleIds = [];
let loaded = false;
let initialized = false;
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

function makeSpan(className, value) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = value;
  return span;
}

function makeRow(incident) {
  const row = document.createElement('li');
  row.dataset.testid = 'incident-row';
  row.dataset.id = incident.id;
  row.className = 'row ' + incident.severity;
  row.append(
    makeSpan('id', incident.id),
    makeSpan('sev', incident.severity),
    makeSpan('what', incident.service + ' · ' + incident.region + ' · ' + incident.summary),
  );

  const time = document.createElement('time');
  time.dateTime = incident.openedAt;
  time.textContent = formatOpenedAt(incident.openedAt);
  row.append(time);

  if (ackedIds.has(incident.id)) {
    row.append(makeAckedMark());
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'ack';
    button.textContent = pendingAcks.has(incident.id) ? 'Acknowledging…' : 'Ack';
    button.disabled = pendingAcks.has(incident.id);
    button.setAttribute('aria-label', 'Acknowledge ' + incident.id);
    row.append(button);
  }
  return row;
}

function makeAckedMark() {
  const mark = document.createElement('span');
  mark.dataset.testid = 'acked';
  mark.textContent = 'Acked';
  mark.setAttribute('aria-label', 'Incident acknowledged');
  return mark;
}

function renderVisibleList() {
  list.replaceChildren(...visibleIds.map((id) => makeRow(incidentsById.get(id))));
  empty.hidden = !loaded || visibleIds.length > 0;
}

function updateNewBar() {
  const count = pendingNew.size;
  newBar.hidden = count === 0;
  newBar.textContent = count + ' new';
  newBar.setAttribute('aria-label', 'Show ' + count + ' new incidents');
}

function sortedByOpenedAt(incidents) {
  return incidents.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const page = await fetchIncidents();
    if (!initialized) {
      const initial = sortedByOpenedAt([...page.incidents]);
      for (const incident of initial) incidentsById.set(incident.id, incident);
      visibleIds = initial.map((incident) => incident.id);
      initialized = true;
      loaded = true;
      renderVisibleList();
    } else {
      for (const incident of page.incidents) {
        const isKnown = incidentsById.has(incident.id);
        incidentsById.set(incident.id, incident);
        if (!isKnown) pendingNew.set(incident.id, incident);
        else if (pendingNew.has(incident.id)) pendingNew.set(incident.id, incident);
      }
    }
    error.hidden = true;
    error.textContent = '';
  } catch (cause) {
    error.textContent = 'Could not load incidents: ' + cause.message;
    error.hidden = false;
  } finally {
    loaded = true;
    loader.hidden = true;
    polling = false;
    empty.hidden = visibleIds.length > 0;
    updateNewBar();
  }
}

newBar.addEventListener('click', () => {
  const arrivals = sortedByOpenedAt([...pendingNew.values()]);
  if (!arrivals.length) return;
  visibleIds = [...arrivals.map((incident) => incident.id), ...visibleIds];
  pendingNew.clear();
  renderVisibleList();
  updateNewBar();
});

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-testid="ack"]');
  if (!button || !list.contains(button)) return;
  const row = button.closest('[data-testid="incident-row"]');
  const id = row?.dataset.id;
  if (!id || pendingAcks.has(id) || ackedIds.has(id)) return;
  pendingAcks.add(id);
  button.disabled = true;
  button.textContent = 'Acknowledging…';
  error.hidden = true;
  try {
    await ack(id);
    ackedIds.add(id);
    pendingAcks.delete(id);
    button.replaceWith(makeAckedMark());
  } catch (cause) {
    error.textContent = 'Could not acknowledge ' + id + ': ' + cause.message;
    error.hidden = false;
    pendingAcks.delete(id);
    button.disabled = false;
    button.textContent = 'Ack';
  }
});

await refresh();
window.setInterval(refresh, 2000);
