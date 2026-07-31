/**
 * Sync engine: flushes pending sessions to server, refreshes reference data.
 * Uses PecNative.getApiBase() for the server URL.
 */
const PecSync = (function() {
  let _status = 'synced'; // synced | queued | syncing | error
  let _retryTimer = null;

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

  async function syncNow() {
    if (_status === 'syncing') return;
    if (!PecNative.isConfigured()) { setStatus('error'); return; }
    if (!navigator.onLine) { setStatus('queued'); return; }

    setStatus('syncing');
    try {
      // 1. Push pending sessions
      const pending = await PecDB.getAll('pendingSessions');
      if (pending.length > 0) {
        const res = await fetch(api() + '/sync', {
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

      // 2. Refresh reference data
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
      fetch(api() + '/operators', { headers: hdrs }),
      fetch(api() + '/equipment', { headers: hdrs }),
      fetch(api() + '/checklist', { headers: hdrs }),
      fetch(api() + '/shifts',    { headers: hdrs }),
      fetch(api() + '/sites',     { headers: hdrs }),
      fetch(api() + '/lockout-reasons', { headers: hdrs })
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
    if (pending.length > 0 && _status !== 'syncing') {
      setStatus('queued');
      if (navigator.onLine) syncNow();
    }
  }
  setInterval(checkQueue, 60000);

  return { syncNow, refreshReferenceData, getStatus, setStatus };
})();
