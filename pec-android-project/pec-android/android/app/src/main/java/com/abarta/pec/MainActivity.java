package com.abarta.pec;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.util.HashSet;
import java.util.Set;

/**
 * Main activity with NFC foreground dispatch.
 *
 * Uses addJavascriptInterface to expose a native NFC bridge to any page
 * loaded in the WebView. Also injects a Web NFC (NDEFReader) polyfill
 * that uses the native bridge, so the CRAW PWA works without modification.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PEC-NFC";
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private IntentFilter[] nfcIntentFilters;
    private Handler mainHandler;

    /**
     * NFC bridge injection script.
     * Overrides PecAuth.readNfcBadge (what the CRAW PWA actually calls)
     * to wait for native 'nfc-tag-discovered' events from Android.
     * Also polyfills NDEFReader as a fallback.
     * Idempotent — safe to inject multiple times.
     */
    private static final String NFC_POLYFILL_JS =
        "(function() {" +
        "  if (window.__pecNfcBridgeInstalled) return;" +
        "  window.__pecNfcBridgeInstalled = true;" +
        // Override PecAuth.readNfcBadge — this is what the CRAW PWA calls
        "  function installPecAuthOverride() {" +
        "    if (typeof PecAuth === 'undefined') return false;" +
        "    PecAuth.readNfcBadge = function() {" +
        "      return new Promise(function(resolve) {" +
        "        var timeout = setTimeout(function() { cleanup(); resolve(null); }, 30000);" +
        "        function handler(e) {" +
        "          clearTimeout(timeout);" +
        "          cleanup();" +
        "          var uid = e.detail && e.detail.tagId ? e.detail.tagId : null;" +
        "          console.log('[PEC-NFC] Badge read: ' + uid);" +
        "          resolve(uid);" +
        "        }" +
        "        function cleanup() { window.removeEventListener('nfc-tag-discovered', handler); }" +
        "        window.addEventListener('nfc-tag-discovered', handler);" +
        "        console.log('[PEC-NFC] Waiting for badge tap...');" +
        "      });" +
        "    };" +
        "    console.log('[PEC-NFC] PecAuth.readNfcBadge overridden');" +
        "    return true;" +
        "  }" +
        // Try immediately, then poll every 100ms until PecAuth exists
        "  if (!installPecAuthOverride()) {" +
        "    var iv = setInterval(function() {" +
        "      if (installPecAuthOverride()) clearInterval(iv);" +
        "    }, 100);" +
        "    setTimeout(function() { clearInterval(iv); }, 15000);" +
        "  }" +
        // Also polyfill NDEFReader in case it's checked
        "  if (!window.NDEFReader) {" +
        "    window.NDEFReader = function() {};" +
        "    window.NDEFReader.prototype.scan = function() {" +
        "      var self = this;" +
        "      window.addEventListener('nfc-tag-discovered', function(e) {" +
        "        if (self.onreading) self.onreading({ serialNumber: e.detail.tagId, message: { records: [] } });" +
        "      });" +
        "      return Promise.resolve();" +
        "    };" +
        "  }" +
        "  window.PecNfcAvailable = true;" +
        "  console.log('[PEC-NFC] Bridge script loaded');" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PecNfcPlugin.class);
        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());
        WebView webView = getBridge().getWebView();

        // Expose native NFC bridge via JavascriptInterface (always available, survives navigation)
        webView.addJavascriptInterface(new NfcJsBridge(), "PecNfcNative");

        // API 33+: inject polyfill at document start (before ANY page JS runs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Set<String> origins = new HashSet<>();
            origins.add("*");
            webView.addDocumentStartJavaScript(NFC_POLYFILL_JS, origins);
            Log.i(TAG, "Using addDocumentStartJavaScript for early NFC polyfill");
        }

        // Also inject with retries as fallback (covers API <33 and initial page)
        injectPolyfillWithRetries();

        // Set up NFC adapter
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);
        if (nfcAdapter != null) {
            Intent intent = new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            nfcPendingIntent = PendingIntent.getActivity(
                this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            nfcIntentFilters = new IntentFilter[] {
                new IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED),
                new IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED),
                new IntentFilter(NfcAdapter.ACTION_TECH_DISCOVERED)
            };
            Log.i(TAG, "NFC adapter configured");
        } else {
            Log.w(TAG, "No NFC adapter on this device");
        }

        handleNfcIntent(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, nfcIntentFilters, null);
        }
        // Re-inject polyfill when app comes back to foreground (page may have reloaded)
        injectPolyfillWithRetries();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            nfcAdapter.disableForegroundDispatch(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
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
                dispatchTagToWebView(uid);
            }
        }
    }

    /**
     * Inject polyfill then dispatch the NFC tag event to the WebView.
     */
    private void dispatchTagToWebView(String tagId) {
        WebView webView = getBridge().getWebView();
        // Ensure polyfill is present, then fire the event
        String js = NFC_POLYFILL_JS +
            "window.dispatchEvent(new CustomEvent('nfc-tag-discovered', " +
            "{ detail: { tagId: '" + tagId + "' } }));";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    /**
     * Inject the polyfill multiple times with delays to cover page load timing.
     * On API 33+ addDocumentStartJavaScript handles it, but this is a fallback.
     */
    private void injectPolyfillWithRetries() {
        WebView webView = getBridge().getWebView();
        // Inject at multiple intervals to cover various page load timings
        int[] delays = {0, 250, 500, 1000, 1500, 2500, 4000, 6000};
        for (int delay : delays) {
            if (delay == 0) {
                webView.post(() -> webView.evaluateJavascript(NFC_POLYFILL_JS, null));
            } else {
                mainHandler.postDelayed(() ->
                    webView.post(() -> webView.evaluateJavascript(NFC_POLYFILL_JS, null)), delay);
            }
        }
    }

    private void injectNfcPolyfill() {
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(NFC_POLYFILL_JS, null));
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
     * Native NFC bridge exposed to JavaScript via addJavascriptInterface.
     * Available as window.PecNfcNative in any page loaded in the WebView.
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
    }
}
