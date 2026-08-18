/**
 * Sync engine: flushes pending sessions and queued offline actions to server,
 * refreshes reference data. Wraps fetch() to auto-queue API mutations that
 * fail due to network errors.
 */
const PecSync = (function() {
  let _status = 'synced'; // synced | queued | syncing | error
  let _retryTimer = null;
  const _originalFetch = window.fetch.bind(window);

  function api() { return PecNative.getApiBase() + '/api'; }

  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const token = PecNative.getDeviceToken();
    if (token) h['X-Device-Token'] = token;
    return h;
  }

  function getStatus() { return _status; }

  function setStatus(s) {
    _status = s;
    const el = document.getElementById('syncIndicator');
    if (el) { el.className = 'hh-sync ' + s; el.title = s; }
  }

  // ── Offline action queue ──

  async function queueAction(url, method, options) {
    let body = null;
    if (options && options.body) {
      body = (typeof options.body === 'string') ? options.body : String(options.body);
    }
    let headers = {};
    if (options && options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((v, k) => { headers[k] = v; });
      } else if (typeof options.headers === 'object') {
        headers = Object.assign({}, options.headers);
      }
    }
    const action = {
      actionId: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      url: url,
      method: method,
      headers: headers,
      body: body,
      createdAt: new Date().toISOString()
    };
    await PecDB.put('pendingActions', action);
    console.log('[PecSync] Queued offline action:', method, url);
  }

  async function flushPendingActions() {
    const actions = await PecDB.getAll('pendingActions');
    if (actions.length === 0) return;
    actions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const action of actions) {
      try {
        const res = await _originalFetch(action.url, {
          method: action.method,
          headers: action.headers,
          body: action.body
        });
        if (res.ok) {
          await PecDB.remove('pendingActions', action.actionId);
          console.log('[PecSync] Replayed action:', action.method, action.url);
        } else {
          console.warn('[PecSync] Replay failed:', action.method, action.url, res.status);
        }
      } catch (e) {
        console.warn('[PecSync] Replay network error, will retry later:', e);
        break;
      }
    }
  }

  function showSyncToast(msg) {
    let toast = document.getElementById('pecSyncToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pecSyncToast';
      toast.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
        'background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:8px;font-size:.85rem;' +
        'z-index:99999;opacity:0;transition:opacity .3s;pointer-events:none;text-align:center;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  // ── Wrap fetch to auto-queue failed API mutations ──

  window.fetch = async function(url, options) {
    const urlStr = (url instanceof Request) ? url.url : String(url);
    const method = ((options && options.method) || 'GET').toUpperCase();
    const isMutation = method !== 'GET' && method !== 'HEAD';
    const isPecApi = urlStr.indexOf('/api/') >= 0;
    const isSyncEndpoint = urlStr.indexOf('/api/sync') >= 0;

    if (!isMutation || !isPecApi || isSyncEndpoint) {
      return _originalFetch.apply(this, arguments);
    }

    if (!navigator.onLine) {
      await queueAction(urlStr, method, options);
      setStatus('queued');
      showSyncToast('Saved offline — will sync when connected');
      return new Response(JSON.stringify({ queued: true }), {
        status: 202, headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      return await _originalFetch.apply(this, arguments);
    } catch (e) {
      await queueAction(urlStr, method, options);
      setStatus('queued');
      showSyncToast('Saved offline — will sync when connected');
      return new Response(JSON.stringify({ queued: true }), {
        status: 202, headers: { 'Content-Type': 'application/json' }
      });
    }
  };

  async function syncNow() {
    if (_status === 'syncing') return;
    if (!PecNative.isConfigured()) { setStatus('error'); return; }
    if (!navigator.onLine) { setStatus('queued'); return; }

    setStatus('syncing');
    try {
      // 1. Push pending sessions
      const pending = await PecDB.getAll('pendingSessions');
      if (pending.length > 0) {
        const res = await _originalFetch(api() + '/sync', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ sessions: pending })
        });
        if (res.ok) {
          for (const s of pending) {
            await PecDB.put('completedSessions', s);
            await PecDB.remove('pendingSessions', s.clientGuid);
          }
        } else {
          throw new Error('Sync POST failed: ' + res.status);
        }
      }

      // 2. Replay queued offline actions (lock, unlock, etc.)
      await flushPendingActions();

      // 3. Refresh reference data
      await refreshReferenceData();
      setStatus('synced');
    } catch (e) {
      console.error('Sync failed:', e);
      setStatus('error');
      scheduleRetry();
    }
  }

  async function refreshReferenceData() {
    if (!PecNative.isConfigured()) return;
    const hdrs = authHeaders();
    const [opRes, eqRes, clRes, shRes, siteRes, reasonRes] = await Promise.all([
      _originalFetch(api() + '/operators', { headers: hdrs }),
      _originalFetch(api() + '/equipment', { headers: hdrs }),
      _originalFetch(api() + '/checklist', { headers: hdrs }),
      _originalFetch(api() + '/shifts',    { headers: hdrs }),
      _originalFetch(api() + '/sites',     { headers: hdrs }),
      _originalFetch(api() + '/lockout-reasons', { headers: hdrs })
    ]);
    if (opRes.ok) {
      const data = await opRes.json();
      await PecDB.clear('operators');
      await PecDB.bulkPut('operators', data.operators);
    }
    if (eqRes.ok) {
      const data = await eqRes.json();
      await PecDB.clear('equipment');
      await PecDB.bulkPut('equipment', data.equipment);
    }
    if (clRes.ok) {
      const data = await clRes.json();
      await PecDB.clear('checklist');
      await PecDB.bulkPut('checklist', data.items);
    }
    if (shRes.ok) {
      const data = await shRes.json();
      await PecDB.clear('shifts');
      await PecDB.bulkPut('shifts', data.shifts);
    }
    if (siteRes.ok) {
      const data = await siteRes.json();
      await PecDB.clear('sites');
      await PecDB.bulkPut('sites', data.sites);
    }
    if (reasonRes.ok) {
      const data = await reasonRes.json();
      await PecDB.clear('lockoutReasons');
      await PecDB.bulkPut('lockoutReasons', data.reasons);
    }
  }

  function scheduleRetry() {
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = setTimeout(() => syncNow(), 30000);
  }

  // Auto-sync when coming online
  window.addEventListener('online', () => syncNow());

  // Check for queued items periodically
  async function checkQueue() {
    const pending = await PecDB.getAll('pendingSessions');
    const actions = await PecDB.getAll('pendingActions');
    if ((pending.length > 0 || actions.length > 0) && _status !== 'syncing') {
      setStatus('queued');
      if (navigator.onLine) syncNow();
    }
  }
  setInterval(checkQueue, 60000);

  return { syncNow, refreshReferenceData, getStatus, setStatus, queueAction };
})();
