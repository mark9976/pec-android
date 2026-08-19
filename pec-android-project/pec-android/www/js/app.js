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

      // Test connectivity before navigating — show settings if unreachable
      const url = PecNative.getHandheldUrl();
      try {
        await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(5000) });
        navigateToPwa();
      } catch (e) {
        console.warn('[PEC] Server unreachable, showing settings:', e);
        showSettingsScreen(false);
      }
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
    const DEFAULT_SERVER_URL = 'https://biapps01.abarta.com:8443/pec';
    const currentUrl = PecNative.getServerUrl() || DEFAULT_SERVER_URL;
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

      msg.textContent = 'Launching...'; msg.className = 'info-msg';
      setTimeout(() => navigateToPwa(), 300);
    };

    document.getElementById('btnTestConnection').onclick = async () => {
      const msg = document.getElementById('settingsMsg');
      const url = document.getElementById('fldServerUrl').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('fldDeviceToken').value.trim();
      if (!url) { msg.textContent = 'Enter a URL first.'; msg.className = 'error-msg'; return; }
      if (!token) { msg.textContent = 'Enter a device token.'; msg.className = 'error-msg'; return; }

      msg.textContent = 'Testing...'; msg.className = 'info-msg';
      try {
        // Use no-cors mode — we can't read the response, but if the request
        // doesn't throw, the server is reachable. Full validation happens
        // when we navigate to the PWA.
        const testUrl = url + '/handheld/?token=' + encodeURIComponent(token);
        await fetch(testUrl, { mode: 'no-cors' });
        msg.textContent = '✓ Server is reachable! Hit Save & Connect to launch.'; msg.className = 'info-msg';
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
