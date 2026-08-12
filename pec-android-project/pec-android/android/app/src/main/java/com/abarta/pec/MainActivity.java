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
    private static final String BUILD_VERSION = "2026.08.12-E";
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
        String combined = NFC_SETUP_JS + versionJs;

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
