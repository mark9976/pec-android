/**
 * PEC Handheld — Android native wrapper.
 *
 * This app is a thin native shell around the CRAW PEC handheld PWA.
 * On first launch it shows a Settings screen to configure the server URL
 * and device token. Once configured, it redirects the WebView to the
 * remote PWA at /pec/handheld/?token=<device-token>.
 *
 * The PWA handles all business logic (login, checklist, sync, offline).
 * The native shell provides NFC badge scanning and camera access.
 */
(function() {
  'use strict';

  const APP_VERSION = '1.0.1';
  const root = document.getElementById('appRoot');

  // ─── Boot ───
  async function boot() {
    try {
      await PecNative.init();

      if (!PecNative.isConfigured()) {
        showSettingsScreen(true);
        return;
      }

      // Already configured — go to the remote PWA
      navigateToPwa();
    } catch (e) {
      console.error('[PEC] Boot error:', e);
      showSettingsScreen(true);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Navigate to the remote CRAW PWA
  // ═══════════════════════════════════════════════════════════
  function navigateToPwa() {
    const url = PecNative.getHandheldUrl();
    console.log('[PEC] Navigating to PWA:', url);
    window.location.href = url;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Settings (Server URL + Device Token)
  // ═══════════════════════════════════════════════════════════
  function showSettingsScreen(isFirstRun) {
    const currentUrl = PecNative.getServerUrl();
    const currentToken = PecNative.getDeviceToken();
    root.innerHTML = `
      <div class="screen active settings-screen">
        <h2>⚙️ Server Settings</h2>
        ${isFirstRun ? '<p style="font-size:.85rem;color:#666;margin-bottom:1rem;">Configure the server connection before first use.</p>' : ''}
        <div class="settings-field">
          <label for="fldServerUrl">Server URL</label>
          <input type="url" id="fldServerUrl" placeholder="https://biapps01.abarta.com:8443/pec" value="${esc(currentUrl)}">
          <div class="hint">Full URL to the PEC module on your CRAW server</div>
        </div>
        <div class="settings-field">
          <label for="fldDeviceToken">Device Token</label>
          <input type="text" id="fldDeviceToken" placeholder="pec-mobile-xxxxxxxx" value="${esc(currentToken)}">
          <div class="hint">Token from appsettings.json → MobileAuth → Devices</div>
        </div>
        <div id="settingsMsg" class="error-msg"></div>
        <button class="big-btn primary" id="btnSaveSettings">💾 Save & Connect</button>
        <button class="big-btn" id="btnTestConnection">🔗 Test Connection</button>
        <div class="version-info">PEC Android v${APP_VERSION}</div>
      </div>`;

    document.getElementById('btnSaveSettings').onclick = async () => {
      const msg = document.getElementById('settingsMsg');
      const url = document.getElementById('fldServerUrl').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('fldDeviceToken').value.trim();
      if (!url) { msg.textContent = 'Server URL is required.'; msg.className = 'error-msg'; return; }
      if (!token) { msg.textContent = 'Device Token is required.'; msg.className = 'error-msg'; return; }

      msg.textContent = 'Saving...'; msg.className = 'info-msg';
      await PecNative.setServerUrl(url);
      await PecNative.setDeviceToken(token);

      msg.textContent = 'Connecting to server...'; msg.className = 'info-msg';
      try {
        const testUrl = url + '/handheld/?token=' + encodeURIComponent(token);
        const res = await fetch(testUrl);
        if (res.ok) {
          msg.textContent = 'Connected! Launching...'; msg.className = 'info-msg';
          setTimeout(() => navigateToPwa(), 500);
        } else if (res.status === 401 || res.status === 403) {
          msg.textContent = 'Server reachable but token rejected (' + res.status + '). Check your device token.';
          msg.className = 'error-msg';
        } else {
          msg.textContent = 'Saved. Server responded with ' + res.status + '. Launching anyway...';
          msg.className = 'info-msg';
          setTimeout(() => navigateToPwa(), 1000);
        }
      } catch(e) {
        msg.textContent = 'Saved, but could not reach server: ' + e.message;
        msg.className = 'error-msg';
      }
    };

    document.getElementById('btnTestConnection').onclick = async () => {
      const msg = document.getElementById('settingsMsg');
      const url = document.getElementById('fldServerUrl').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('fldDeviceToken').value.trim();
      if (!url) { msg.textContent = 'Enter a URL first.'; msg.className = 'error-msg'; return; }
      if (!token) { msg.textContent = 'Enter a device token.'; msg.className = 'error-msg'; return; }

      msg.textContent = 'Testing...'; msg.className = 'info-msg';
      try {
        const testUrl = url + '/handheld/?token=' + encodeURIComponent(token);
        const res = await fetch(testUrl);
        if (res.ok) {
          msg.textContent = '✓ Connection successful!'; msg.className = 'info-msg';
        } else if (res.status === 401 || res.status === 403) {
          msg.textContent = 'Server reachable but token was rejected (' + res.status + '). Check your device token.';
          msg.className = 'error-msg';
        } else {
          msg.textContent = 'Server responded with ' + res.status; msg.className = 'error-msg';
        }
      } catch(e) {
        msg.textContent = 'Connection failed: ' + e.message; msg.className = 'error-msg';
      }
    };
  }

  // ─── Helpers ───
  function esc(s) { if(!s) return ''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  // ─── Start ───
  boot();
})();
