package com.abarta.pec;

import android.app.PendingIntent;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

/**
 * Main activity with NFC foreground dispatch.
 *
 * Reads NFC badges natively and delivers the UID to the WebView
 * via JavaScript injection (custom events + PecAuth override).
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PEC-NFC";
    private static final String BUILD_VERSION = "2026.08.17-F";
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private Handler mainHandler;
    private WebView webView;
    private String lastScannedBadge = null;

    /**
     * Script to override PecAuth.readNfcBadge and polyfill NDEFReader.
     */
    private static final String NFC_SETUP_JS =
        "(function() {" +
        "  if (window.__pecNfcReady) return;" +
        "  window.__pecNfcReady = true;" +
        "  function tryOverride() {" +
        "    if (typeof PecAuth !== 'undefined') {" +
        "      PecAuth.readNfcBadge = function() {" +
        "        return new Promise(function(resolve) {" +
        "          console.log('[PEC-NFC] Waiting for badge tap...');" +
        "          var t = setTimeout(function() { c(); resolve(null); }, 30000);" +
        "          function h(e) { clearTimeout(t); c(); console.log('[PEC-NFC] Got badge: '+e.detail.tagId); resolve(e.detail.tagId); }" +
        "          function c() { window.removeEventListener('nfc-tag-discovered', h); }" +
        "          window.addEventListener('nfc-tag-discovered', h);" +
        "        });" +
        "      };" +
        "      return true;" +
        "    }" +
        "    return false;" +
        "  }" +
        "  if (!tryOverride()) {" +
        "    var iv = setInterval(function() { if(tryOverride()) clearInterval(iv); }, 200);" +
        "    setTimeout(function() { clearInterval(iv); }, 30000);" +
        "  }" +
        "  if (!window.NDEFReader) {" +
        "    window.NDEFReader = function() {};" +
        "    window.NDEFReader.prototype.scan = function() {" +
        "      var s = this;" +
        "      window.addEventListener('nfc-tag-discovered', function(e) {" +
        "        if (s.onreading) s.onreading({serialNumber:e.detail.tagId,message:{records:[]}});" +
        "      });" +
        "      return Promise.resolve();" +
        "    };" +
        "  }" +
        "  if (navigator.permissions) {" +
        "    var oq = navigator.permissions.query.bind(navigator.permissions);" +
        "    navigator.permissions.query = function(d) {" +
        "      if (d && d.name === 'nfc') return Promise.resolve({state:'granted',onchange:null});" +
        "      return oq(d);" +
        "    };" +
        "  }" +
        "  window.PecNfcAvailable = true;" +
        "})();";

    /**
     * UI customisation script injected into the remote PWA.
     *
     * 1. PIN pad: bigger buttons, move ✓ (check) below the pad and rename to "OK"
     * 2. Manage Equipment: show who locked equipment (lockedByName)
     * 3. Manage Equipment: barcode scan opens a text-entry popup instead of NFC
     * 4. Checkout screen: auto-focus the barcode input field
     */
    private static final String UI_TWEAKS_JS =
        "(function(){" +
        "  if(window.__pecUiTweaks) return;" +
        "  window.__pecUiTweaks = true;" +

        // ── Inject CSS overrides ──
        "  var sty = document.createElement('style');" +
        "  sty.textContent = '" +
        // 1. Bigger PIN keys, reduce surrounding space so pad fits without scrolling
        "    .pin-display { margin:.5rem 0; min-height:2rem; }" +
        "    .login-box { padding:.5rem .5rem; }" +
        "    .login-box h2 { margin-bottom:.5rem; font-size:1rem; }" +
        "    .pin-pad { max-width:100%; gap:.5rem; }" +
        "    .pin-key { padding:1.4rem .5rem; font-size:1.8rem; min-height:72px; }" +
        // OK + Back row below the grid, equal width
        "    .pin-bottom-row { display:flex; gap:.5rem; margin-top:.5rem; }" +
        "    .pin-bottom-row .pin-key { flex:1; font-size:1.3rem; min-height:56px; padding:1rem; }" +
        // Barcode popup overlay
        "    .pec-barcode-overlay { position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center; }" +
        "    .pec-barcode-popup { background:#fff;border-radius:12px;padding:1.5rem;width:90%;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,.3); }" +
        "    .pec-barcode-popup h3 { margin:0 0 1rem;text-align:center;font-size:1.1rem; }" +
        "    .pec-barcode-popup input { width:100%;padding:.8rem;font-size:1.2rem;text-align:center;border:2px solid #1e3a5f;border-radius:8px;margin-bottom:.75rem; }" +
        "    .pec-barcode-popup .popup-btns { display:flex;gap:.5rem; }" +
        "    .pec-barcode-popup .popup-btns button { flex:1;padding:.8rem;font-size:1rem;font-weight:700;border:none;border-radius:8px;cursor:pointer; }" +
        "    .pec-barcode-popup .popup-ok { background:#1e3a5f;color:#fff; }" +
        "    .pec-barcode-popup .popup-cancel { background:#e2e8f0;color:#333; }" +
        "  ';" +
        "  document.head.appendChild(sty);" +

        // ── MutationObserver watches for screen changes ──
        "  var ob = new MutationObserver(function(){ pecTweakAll(); });" +
        "  ob.observe(document.body, {childList:true, subtree:true});" +
        "  pecTweakAll();" +

        "  function pecTweakAll() {" +

        // ── 1. PIN pad: bigger buttons, move Back + OK below the number grid ──
        "    document.querySelectorAll('.pin-pad').forEach(function(pad){" +
        "      if(pad.dataset.tweaked) return;" +
        "      pad.dataset.tweaked='1';" +
        // Find Back (danger class, ⌫) and OK (action class, ✓) keys
        "      var backKey=null, okKey=null;" +
        "      pad.querySelectorAll('.pin-key').forEach(function(k){" +
        "        var t=k.textContent.trim();" +
        "        if(k.classList.contains('danger') || t==='⌫' || t==='←' || t.toLowerCase()==='back') backKey=k;" +
        "        if(k.classList.contains('action') || t==='✓' || t==='OK') okKey=k;" +
        "      });" +
        // Remove both from the grid and place in a row below
        "      var row = document.createElement('div');" +
        "      row.className='pin-bottom-row';" +
        "      if(backKey){ backKey.parentNode.removeChild(backKey); row.appendChild(backKey); }" +
        "      if(okKey){ okKey.parentNode.removeChild(okKey); okKey.textContent='OK'; row.appendChild(okKey); }" +
        "      pad.parentNode.insertBefore(row, pad.nextSibling);" +
        "    });" +

        // ── 2. Manage Equipment: show who locked the equipment ──
        "    document.querySelectorAll('.equip-card.locked').forEach(function(card){" +
        "      if(card.dataset.lockTweaked) return;" +
        "      card.dataset.lockTweaked='1';" +
        // Look for data attribute or hidden element with locker info
        "      var lockBy = card.dataset.lockedBy || card.getAttribute('data-locked-by') || '';" +
        "      if(!lockBy){" +
        // Try to find it in the card's text content structure
        "        var spans = card.querySelectorAll('span,small,div');" +
        "        for(var i=0;i<spans.length;i++){" +
        "          var t=spans[i].textContent||'';" +
        "          if(t.indexOf('Locked by')>=0){ lockBy=''; break; }" +
        "        }" +
        "      }" +
        // If we have locker info and it's not already shown, inject it
        "      if(lockBy && !card.querySelector('.lock-by-label')){" +
        "        var lb = document.createElement('div');" +
        "        lb.className='lock-by-label';" +
        "        lb.style.cssText='font-size:.8rem;color:#d12421;font-weight:600;margin-top:.25rem;';" +
        "        lb.textContent='Locked by: '+lockBy;" +
        "        card.appendChild(lb);" +
        "      }" +
        "    });" +
        // Also look for equipment list items rendered by the PWA with lockedByName
        "    if(typeof PecEquipUI!=='undefined' && PecEquipUI._origRenderCard===undefined){" +
        "      PecEquipUI._origRenderCard = PecEquipUI.renderCard || null;" +
        "    }" +
        // Fallback: scan for any element that has equipment data
        "    document.querySelectorAll('[data-locked-by-name]').forEach(function(el){" +
        "      if(el.dataset.lockNameShown) return;" +
        "      el.dataset.lockNameShown='1';" +
        "      var n=el.dataset.lockedByName;" +
        "      if(n){" +
        "        var lb2 = document.createElement('div');" +
        "        lb2.style.cssText='font-size:.8rem;color:#d12421;font-weight:600;margin-top:.25rem;';" +
        "        lb2.textContent='Marked out of service by: '+n;" +
        "        el.appendChild(lb2);" +
        "      }" +
        "    });" +

        // ── 3. Manage Equipment: barcode scan → popup for 2D barcode entry ──
        "    document.querySelectorAll('.equip-scan-btn, [data-action=\"scan-equip-barcode\"]').forEach(function(btn){" +
        "      if(btn.dataset.barcodePopup) return;" +
        "      btn.dataset.barcodePopup='1';" +
        "      btn.addEventListener('click', function(e){" +
        "        e.stopPropagation(); e.preventDefault();" +
        "        showBarcodePopup(function(val){" +
        // Dispatch the same event/callback the original scan would
        "          if(val){" +
        "            var ev = new CustomEvent('barcode-scanned',{detail:{barcode:val}});" +
        "            window.dispatchEvent(ev);" +
        // Also try to set any visible scan input
        "            var inp = document.querySelector('.scan-input');" +
        "            if(inp){ inp.value=val; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }" +
        "          }" +
        "        });" +
        "      }, true);" +
        "    });" +
        // Also intercept NFC scan buttons that say 'Scan Barcode' on equipment screens
        "    document.querySelectorAll('.big-btn').forEach(function(btn){" +
        "      var txt=(btn.textContent||'').toLowerCase();" +
        "      if((txt.indexOf('scan barcode')>=0 || txt.indexOf('scan equipment')>=0) && !btn.dataset.barcodePopup){" +
        // Only on equipment management screens, not checkout
        "        var screen = btn.closest('.screen,.manage-equip-screen');" +
        "        if(screen && (screen.classList.contains('manage-equip-screen') || " +
        "            (screen.querySelector('.equip-card') || screen.querySelector('[data-action=\"add-equipment\"]')))){" +
        "          btn.dataset.barcodePopup='1';" +
        "          btn.addEventListener('click', function(e){" +
        "            e.stopPropagation(); e.preventDefault();" +
        "            showBarcodePopup(function(val){" +
        "              if(val){" +
        "                var inp=document.querySelector('.scan-input');" +
        "                if(inp){ inp.value=val; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }" +
        "                window.dispatchEvent(new CustomEvent('barcode-scanned',{detail:{barcode:val}}));" +
        "              }" +
        "            });" +
        "          }, true);" +
        "        }" +
        "      }" +
        "    });" +

        // ── 4. Checkout screen: auto-focus the barcode input ──
        "    var scanInp = document.querySelector('.scan-section .scan-input');" +
        "    if(scanInp && !scanInp.dataset.autoFocused){" +
        "      scanInp.dataset.autoFocused='1';" +
        "      setTimeout(function(){ scanInp.focus(); }, 300);" +
        "    }" +

        "  }" + // end pecTweakAll

        // ── Barcode popup helper ──
        "  window.showBarcodePopup = function(cb){" +
        "    var overlay = document.createElement('div');" +
        "    overlay.className='pec-barcode-overlay';" +
        "    overlay.innerHTML='<div class=\"pec-barcode-popup\">" +
        "      <h3>📦 Enter Equipment Barcode</h3>" +
        "      <input type=\"text\" id=\"popupBarcodeInput\" placeholder=\"Scan or type barcode\" autocomplete=\"off\">" +
        "      <div class=\"popup-btns\">" +
        "        <button class=\"popup-cancel\" id=\"popupBarcodeCancel\">Cancel</button>" +
        "        <button class=\"popup-ok\" id=\"popupBarcodeOk\">OK</button>" +
        "      </div>" +
        "    </div>';" +
        "    document.body.appendChild(overlay);" +
        "    var inp = document.getElementById('popupBarcodeInput');" +
        "    setTimeout(function(){ inp.focus(); }, 200);" +
        "    document.getElementById('popupBarcodeOk').onclick=function(){" +
        "      var v=inp.value.trim(); document.body.removeChild(overlay); cb(v||null);" +
        "    };" +
        "    document.getElementById('popupBarcodeCancel').onclick=function(){" +
        "      document.body.removeChild(overlay); cb(null);" +
        "    };" +
        "    inp.addEventListener('keydown',function(e){" +
        "      if(e.key==='Enter'){ document.getElementById('popupBarcodeOk').click(); }" +
        "    });" +
        "    overlay.addEventListener('click',function(e){" +
        "      if(e.target===overlay){ document.body.removeChild(overlay); cb(null); }" +
        "    });" +
        "  };" +

        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PecNfcPlugin.class);
        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());

        // Store WebView reference DIRECTLY — getBridge().getWebView() may not
        // work after navigating to external CRAW page
        webView = getBridge().getWebView();

        // Expose native bridge via JavascriptInterface (persists across navigation)
        webView.addJavascriptInterface(new NfcJsBridge(), "PecNfcNative");

        // Inject NFC setup with retries
        injectSetupWithRetries();

        // NFC adapter setup
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        if (nfcAdapter != null) {
            Intent intent = new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            // FLAG_MUTABLE required on API 31+, must not be used on older
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            nfcPendingIntent = PendingIntent.getActivity(this, 0, intent, flags);
            Log.i(TAG, "NFC adapter ready");
        } else {
            Log.w(TAG, "No NFC adapter on this device");
        }

        handleNfcIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        if (nfcAdapter != null && nfcAdapter.isEnabled()) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, null, null);
            Log.i(TAG, "Foreground dispatch enabled");
        } else if (nfcAdapter != null && !nfcAdapter.isEnabled()) {
            Toast.makeText(this, "NFC is disabled - enable in Settings", Toast.LENGTH_LONG).show();
        }
        injectSetupWithRetries();
    }

    @Override
    public void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            nfcAdapter.disableForegroundDispatch(this);
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNfcIntent(intent);
    }

    private void handleNfcIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (NfcAdapter.ACTION_TAG_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {
            Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
            if (tag != null) {
                String uid = bytesToHex(tag.getId());
                Log.i(TAG, "Tag UID: " + uid);
                lastScannedBadge = uid;
                onBadgeScanned(uid);
            }
        }
    }

    /**
     * Called when a badge is successfully scanned.
     */
    private void onBadgeScanned(String uid) {
        runOnUiThread(() -> deliverBadgeToWebView(uid));
    }

    /**
     * Deliver badge UID to the web page by dispatching the nfc-tag-discovered event.
     * The PecAuth.readNfcBadge override listens for this event.
     */
    private void deliverBadgeToWebView(String tagId) {
        if (webView == null) {
            Log.e(TAG, "WebView is null, cannot deliver badge");
            return;
        }
        String safeId = tagId.replace("'", "\\'").replace("\\", "\\\\");
        String js = "window.dispatchEvent(new CustomEvent('nfc-tag-discovered', " +
                    "{detail:{tagId:'" + safeId + "'}}));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void injectSetupWithRetries() {
        if (webView == null) return;
        // Inject version badge + NFC setup at multiple intervals
        String versionJs =
            "(function() {" +
            "  if (document.getElementById('pec-version-badge')) return;" +
            "  var v = document.createElement('div');" +
            "  v.id = 'pec-version-badge';" +
            "  v.style.cssText = 'position:fixed;bottom:4px;right:4px;z-index:99999;" +
            "    background:rgba(0,0,0,0.7);color:#0f0;padding:4px 8px;font-size:11px;" +
            "    border-radius:4px;font-family:monospace;pointer-events:none;';" +
            "  v.textContent = 'PEC " + BUILD_VERSION + "';" +
            "  document.body.appendChild(v);" +
            "})();";
        String combined = NFC_SETUP_JS + versionJs + UI_TWEAKS_JS;

        int[] delays = {0, 500, 1500, 3000, 5000, 8000};
        for (int delay : delays) {
            if (delay == 0) {
                webView.post(() -> webView.evaluateJavascript(combined, null));
            } else {
                mainHandler.postDelayed(() ->
                    webView.post(() -> webView.evaluateJavascript(combined, null)), delay);
            }
        }
    }

    private static String bytesToHex(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02X", bytes[i]));
        }
        return sb.toString();
    }

    /**
     * Native NFC bridge exposed to JavaScript as window.PecNfcNative.
     */
    public class NfcJsBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return nfcAdapter != null;
        }

        @JavascriptInterface
        public boolean isEnabled() {
            return nfcAdapter != null && nfcAdapter.isEnabled();
        }

        @JavascriptInterface
        public String getLastBadge() {
            return lastScannedBadge;
        }
    }
}
