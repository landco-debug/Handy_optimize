(() => {
  const state = { results: [], pending: new Set(), errors: new Map() };
  const $ = (id) => document.getElementById(id);
  const post = (body) => window.webkit.messageHandlers.native.postMessage(body);

  function activeTrackers() {
    const out = [];
    if ($('use-rutracker').checked) out.push('rutracker');
    if ($('use-kinozal').checked) out.push('kinozal');
    return out;
  }
  function trackerName(raw) { return raw === 'rutracker' ? 'RuTracker' : raw === 'kinozal' ? 'Kinozal' : raw; }

  function search() {
    const query = $('query').value.trim();
    if (!query) return;
    const trackers = activeTrackers();
    if (!trackers.length) { $('summary').textContent = 'Выберите хотя бы один источник'; return; }
    state.results = []; state.errors.clear(); state.pending = new Set(trackers);
    render();
    $('summary').textContent = 'Поиск: ' + query;
    updateProgress();
    post({ action: 'search', query, trackers, topSeeds: $('topSeeds').checked });
  }

  function updateProgress() {
    if (!state.pending.size) {
      $('progress').textContent = '';
      const suffix = state.errors.size ? ' · ошибок: ' + state.errors.size : '';
      $('summary').textContent = state.results.length + ' результатов' + suffix;
      return;
    }
    $('progress').textContent = 'Ищу: ' + [...state.pending].map(trackerName).join(', ');
  }

  function render() {
    const tbody = $('results'); tbody.textContent = '';
    const sorted = [...state.results].sort((a, b) => $('topSeeds').checked
      ? (Number(b.seeds) || 0) - (Number(a.seeds) || 0)
      : String(b.date || '').localeCompare(String(a.date || '')));
    for (const item of sorted) {
      const tr = document.createElement('tr');
      const source = item.tracker === 'RuTracker' ? 'RuTracker' : 'Kinozal';
      tr.innerHTML =
        '<td><span class="badge"><span class="dot ' + (source === 'RuTracker' ? 'rt' : 'kz') + '"></span>' + source + '</span></td>' +
        '<td><a class="result-link" href="#">' + escapeHTML(item.title || '') + '</a></td>' +
        '<td>' + escapeHTML(item.date || '') + '</td>' +
        '<td>' + escapeHTML(item.size || '') + '</td>' +
        '<td class="num-col">' + (Number(item.seeds) || 0) + '</td>' +
        '<td class="num-col">' + (Number(item.peers) || 0) + '</td>';
      tr.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); post({ action: 'open', url: item.url }); });
      tbody.appendChild(tr);
    }
    for (const [tracker, message] of state.errors.entries()) {
      const tr = document.createElement('tr'); tr.className = 'error-row';
      tr.innerHTML = '<td>' + trackerName(tracker) + '</td><td colspan="5">' + escapeHTML(message) + '</td>';
      tbody.appendChild(tr);
    }
    $('empty').style.display = (sorted.length || state.errors.size) ? 'none' : 'block';
  }

  function escapeHTML(value) { const d = document.createElement('div'); d.textContent = value; return d.innerHTML; }
  function setSession(tracker, ok) {
    const el = $('status-' + tracker);
    el.className = 'status ' + (ok ? 'ok' : 'bad');
    el.textContent = ok ? 'авторизован' : 'не авторизован';
  }

  window.TSE = {
    receiveNative(payload) {
      switch (payload.type) {
        case 'searchStarted':
          state.pending = new Set(payload.trackers || []); updateProgress(); break;
        case 'trackerResults':
          state.pending.delete(payload.tracker); state.results.push(...(payload.results || [])); state.errors.delete(payload.tracker); render(); updateProgress(); break;
        case 'trackerError':
          state.pending.delete(payload.tracker); state.errors.set(payload.tracker, payload.message || 'Ошибка'); render(); updateProgress(); break;
        case 'sessionStatus':
          setSession('rutracker', !!payload.rutracker); setSession('kinozal', !!payload.kinozal); break;
      }
    }
  };

  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); search(); });
  $('topSeeds').addEventListener('change', render);
  document.querySelectorAll('[data-login]').forEach((button) => button.addEventListener('click', () => post({ action: 'login', tracker: button.dataset.login })));
  document.querySelectorAll('[data-clear]').forEach((button) => button.addEventListener('click', () => post({ action: 'clearSession', tracker: button.dataset.clear })));
  post({ action: 'sessionStatus' });
})();
