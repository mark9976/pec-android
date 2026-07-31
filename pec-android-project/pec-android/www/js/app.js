/**
 * PEC Handheld — Main application controller (Android native port).
 * Manages screen flow: Settings → Login → Role Menu / Checkout / Admin
 */
(function() {
  'use strict';

  const APP_VERSION = '1.0.0';
  const DEV_MODE = false;

  const root = document.getElementById('appRoot');
  let currentShift = null;

  function api() { return PecNative.getApiBase() + '/api'; }
  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const token = PecNative.getDeviceToken();
    if (token) h['X-Device-Token'] = token;
    return h;
  }

  // ─── Boot ───
  async function boot() {
    try {
      await PecNative.init();
      await PecDB.open();
      detectShift();

      // If server not configured yet, show settings first
      if (!PecNative.isConfigured()) {
        showSettingsScreen(true);
        return;
      }

      if (navigator.onLine) PecSync.syncNow();
    } catch (e) {
      console.error('[PEC] Boot error:', e);
    }
    showLoginScreen();
  }

  function detectShift() {
    const h = new Date().getHours();
    if (h >= 6 && h < 14) currentShift = '1ST';
    else if (h >= 14 && h < 22) currentShift = '2ND';
    else currentShift = '3RD';
  }

  function today() { return new Date().toISOString().split('T')[0]; }
  function uuid() { return crypto.randomUUID(); }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Settings (Server URL + Device Token)
  // ═══════════════════════════════════════════════════════════
  function showSettingsScreen(isFirstRun) {
    const currentBase = PecNative.getApiBase();
    const currentToken = PecNative.getDeviceToken();
    root.innerHTML = `
      <div class="screen active settings-screen">
        <h2>⚙️ Server Settings</h2>
        ${isFirstRun ? '<p style="font-size:.85rem;color:#666;margin-bottom:1rem;">Configure the server connection before first use.</p>' : ''}
        <div class="settings-field">
          <label for="fldServerUrl">Server URL</label>
          <input type="url" id="fldServerUrl" placeholder="https://your-craw-server.com/pec" value="${esc(currentBase)}">
          <div class="hint">Full URL to the PEC module (e.g. https://craw.abartacocacola.com/pec)</div>
        </div>
        <div class="settings-field">
          <label for="fldDeviceToken">Device Token</label>
          <input type="text" id="fldDeviceToken" placeholder="pec-mobile-xxxxxxxx" value="${esc(currentToken)}">
          <div class="hint">Token from appsettings.json → MobileAuth → Devices</div>
        </div>
        <div id="settingsMsg" class="error-msg"></div>
        <button class="big-btn primary" id="btnSaveSettings">💾 Save & Connect</button>
        <button class="big-btn" id="btnTestConnection">🔗 Test Connection</button>
        ${!isFirstRun ? '<button class="big-btn mt-1" id="btnSettingsBack">← Back</button>' : ''}
        <div class="version-info">PEC Android v${APP_VERSION}</div>
      </div>`;

    document.getElementById('btnSaveSettings').onclick = async () => {
      const msg = document.getElementById('settingsMsg');
      const url = document.getElementById('fldServerUrl').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('fldDeviceToken').value.trim();
      if (!url) { msg.textContent = 'Server URL is required.'; msg.className = 'error-msg'; return; }
      msg.textContent = 'Saving...'; msg.className = 'info-msg';
      await PecNative.setApiBase(url);
      await PecNative.setDeviceToken(token);
      msg.textContent = 'Saved. Syncing...'; msg.className = 'info-msg';
      try {
        await PecSync.refreshReferenceData();
        msg.textContent = 'Connected!'; msg.className = 'info-msg';
        setTimeout(() => showLoginScreen(), 500);
      } catch(e) {
        msg.textContent = 'Saved, but sync failed: ' + e.message; msg.className = 'error-msg';
      }
    };

    document.getElementById('btnTestConnection').onclick = async () => {
      const msg = document.getElementById('settingsMsg');
      const url = document.getElementById('fldServerUrl').value.trim().replace(/\/+$/, '');
      const token = document.getElementById('fldDeviceToken').value.trim();
      if (!url) { msg.textContent = 'Enter a URL first.'; msg.className = 'error-msg'; return; }
      msg.textContent = 'Testing...'; msg.className = 'info-msg';
      try {
        const hdrs = { 'Content-Type': 'application/json' };
        if (token) hdrs['X-Device-Token'] = token;
        const res = await fetch(url + '/api/shifts', { headers: hdrs });
        if (res.ok) {
          msg.textContent = '✓ Connection successful!'; msg.className = 'info-msg';
        } else {
          msg.textContent = 'Server responded with ' + res.status; msg.className = 'error-msg';
        }
      } catch(e) {
        msg.textContent = 'Connection failed: ' + e.message; msg.className = 'error-msg';
      }
    };

    const backBtn = document.getElementById('btnSettingsBack');
    if (backBtn) backBtn.onclick = showLoginScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Login (Badge + PIN)
  // ═══════════════════════════════════════════════════════════
  function showLoginScreen() {
    PecAuth.logout();
    const hasNfc = !!window.PecNfcAvailable || ('NDEFReader' in window);
    const showManual = DEV_MODE || !hasNfc;
    root.innerHTML = `
      <div class="screen active login-box" id="scrLogin">
        <h2>Operator Login</h2>
        ${hasNfc ? '<button class="big-btn primary" id="btnScanBadge">📱 Scan Badge (NFC)</button>' : ''}
        ${showManual || hasNfc ? `
          <div style="margin-top:.75rem;">
            <input type="text" id="manualBadgeUid" placeholder="Badge UID (e.g. 04:33:15:...)"
                   style="width:100%;padding:.5rem;font-size:1rem;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;">
            <button class="big-btn mt-1" id="btnManualBadge" style="background:#6366f1;color:#fff;">🔑 Login with UID</button>
          </div>
        ` : ''}
        <div id="loginMsg" class="info-msg"></div>
        <button class="big-btn mt-1" id="btnSettings" style="font-size:.8rem;border-color:#999;color:#666;">⚙️ Settings</button>
      </div>`;

    if (hasNfc) document.getElementById('btnScanBadge').onclick = handleNfcScan;
    const manualBtn = document.getElementById('btnManualBadge');
    if (manualBtn) {
      manualBtn.onclick = handleManualBadge;
      document.getElementById('manualBadgeUid').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleManualBadge();
      });
    }
    document.getElementById('btnSettings').onclick = () => showSettingsScreen(false);
  }

  async function handleManualBadge() {
    const msg = document.getElementById('loginMsg');
    const uid = (document.getElementById('manualBadgeUid').value || '').trim();
    if (!uid) { msg.textContent = 'Enter a badge UID.'; msg.className = 'error-msg'; return; }
    msg.textContent = 'Syncing...';
    if (navigator.onLine) await PecSync.refreshReferenceData();
    msg.textContent = 'Looking up badge...';
    const op = await PecAuth.findByBadge(uid);
    if (!op) { msg.textContent = 'Badge not recognized.'; msg.className = 'error-msg'; return; }
    showPinScreen(op, 'login');
  }

  async function handleNfcScan() {
    const msg = document.getElementById('loginMsg');
    msg.textContent = 'Syncing...';
    if (navigator.onLine) await PecSync.refreshReferenceData();
    msg.textContent = 'Hold badge near device...';
    msg.className = 'info-msg';
    const uid = await PecAuth.readNfcBadge();
    if (!uid) {
      msg.textContent = 'NFC read timed out. Try again.';
      msg.className = 'error-msg';
      return;
    }
    let op = await PecAuth.findByBadge(uid);
    if (!op) { msg.textContent = 'Badge not recognized.'; msg.className = 'error-msg'; return; }
    showPinScreen(op, 'login');
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: PIN Entry
  // ═══════════════════════════════════════════════════════════
  function showPinScreen(operator, purpose, callback) {
    let pin = '';
    root.innerHTML = `
      <div class="screen active">
        <div class="text-center" style="margin-bottom:.5rem;">
          <strong>${esc(operator.displayName)}</strong>
          <div style="font-size:.75rem;color:#666;">${purpose === 'login' ? 'Enter PIN to log in' : 'Enter PIN to sign attestation'}</div>
        </div>
        <div class="pin-display" id="pinDisplay"></div>
        <div id="pinMsg" class="error-msg"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="pin-key" data-key="${n}">${n}</button>`).join('')}
          <button class="pin-key danger" data-key="clear">C</button>
          <button class="pin-key" data-key="0">0</button>
          <button class="pin-key action" data-key="enter">✓</button>
        </div>
        <button class="big-btn mt-1" id="btnPinBack">← Back</button>
      </div>`;

    const display = document.getElementById('pinDisplay');
    const msg = document.getElementById('pinMsg');

    document.querySelectorAll('.pin-key').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.key;
        if (key === 'clear') { pin = ''; display.textContent = ''; msg.textContent = ''; return; }
        if (key === 'enter') {
          if (!pin) return;
          const result = await PecAuth.validatePin(operator, pin);
          if (result.valid) {
            if (purpose === 'login') {
              PecAuth.setCurrentOperator(operator);
              routeAfterLogin(operator);
            } else if (callback) {
              callback(true);
            }
          } else if (result.cooldown) {
            msg.textContent = `Too many attempts. Wait ${Math.ceil(result.remainingMs/1000)}s.`;
            pin = ''; display.textContent = '';
          } else {
            msg.textContent = `Invalid PIN. ${result.attemptsRemaining} attempts left.`;
            pin = ''; display.textContent = '';
          }
          return;
        }
        if (pin.length < 8) { pin += key; display.textContent = '●'.repeat(pin.length); }
      };
    });

    document.getElementById('btnPinBack').onclick = () => {
      if (purpose === 'login') showLoginScreen();
      else if (callback) callback(false);
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ROUTING: After login, route based on role
  // ═══════════════════════════════════════════════════════════
  function routeAfterLogin(operator) {
    const role = (operator.role || 'OPERATOR').toUpperCase();
    if (role === 'SUPERVISOR') showSupervisorMenu();
    else if (role === 'ADMIN') showAdminMenu();
    else showScanScreen();
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Supervisor Tile Menu
  // ═══════════════════════════════════════════════════════════
  function showSupervisorMenu() {
    const op = PecAuth.getCurrentOperator();
    root.innerHTML = `
      <div class="screen active">
        <div class="text-center" style="margin-bottom:1rem;">
          <strong>${esc(op.displayName)}</strong>
          <div style="font-size:.75rem;color:#7c3aed;">Supervisor</div>
        </div>
        <div class="tile-grid">
          <button class="tile-btn" id="tilePEC">
            <span class="tile-icon">🔧</span>
            <span class="tile-label">Power Equip Checkout</span>
          </button>
          <button class="tile-btn" id="tileUsers">
            <span class="tile-icon">👤</span>
            <span class="tile-label">Manage Users</span>
          </button>
          <button class="tile-btn" id="tileSupCheck">
            <span class="tile-icon">🔍</span>
            <span class="tile-label">Supervisor Check</span>
          </button>
          <button class="tile-btn" id="tileEquip">
            <span class="tile-icon">⚙️</span>
            <span class="tile-label">Manage Equipment</span>
          </button>
        </div>
        <button class="big-btn mt-1" id="btnLogoutMenu">🔒 Logout</button>
      </div>`;

    document.getElementById('tilePEC').onclick = showScanScreen;
    document.getElementById('tileUsers').onclick = showManageUsersScreen;
    document.getElementById('tileSupCheck').onclick = () => showSupervisorCheckScan(op);
    document.getElementById('tileEquip').onclick = showManageEquipmentScreen;
    document.getElementById('btnLogoutMenu').onclick = showLoginScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Admin Tile Menu
  // ═══════════════════════════════════════════════════════════
  function showAdminMenu() {
    const op = PecAuth.getCurrentOperator();
    root.innerHTML = `
      <div class="screen active">
        <div class="text-center" style="margin-bottom:1rem;">
          <strong>${esc(op.displayName)}</strong>
          <div style="font-size:.75rem;color:#dc2626;">Administrator</div>
        </div>
        <div class="tile-grid">
          <button class="tile-btn" id="tilePEC">
            <span class="tile-icon">🔧</span>
            <span class="tile-label">Power Equip Checkout</span>
          </button>
          <button class="tile-btn" id="tileUsers">
            <span class="tile-icon">👤</span>
            <span class="tile-label">Manage Users</span>
          </button>
          <button class="tile-btn" id="tileSupCheck">
            <span class="tile-icon">🔍</span>
            <span class="tile-label">Supervisor Check</span>
          </button>
          <button class="tile-btn" id="tileEquip">
            <span class="tile-icon">⚙️</span>
            <span class="tile-label">Manage Equipment</span>
          </button>
          <button class="tile-btn tile-admin" id="tileSites">
            <span class="tile-icon">🏭</span>
            <span class="tile-label">Manage Sites</span>
          </button>
          <button class="tile-btn tile-admin" id="tileSupervisors">
            <span class="tile-icon">🛡️</span>
            <span class="tile-label">Create Supervisor</span>
          </button>
        </div>
        <button class="big-btn mt-1" id="btnLogoutMenu">🔒 Logout</button>
      </div>`;

    document.getElementById('tilePEC').onclick = showAdminSitePicker;
    document.getElementById('tileUsers').onclick = showManageUsersScreen;
    document.getElementById('tileSupCheck').onclick = () => showSupervisorCheckScan(op);
    document.getElementById('tileEquip').onclick = showManageEquipmentScreen;
    document.getElementById('tileSites').onclick = showManageSitesScreen;
    document.getElementById('tileSupervisors').onclick = showCreateSupervisorScreen;
    document.getElementById('btnLogoutMenu').onclick = showLoginScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Admin site picker (before checkout)
  // ═══════════════════════════════════════════════════════════
  async function showAdminSitePicker() {
    const sites = await PecDB.getAll('sites');
    const active = sites.filter(s => s.isActive);
    root.innerHTML = `
      <div class="screen active">
        <h2>Select Site</h2>
        <p style="font-size:.8rem;color:#666;margin-bottom:1rem;">Choose the DC for this checkout session:</p>
        <div class="site-list">
          ${active.map(s => `<button class="big-btn site-pick" data-site="${esc(s.siteId)}">${esc(s.siteCode)} — ${esc(s.siteName)}</button>`).join('')}
        </div>
        ${active.length === 0 ? '<p class="error-msg">No sites configured. Create a site first.</p>' : ''}
        <button class="big-btn mt-1" id="btnBackMenu">← Back</button>
      </div>`;

    document.querySelectorAll('.site-pick').forEach(btn => {
      btn.onclick = () => {
        PecAuth.getCurrentOperator()._selectedSiteId = btn.dataset.site;
        showScanScreen();
      };
    });
    document.getElementById('btnBackMenu').onclick = showAdminMenu;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Barcode Scan (Equipment)
  // ═══════════════════════════════════════════════════════════
  function showScanScreen() {
    const op = PecAuth.getCurrentOperator();
    if (navigator.onLine) PecSync.refreshReferenceData().catch(() => {});
    root.innerHTML = `
      <div class="screen active scan-section">
        <h2>Scan Equipment Barcode</h2>
        <p style="font-size:.8rem;color:#666;margin-bottom:1rem;">Operator: ${esc(op.displayName)} | Shift: ${currentShift}</p>
        <input type="text" class="scan-input" id="barcodeInput" placeholder="Scan or type barcode" autofocus>
        <div id="scanMsg" class="error-msg"></div>
        <div class="mt-1">
          <button class="big-btn" id="btnLogout">🔒 Logout</button>
        </div>
      </div>`;

    const input = document.getElementById('barcodeInput');
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const barcode = input.value.replace(/[\r\n]/g, '').trim();
        if (!barcode) return;
        await handleBarcodeScan(barcode);
      }
    });
    document.getElementById('btnLogout').onclick = showLoginScreen;
  }

  async function handleBarcodeScan(barcode) {
    const equipment = await findEquipmentByBarcode(barcode);
    if (!equipment) {
      document.getElementById('scanMsg').textContent = 'Equipment not found.';
      return;
    }

    if (equipment.status === 'LOCKED_OUT') {
      showLockedScreen(equipment);
      return;
    }

    const priorSession = await findPriorSession(equipment.equipmentId);
    if (priorSession && !priorSession.isRevalidation && priorSession.overallResult === 'Safe') {
      showRevalidationScreen(equipment, priorSession);
    } else {
      showChecklistScreen(equipment);
    }
  }

  async function findEquipmentByBarcode(barcode) {
    const all = await PecDB.getAll('equipment');
    return all.find(e => e.barcode.toUpperCase() === barcode.toUpperCase()) || null;
  }

  async function findPriorSession(equipmentId) {
    const completed = await PecDB.getAll('completedSessions');
    return completed.find(s =>
      s.equipmentId === equipmentId &&
      s.sessionDate === today() &&
      s.shiftId === currentShift &&
      !s.isRevalidation
    ) || null;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Locked Equipment
  // ═══════════════════════════════════════════════════════════
  function showLockedScreen(equipment) {
    const op = PecAuth.getCurrentOperator();
    const isSuperOrAdmin = op.role === 'SUPERVISOR' || op.role === 'ADMIN';
    root.innerHTML = `
      <div class="screen active locked-screen">
        <div class="lock-icon">🔒</div>
        <h2>EQUIPMENT LOCKED OUT</h2>
        <p><strong>${esc(equipment.description || equipment.equipmentId)}</strong></p>
        <p>${esc(equipment.lockedReason || 'This equipment has been taken out of service.')}</p>
        <button class="big-btn mt-1" id="btnBackScan">← Back to Scan</button>
        ${isSuperOrAdmin ? '<button class="big-btn primary mt-1" id="btnSuperClear">🔓 Clear Equipment</button>' : ''}
      </div>`;

    document.getElementById('btnBackScan').onclick = showScanScreen;
    const clearBtn = document.getElementById('btnSuperClear');
    if (clearBtn) clearBtn.onclick = () => showSupervisorClearScreen(equipment);
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Checklist (one item per screen)
  // ═══════════════════════════════════════════════════════════
  function showChecklistScreen(equipment) {
    const op = PecAuth.getCurrentOperator();
    const eqType = equipment.equipmentType;

    PecDB.getAll('checklist').then(async allItems => {
      const eqSite = equipment.siteId || null;
      const items = allItems.filter(i => {
        if (i.siteId && i.siteId !== eqSite) return false;
        if (eqType === 'F') return i.appliesToForklift;
        if (eqType === 'R') return i.appliesToReach;
        if (eqType === 'W') return i.appliesToWalkie;
        return false;
      }).sort((a, b) => a.sortOrder - b.sortOrder);

      if (!items.length) { showScanScreen(); return; }

      const session = {
        clientGuid: uuid(),
        equipmentId: equipment.equipmentId,
        operatorId: op.operatorId,
        shiftId: currentShift,
        sessionDate: today(),
        isRevalidation: false,
        startedAt: new Date().toISOString(),
        items: []
      };

      let globalDelay = 10;
      try {
        const cfgRes = await fetch(api() + '/config', { headers: authHeaders() });
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg.checklistItemDelaySeconds != null) globalDelay = cfg.checklistItemDelaySeconds;
        }
      } catch(e) {}

      let idx = 0;

      function renderItem() {
        const item = items[idx];
        const itemDelay = (item.delaySecs != null && item.delaySecs > 0) ? item.delaySecs : globalDelay;
        const pct = Math.round(((idx) / items.length) * 100);
        root.innerHTML = `
          <div class="screen active checklist-screen">
            <div class="cl-progress">Item ${idx+1} of ${items.length}</div>
            <div class="cl-progress-bar"><div class="cl-progress-fill" style="width:${pct}%"></div></div>
            <div class="cl-item-text">${esc(item.itemText)}</div>
            <div id="countdown" style="text-align:center;font-size:1.5rem;font-weight:bold;color:#d97706;margin:0.75rem 0;"></div>
            <div class="cl-buttons">
              <button class="btn-yes" id="btnY" disabled>YES</button>
              <button class="btn-no" id="btnN" disabled>NO</button>
              <button class="btn-na" id="btnNA" disabled>N/A</button>
            </div>
          </div>`;

        const btnY = document.getElementById('btnY');
        const btnN = document.getElementById('btnN');
        const btnNA = document.getElementById('btnNA');
        const cdEl = document.getElementById('countdown');

        let remaining = itemDelay;
        cdEl.textContent = `Inspect item... ${remaining}s`;

        const timer = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            clearInterval(timer);
            cdEl.textContent = '';
            btnY.disabled = false; btnN.disabled = false; btnNA.disabled = false;
            btnY.style.opacity = '1'; btnN.style.opacity = '1'; btnNA.style.opacity = '1';
          } else {
            cdEl.textContent = `Inspect item... ${remaining}s`;
          }
        }, 1000);

        btnY.style.opacity = '0.4'; btnN.style.opacity = '0.4'; btnNA.style.opacity = '0.4';
        btnY.onclick = () => { clearInterval(timer); recordAnswer('Y', item); };
        btnN.onclick = () => { clearInterval(timer); handleFailure(item); };
        btnNA.onclick = () => { clearInterval(timer); recordAnswer('NA', item); };
      }

      function recordAnswer(result, item, photoUrl, notes, photoData) {
        session.items.push({
          itemId: item.itemId, result,
          photoUrl: photoUrl || null, photoData: photoData || null,
          notes: notes || null, answeredAt: new Date().toISOString()
        });
        idx++;
        if (idx >= items.length) showSummaryScreen(session, equipment);
        else renderItem();
      }

      function handleFailure(item) {
        root.innerHTML = `
          <div class="screen active" style="padding:1rem;">
            <h3 style="color:#d12421;">⚠️ Item Failed</h3>
            <p style="font-size:.85rem;margin:.5rem 0;">${esc(item.itemText)}</p>
            <div class="summary-card">
              <h3>LOTO / Failure Instructions</h3>
              <p style="font-size:.8rem;">${esc(item.failureInstructions || 'No specific instructions available.')}</p>
            </div>
            <div style="margin:1rem 0;text-align:center;">
              <button class="big-btn primary" id="btnTakePhoto">📷 Take Photo</button>
              <input type="file" accept="image/*" capture="environment" id="failPhoto" style="display:none;">
              <div id="photoPreview" style="margin-top:.75rem;"></div>
            </div>
            <label style="display:block;margin:.5rem 0;">
              <strong>Notes (optional):</strong>
              <textarea id="failNotes" rows="2" style="width:100%;padding:.5rem;border:1px solid #ddd;border-radius:4px;"></textarea>
            </label>
            <button class="big-btn primary" id="btnFailContinue">Continue →</button>
          </div>`;

        let capturedPhotoData = null;
        let capturedPhotoName = null;
        const photoInput = document.getElementById('failPhoto');

        document.getElementById('btnTakePhoto').onclick = async () => {
          // Try native camera first
          const nativeResult = await PecNative.takePhoto();
          if (nativeResult) {
            capturedPhotoData = nativeResult.dataUrl;
            capturedPhotoName = nativeResult.fileName;
            document.getElementById('photoPreview').innerHTML = `<img src="${nativeResult.dataUrl}" style="max-width:100%;max-height:200px;border-radius:8px;border:2px solid #16a34a;"><p style="font-size:.75rem;color:#16a34a;margin-top:.25rem;">✓ Photo captured</p>`;
          } else {
            // Fallback to HTML file input
            photoInput.click();
          }
        };

        photoInput.onchange = () => {
          if (photoInput.files.length > 0) {
            const url = URL.createObjectURL(photoInput.files[0]);
            capturedPhotoName = photoInput.files[0].name;
            document.getElementById('photoPreview').innerHTML = `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:8px;border:2px solid #16a34a;"><p style="font-size:.75rem;color:#16a34a;margin-top:.25rem;">✓ Photo captured</p>`;
            const reader = new FileReader();
            reader.onload = () => { capturedPhotoData = reader.result; };
            reader.readAsDataURL(photoInput.files[0]);
          }
        };

        document.getElementById('btnFailContinue').onclick = () => {
          const notes = document.getElementById('failNotes').value.trim();
          recordAnswer('N', item, capturedPhotoName, notes, capturedPhotoData);
        };
      }

      renderItem();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Summary + Signature
  // ═══════════════════════════════════════════════════════════
  function showSummaryScreen(session, equipment) {
    const hasFailure = session.items.some(i => i.result === 'N');
    const overallResult = hasFailure ? 'Unsafe' : 'Safe';
    session.overallResult = overallResult;

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <div class="summary-result ${overallResult.toLowerCase()}">${overallResult === 'Safe' ? '✓ SAFE' : '✗ UNSAFE'}</div>
        <div class="summary-card">
          <h3>Inspection Summary — ${esc(equipment.description || equipment.equipmentId)}</h3>
          <ul class="summary-items">
            ${session.items.map(i => `<li><span>${esc(getItemText(i.itemId))}</span><span class="${i.result==='Y'?'item-pass':i.result==='N'?'item-fail':'item-na'}">${i.result}</span></li>`).join('')}
          </ul>
        </div>
        <div class="summary-card">
          <p style="font-size:.8rem;line-height:1.5;">
            <strong>Attestation:</strong> I confirm that I have personally inspected this equipment and the results above are accurate.
            ${hasFailure ? '<br><span style="color:#d12421;">This equipment will be <strong>LOCKED OUT</strong> and a corrective action created.</span>' : ''}
          </p>
        </div>
        <button class="big-btn primary" id="btnSign">🔐 Sign with PIN</button>
        <button class="big-btn mt-1" id="btnCancelSession">Cancel</button>
      </div>`;

    document.getElementById('btnSign').onclick = () => {
      const op = PecAuth.getCurrentOperator();
      showPinScreen(op, 'signature', async (success) => {
        if (success) {
          session.signatureTimestamp = new Date().toISOString();
          session.completedAt = new Date().toISOString();
          await PecDB.put('pendingSessions', session);
          await PecDB.put('completedSessions', session);
          PecSync.setStatus('queued');
          if (navigator.onLine) PecSync.syncNow();
          showCompletionScreen(overallResult);
        } else {
          showSummaryScreen(session, equipment);
        }
      });
    };
    document.getElementById('btnCancelSession').onclick = showScanScreen;
  }

  function showCompletionScreen(result) {
    root.innerHTML = `
      <div class="screen active text-center" style="padding:2rem;">
        <div style="font-size:4rem;">${result === 'Safe' ? '✅' : '🚫'}</div>
        <h2 style="margin:1rem 0;">${result === 'Safe' ? 'Checkout Complete' : 'Equipment Locked Out'}</h2>
        <p style="color:#666;">${result === 'Safe' ? 'Equipment is cleared for use.' : 'A corrective action has been created.'}</p>
        <button class="big-btn primary mt-1" id="btnNext">Next Equipment →</button>
      </div>`;
    document.getElementById('btnNext').onclick = showScanScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Revalidation
  // ═══════════════════════════════════════════════════════════
  function showRevalidationScreen(equipment, priorSession) {
    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2 style="margin-bottom:1rem;">Revalidation Required</h2>
        <p style="font-size:.85rem;color:#666;margin-bottom:1rem;">${esc(equipment.description || equipment.equipmentId)} was already inspected this shift.</p>
        <div class="reval-section">
          <h3 style="font-size:.85rem;">Prior Inspection Summary</h3>
          <ul class="summary-items">
            ${(priorSession.items||[]).map(i => `<li><span>${esc(getItemText(i.itemId))}</span><span class="${i.result==='Y'?'item-pass':i.result==='N'?'item-fail':'item-na'}">${i.result}</span></li>`).join('')}
          </ul>
        </div>
        <p style="font-size:.85rem;margin:1rem 0;">Confirm this equipment is still safe for use:</p>
        <div style="display:flex;gap:.5rem;">
          <button class="big-btn primary" id="btnRevalSafe" style="flex:1;">✓ Still Safe</button>
          <button class="big-btn" id="btnRevalUnsafe" style="flex:1;border-color:#d12421;color:#d12421;">✗ Unsafe</button>
        </div>
        <button class="big-btn mt-1" id="btnRevalBack">← Back</button>
      </div>`;

    document.getElementById('btnRevalSafe').onclick = () => submitRevalidation(equipment, priorSession, 'Safe');
    document.getElementById('btnRevalUnsafe').onclick = () => submitRevalidation(equipment, priorSession, 'Unsafe');
    document.getElementById('btnRevalBack').onclick = showScanScreen;
  }

  function submitRevalidation(equipment, priorSession, result) {
    const op = PecAuth.getCurrentOperator();
    const session = {
      clientGuid: uuid(),
      equipmentId: equipment.equipmentId,
      operatorId: op.operatorId,
      shiftId: currentShift,
      sessionDate: today(),
      isRevalidation: true,
      originalSessionId: priorSession.clientGuid,
      overallResult: result,
      startedAt: new Date().toISOString(),
      items: []
    };

    showPinScreen(op, 'signature', async (success) => {
      if (success) {
        session.signatureTimestamp = new Date().toISOString();
        session.completedAt = new Date().toISOString();
        await PecDB.put('pendingSessions', session);
        await PecDB.put('completedSessions', session);
        PecSync.setStatus('queued');
        if (navigator.onLine) PecSync.syncNow();
        showCompletionScreen(result);
      } else {
        showRevalidationScreen(equipment, priorSession);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SCREEN: Supervisor Clear Equipment
  // ═══════════════════════════════════════════════════════════
  function showSupervisorClearScreen(equipment) {
    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>Clear Equipment: ${esc(equipment.description || equipment.equipmentId)}</h2>
        <p style="font-size:.85rem;color:#666;margin:1rem 0;">Locked reason: ${esc(equipment.lockedReason || 'Unknown')}</p>
        <label style="display:block;margin:.5rem 0;">
          <strong>Resolution Notes:</strong>
          <textarea id="clearNotes" rows="3" style="width:100%;padding:.5rem;border:1px solid #ddd;border-radius:4px;margin-top:.25rem;"></textarea>
        </label>
        <button class="big-btn primary" id="btnConfirmClear">🔐 Clear & Sign</button>
        <button class="big-btn mt-1" id="btnCancelClear">← Cancel</button>
      </div>`;

    document.getElementById('btnConfirmClear').onclick = () => {
      const notes = document.getElementById('clearNotes').value.trim();
      const op = PecAuth.getCurrentOperator();
      showPinScreen(op, 'signature', async (success) => {
        if (success) {
          if (navigator.onLine) {
            try {
              await fetch(api() + '/clear-equipment', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ equipmentId: equipment.equipmentId, resolvedBy: op.operatorId, resolutionNotes: notes })
              });
            } catch {}
          }
          equipment.status = 'ACTIVE';
          equipment.lockedReason = null;
          await PecDB.put('equipment', equipment);
          showCompletionScreen('Safe');
        } else {
          showSupervisorClearScreen(equipment);
        }
      });
    };
    document.getElementById('btnCancelClear').onclick = () => showLockedScreen(equipment);
  }

  // ═══════════════════════════════════════════════════════════
  // SUPERVISOR CHECK FLOW
  // ═══════════════════════════════════════════════════════════
  function showSupervisorCheckScan(supervisor) {
    root.innerHTML = `
      <div class="screen active scan-section">
        <h2 style="color:#7c3aed;">🔍 Supervisor Check</h2>
        <p style="font-size:.8rem;color:#666;margin-bottom:1rem;">Supervisor: ${esc(supervisor.displayName)}</p>
        <p style="font-size:.85rem;margin-bottom:.5rem;">Scan equipment barcode to check status:</p>
        <input type="text" class="scan-input" id="supBarcodeInput" placeholder="Scan or type barcode" autofocus>
        <div id="supScanMsg" class="error-msg"></div>
        <button class="big-btn mt-1" id="btnSupScanDone">← Back to Menu</button>
      </div>`;

    const input = document.getElementById('supBarcodeInput');
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const barcode = input.value.replace(/[\r\n]/g, '').trim();
        if (!barcode) return;
        input.value = '';
        await doSupervisorCheck(supervisor, barcode);
      }
    });
    document.getElementById('btnSupScanDone').onclick = () => routeAfterLogin(PecAuth.getCurrentOperator());
  }

  async function doSupervisorCheck(supervisor, barcode) {
    const msg = document.getElementById('supScanMsg');
    msg.textContent = 'Checking...'; msg.className = 'info-msg';

    const equipment = await findEquipmentByBarcode(barcode);
    if (!equipment) { msg.textContent = 'Equipment not found.'; msg.className = 'error-msg'; return; }

    try {
      const res = await fetch(api() + '/supervisor-check', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ supervisorId: supervisor.operatorId, equipmentId: equipment.equipmentId })
      });
      const data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'Check failed.'; msg.className = 'error-msg'; return; }
      showSupervisorCheckResult(supervisor, data);
    } catch (err) {
      msg.textContent = 'Network error.'; msg.className = 'error-msg';
    }
  }

  function showSupervisorCheckResult(supervisor, data) {
    const isSafe = data.lastResult === 'Safe' && data.equipmentStatus === 'ACTIVE';
    const statusClass = isSafe ? 'safe' : 'unsafe';
    const statusIcon = isSafe ? '✓' : '✗';
    const statusText = data.equipmentStatus === 'LOCKED_OUT' ? 'LOCKED OUT' : (data.lastResult || 'No inspection on record');

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2 style="color:#7c3aed;margin-bottom:1rem;">🔍 Equipment Check Result</h2>
        <div class="summary-result ${statusClass}">${statusIcon} ${esc(statusText)}</div>
        <div class="summary-card">
          <h3>${esc(data.equipmentDescription || data.equipmentId)}</h3>
          <table style="width:100%;font-size:.85rem;line-height:1.8;">
            <tr><td style="color:#666;">Status:</td><td><strong>${esc(data.equipmentStatus)}</strong></td></tr>
            <tr><td style="color:#666;">Checked Out By:</td><td><strong>${esc(data.checkedOutBy || '— None —')}</strong></td></tr>
            <tr><td style="color:#666;">Last Inspection:</td><td>${esc(data.lastResult || 'None')} (${esc(data.lastSessionDate || '—')} / ${esc(data.lastShift || '—')})</td></tr>
          </table>
        </div>
        <button class="big-btn primary mt-1" id="btnCheckAnother">🔍 Check Another</button>
        <button class="big-btn mt-1" id="btnCheckDone">← Back to Menu</button>
      </div>`;

    document.getElementById('btnCheckAnother').onclick = () => showSupervisorCheckScan(supervisor);
    document.getElementById('btnCheckDone').onclick = () => routeAfterLogin(PecAuth.getCurrentOperator());
  }

  // ═══════════════════════════════════════════════════════════
  // MANAGE USERS SCREEN
  // ═══════════════════════════════════════════════════════════
  async function showManageUsersScreen() {
    const op = PecAuth.getCurrentOperator();
    const siteId = op.siteId || op._selectedSiteId;
    const allOps = await PecDB.getAll('operators');
    const siteOps = siteId ? allOps.filter(o => o.siteId === siteId) : allOps;

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>👤 Manage Users</h2>
        <button class="big-btn primary" id="btnCreateUser">+ Create New User</button>
        <div class="user-list" style="margin-top:1rem;max-height:50vh;overflow-y:auto;">
          ${siteOps.map(o => `
            <div class="user-card ${o.isActive ? '' : 'inactive'}" data-id="${esc(o.operatorId)}">
              <div><strong>${esc(o.displayName)}</strong></div>
              <div style="font-size:.75rem;color:#666;">${esc(o.role)} ${o.badgeUid ? '| Badge ✓' : '| No badge'} ${!o.isActive ? '| INACTIVE' : ''}</div>
            </div>
          `).join('')}
          ${siteOps.length === 0 ? '<p style="color:#666;font-size:.85rem;">No users at this site.</p>' : ''}
        </div>
        <button class="big-btn mt-1" id="btnBackMenu">← Back to Menu</button>
      </div>`;

    document.getElementById('btnCreateUser').onclick = () => showUserForm(null);
    document.querySelectorAll('.user-card').forEach(card => {
      card.onclick = () => {
        const user = siteOps.find(o => o.operatorId === card.dataset.id);
        if (user) showUserForm(user);
      };
    });
    document.getElementById('btnBackMenu').onclick = () => routeAfterLogin(op);
  }

  function showUserForm(existingUser) {
    const op = PecAuth.getCurrentOperator();
    const siteId = op.siteId || op._selectedSiteId;
    const isEdit = !!existingUser;

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>${isEdit ? 'Edit User' : 'Create User'}</h2>
        <label class="form-label">Name:
          <input type="text" id="fldName" class="form-input" value="${esc(existingUser?.displayName || '')}" placeholder="Full name">
        </label>
        <label class="form-label">PIN (4-8 digits):
          <input type="password" id="fldPin" class="form-input" maxlength="8" placeholder="${isEdit ? '(leave blank to keep)' : 'Enter PIN'}">
        </label>
        <label class="form-label">Role:
          <select id="fldRole" class="form-input">
            <option value="OPERATOR" ${existingUser?.role === 'OPERATOR' ? 'selected' : ''}>Operator</option>
            ${op.role === 'ADMIN' ? `<option value="SUPERVISOR" ${existingUser?.role === 'SUPERVISOR' ? 'selected' : ''}>Supervisor</option>` : ''}
          </select>
        </label>
        <div style="margin:.75rem 0;">
          <strong>Badge:</strong> ${existingUser?.badgeUid ? esc(existingUser.badgeUid) : 'None assigned'}
          <button class="big-btn" id="btnScanNewBadge" style="margin-top:.5rem;">📱 ${isEdit ? 'Reassign' : 'Scan'} Badge</button>
          <div id="badgeMsg" class="info-msg"></div>
        </div>
        ${isEdit ? `<label class="form-label"><input type="checkbox" id="fldActive" ${existingUser.isActive ? 'checked' : ''}> Active</label>` : ''}
        <div id="userFormMsg" class="error-msg"></div>
        <button class="big-btn primary mt-1" id="btnSaveUser">💾 Save</button>
        <button class="big-btn mt-1" id="btnCancelUser">← Cancel</button>
      </div>`;

    let scannedBadge = existingUser?.badgeUid || null;

    document.getElementById('btnScanNewBadge').onclick = async () => {
      const bMsg = document.getElementById('badgeMsg');
      bMsg.textContent = 'Hold badge near device...'; bMsg.className = 'info-msg';
      const uid = await PecAuth.readNfcBadge();
      if (uid) { scannedBadge = uid; bMsg.textContent = `Badge: ${uid}`; bMsg.className = 'info-msg'; }
      else { bMsg.textContent = 'NFC read failed.'; bMsg.className = 'error-msg'; }
    };

    document.getElementById('btnSaveUser').onclick = async () => {
      const formMsg = document.getElementById('userFormMsg');
      const name = document.getElementById('fldName').value.trim();
      const pin = document.getElementById('fldPin').value.trim();
      const role = document.getElementById('fldRole').value;
      const isActive = isEdit ? document.getElementById('fldActive').checked : true;

      if (!name) { formMsg.textContent = 'Name is required.'; return; }
      if (!isEdit && !pin) { formMsg.textContent = 'PIN is required for new user.'; return; }
      if (pin && (pin.length < 4 || !/^\d+$/.test(pin))) { formMsg.textContent = 'PIN must be 4-8 digits.'; return; }

      const payload = {
        operatorId: existingUser?.operatorId || uuid(),
        displayName: name, role, isActive,
        badgeUid: scannedBadge, siteId: siteId || null
      };
      if (pin) payload.pin = pin;
      else if (isEdit) payload.pin = '__KEEP__';

      formMsg.textContent = 'Saving...'; formMsg.className = 'info-msg';
      try {
        if (payload.pin === '__KEEP__') {
          const updated = { ...existingUser, displayName: name, role, isActive, badgeUid: scannedBadge, siteId: siteId || existingUser.siteId };
          await PecDB.put('operators', updated);
          if (navigator.onLine) {
            await fetch(api() + '/operators', {
              method: 'POST', headers: authHeaders(),
              body: JSON.stringify({ ...payload, pin: null, pinHash: existingUser.pinHash, pinSalt: existingUser.pinSalt })
            });
          }
        } else {
          const res = await fetch(api() + '/operators', {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const err = await res.json();
            formMsg.textContent = err.error || 'Save failed.'; formMsg.className = 'error-msg'; return;
          }
        }
        if (navigator.onLine) await PecSync.refreshReferenceData();
        showManageUsersScreen();
      } catch (e) {
        formMsg.textContent = 'Network error.'; formMsg.className = 'error-msg';
      }
    };

    document.getElementById('btnCancelUser').onclick = showManageUsersScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // MANAGE EQUIPMENT SCREEN
  // ═══════════════════════════════════════════════════════════
  async function showManageEquipmentScreen(filterSiteId) {
    const op = PecAuth.getCurrentOperator();
    const defaultSiteId = filterSiteId !== undefined ? filterSiteId : (op.siteId || '');
    const allEquip = await PecDB.getAll('equipment');
    const allSites = await PecDB.getAll('sites');
    const siteEquip = defaultSiteId ? allEquip.filter(e => e.siteId === defaultSiteId) : allEquip;
    const reasons = await PecDB.getAll('lockoutReasons');

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>⚙️ Manage Equipment</h2>
        <div style="display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap;">
          <select id="selEquipSite" style="flex:1;padding:.5rem;font-size:.85rem;border:1px solid #ccc;border-radius:6px;">
            <option value="">All Sites</option>
            ${allSites.map(s => `<option value="${esc(s.siteId)}"${s.siteId===defaultSiteId?' selected':''}>${esc(s.siteCode)} — ${esc(s.siteName)}</option>`).join('')}
          </select>
        </div>
        <div class="equip-list" style="max-height:55vh;overflow-y:auto;">
          ${siteEquip.map(e => `
            <div class="equip-card ${e.status === 'LOCKED_OUT' ? 'locked' : ''}" data-id="${esc(e.equipmentId)}">
              <div><strong>${esc(e.description || e.equipmentId)}</strong></div>
              <div style="font-size:.75rem;color:#666;">${esc(e.barcode)} | ${e.status === 'LOCKED_OUT' ? '🔒 LOCKED' : '✓ Active'}</div>
            </div>
          `).join('')}
          ${siteEquip.length === 0 ? '<p style="color:#666;font-size:.85rem;">No equipment at this site.</p>' : ''}
        </div>
        <button class="big-btn mt-1" id="btnBackMenu">← Back to Menu</button>
      </div>`;

    document.getElementById('selEquipSite').onchange = (e) => showManageEquipmentScreen(e.target.value);

    document.querySelectorAll('.equip-card').forEach(card => {
      card.onclick = () => {
        const equip = siteEquip.find(e => e.equipmentId === card.dataset.id);
        if (equip) showEquipmentActions(equip, reasons);
      };
    });
    document.getElementById('btnBackMenu').onclick = () => routeAfterLogin(op);
  }

  function showEquipmentActions(equipment, reasons) {
    const op = PecAuth.getCurrentOperator();
    const isLocked = equipment.status === 'LOCKED_OUT';
    const activeReasons = reasons.filter(r => r.isActive);

    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>${esc(equipment.description || equipment.equipmentId)}</h2>
        <p style="font-size:.85rem;color:#666;">Barcode: ${esc(equipment.barcode)} | Status: <strong>${esc(equipment.status)}</strong></p>
        ${isLocked ? `<p style="font-size:.85rem;color:#d12421;">Reason: ${esc(equipment.lockedReason || 'Unknown')}</p>` : ''}
        <div style="margin-top:1rem;">
          ${isLocked ? '<button class="big-btn primary" id="btnUnlock">🔓 Return to Service</button>' : ''}
          ${!isLocked ? `
            <button class="big-btn" id="btnLock" style="border-color:#d12421;color:#d12421;">🔒 Flag as Unsafe</button>
            ${activeReasons.length > 0 ? `
              <select id="selReason" class="form-input" style="margin-top:.5rem;">
                <option value="">-- Optional: Select reason --</option>
                ${activeReasons.map(r => `<option value="${esc(r.reasonId)}">${esc(r.label)}</option>`).join('')}
              </select>` : ''}
          ` : ''}
        </div>
        <button class="big-btn mt-1" id="btnBackEquipList">← Back</button>
      </div>`;

    const unlockBtn = document.getElementById('btnUnlock');
    const lockBtn = document.getElementById('btnLock');

    if (unlockBtn) {
      unlockBtn.onclick = () => {
        showPinScreen(op, 'signature', async (success) => {
          if (success) {
            if (navigator.onLine) {
              try { await fetch(api() + '/clear-equipment', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ equipmentId: equipment.equipmentId, resolvedBy: op.operatorId }) }); } catch {}
            }
            equipment.status = 'ACTIVE'; equipment.lockedReason = null;
            await PecDB.put('equipment', equipment);
            showManageEquipmentScreen();
          } else { showEquipmentActions(equipment, reasons); }
        });
      };
    }

    if (lockBtn) {
      lockBtn.onclick = () => {
        const sel = document.getElementById('selReason');
        const reasonId = sel ? sel.value : null;
        const reasonLabel = sel && sel.value ? sel.options[sel.selectedIndex].text : null;
        showPinScreen(op, 'signature', async (success) => {
          if (success) {
            if (navigator.onLine) {
              try { await fetch(api() + '/lock-equipment', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ equipmentId: equipment.equipmentId, lockedBy: op.operatorId, reasonId: reasonId || null, reason: reasonLabel || 'Flagged unsafe by supervisor' }) }); } catch {}
            }
            equipment.status = 'LOCKED_OUT'; equipment.lockedReason = reasonLabel || 'Flagged unsafe by supervisor';
            await PecDB.put('equipment', equipment);
            showManageEquipmentScreen();
          } else { showEquipmentActions(equipment, reasons); }
        });
      };
    }

    document.getElementById('btnBackEquipList').onclick = showManageEquipmentScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: MANAGE SITES
  // ═══════════════════════════════════════════════════════════
  async function showManageSitesScreen() {
    const sites = await PecDB.getAll('sites');
    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>🏭 Manage Sites</h2>
        <button class="big-btn primary" id="btnCreateSite">+ Create Site</button>
        <div class="site-list-manage" style="margin-top:1rem;max-height:50vh;overflow-y:auto;">
          ${sites.map(s => `
            <div class="user-card" data-id="${esc(s.siteId)}">
              <div><strong>${esc(s.siteCode)}</strong> — ${esc(s.siteName)}</div>
              <div style="font-size:.75rem;color:#666;">${s.isActive ? 'Active' : 'Inactive'}</div>
            </div>
          `).join('')}
          ${sites.length === 0 ? '<p style="color:#666;font-size:.85rem;">No sites configured.</p>' : ''}
        </div>
        <button class="big-btn mt-1" id="btnBackMenu">← Back to Menu</button>
      </div>`;

    document.getElementById('btnCreateSite').onclick = () => showSiteForm(null);
    document.querySelectorAll('.user-card').forEach(card => {
      card.onclick = () => {
        const site = sites.find(s => s.siteId === card.dataset.id);
        if (site) showSiteForm(site);
      };
    });
    document.getElementById('btnBackMenu').onclick = showAdminMenu;
  }

  function showSiteForm(existingSite) {
    const isEdit = !!existingSite;
    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>${isEdit ? 'Edit Site' : 'Create Site'}</h2>
        <label class="form-label">Site Code (e.g. ATL):
          <input type="text" id="fldSiteCode" class="form-input" value="${esc(existingSite?.siteCode || '')}" maxlength="20">
        </label>
        <label class="form-label">Site Name:
          <input type="text" id="fldSiteName" class="form-input" value="${esc(existingSite?.siteName || '')}">
        </label>
        ${isEdit ? `<label class="form-label"><input type="checkbox" id="fldSiteActive" ${existingSite.isActive ? 'checked' : ''}> Active</label>` : ''}
        <div id="siteFormMsg" class="error-msg"></div>
        <button class="big-btn primary mt-1" id="btnSaveSite">💾 Save</button>
        <button class="big-btn mt-1" id="btnCancelSite">← Cancel</button>
      </div>`;

    document.getElementById('btnSaveSite').onclick = async () => {
      const formMsg = document.getElementById('siteFormMsg');
      const code = document.getElementById('fldSiteCode').value.trim().toUpperCase();
      const name = document.getElementById('fldSiteName').value.trim();
      const isActive = isEdit ? document.getElementById('fldSiteActive').checked : true;
      if (!code || !name) { formMsg.textContent = 'Code and name are required.'; return; }
      formMsg.textContent = 'Saving...'; formMsg.className = 'info-msg';
      try {
        const res = await fetch(api() + '/sites', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ siteId: existingSite?.siteId || null, siteCode: code, siteName: name, isActive })
        });
        if (!res.ok) { formMsg.textContent = 'Save failed.'; formMsg.className = 'error-msg'; return; }
        if (navigator.onLine) await PecSync.refreshReferenceData();
        showManageSitesScreen();
      } catch { formMsg.textContent = 'Network error.'; formMsg.className = 'error-msg'; }
    };
    document.getElementById('btnCancelSite').onclick = showManageSitesScreen;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN: CREATE SUPERVISOR
  // ═══════════════════════════════════════════════════════════
  async function showCreateSupervisorScreen() {
    const sites = (await PecDB.getAll('sites')).filter(s => s.isActive);
    root.innerHTML = `
      <div class="screen active" style="padding:1rem;">
        <h2>🛡️ Create Supervisor</h2>
        <label class="form-label">Site:
          <select id="fldSupSite" class="form-input">
            <option value="">-- Select site --</option>
            ${sites.map(s => `<option value="${esc(s.siteId)}">${esc(s.siteCode)} — ${esc(s.siteName)}</option>`).join('')}
          </select>
        </label>
        <label class="form-label">Name:
          <input type="text" id="fldSupName" class="form-input" placeholder="Supervisor name">
        </label>
        <label class="form-label">PIN (4-8 digits):
          <input type="password" id="fldSupPin" class="form-input" maxlength="8" placeholder="Enter PIN">
        </label>
        <div style="margin:.75rem 0;">
          <button class="big-btn" id="btnScanSupBadge">📱 Scan Badge</button>
          <div id="supBadgeMsg" class="info-msg"></div>
        </div>
        <div id="supFormMsg" class="error-msg"></div>
        <button class="big-btn primary mt-1" id="btnSaveSup">💾 Create Supervisor</button>
        <button class="big-btn mt-1" id="btnCancelSup">← Cancel</button>
      </div>`;

    let scannedBadge = null;
    document.getElementById('btnScanSupBadge').onclick = async () => {
      const bMsg = document.getElementById('supBadgeMsg');
      bMsg.textContent = 'Hold badge near device...'; bMsg.className = 'info-msg';
      const uid = await PecAuth.readNfcBadge();
      if (uid) { scannedBadge = uid; bMsg.textContent = `Badge: ${uid}`; }
      else { bMsg.textContent = 'NFC read failed.'; bMsg.className = 'error-msg'; }
    };

    document.getElementById('btnSaveSup').onclick = async () => {
      const formMsg = document.getElementById('supFormMsg');
      const siteId = document.getElementById('fldSupSite').value;
      const name = document.getElementById('fldSupName').value.trim();
      const pin = document.getElementById('fldSupPin').value.trim();
      if (!siteId) { formMsg.textContent = 'Site is required.'; return; }
      if (!name) { formMsg.textContent = 'Name is required.'; return; }
      if (!pin || pin.length < 4 || !/^\d+$/.test(pin)) { formMsg.textContent = 'PIN must be 4-8 digits.'; return; }
      formMsg.textContent = 'Saving...'; formMsg.className = 'info-msg';
      try {
        const res = await fetch(api() + '/operators', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ operatorId: uuid(), displayName: name, pin, role: 'SUPERVISOR', badgeUid: scannedBadge, siteId, isActive: true })
        });
        if (!res.ok) { const err = await res.json(); formMsg.textContent = err.error || 'Save failed.'; formMsg.className = 'error-msg'; return; }
        if (navigator.onLine) await PecSync.refreshReferenceData();
        showAdminMenu();
      } catch { formMsg.textContent = 'Network error.'; formMsg.className = 'error-msg'; }
    };
    document.getElementById('btnCancelSup').onclick = showAdminMenu;
  }

  // ─── Helpers ───
  function esc(s) { if(!s) return ''; const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  let _checklistCache = null;
  PecDB.getAll('checklist').then(items => {
    _checklistCache = {};
    for (const i of items) _checklistCache[i.itemId] = i.itemText;
  });
  function getItemText(itemId) { return (_checklistCache && _checklistCache[itemId]) || itemId; }

  // ─── Start ───
  boot();
})();
