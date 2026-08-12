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
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.util.HashSet;
import java.util.Set;

/**
 * Main activity with NFC foreground dispatch.
 *
 * Reads NFC badges natively and delivers the badge UID to the WebView
 * through multiple mechanisms to ensure the CRAW PWA receives it.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PEC-NFC";
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private IntentFilter[] nfcIntentFilters;
    private Handler mainHandler;
    private String lastScannedBadge = null;

    /**
     * Script injected at document start (API 33+) and via retries.
     * Sets up the NFC bridge so the page can receive badge IDs.
     */
    private static final String NFC_SETUP_JS =
        "(function() {" +
        "  if (window.__pecNfcReady) return;" +
        "  window.__pecNfcReady = true;" +
        // Store last badge for retrieval
        "  window.__pecLastBadge = null;" +
        // Override PecAuth.readNfcBadge if it exists
        "  function tryOverride() {" +
        "    if (typeof PecAuth !== 'undefined') {" +
        "      PecAuth.readNfcBadge = function() {" +
        "        return new Promise(function(resolve) {" +
        "          console.log('[PEC-NFC] readNfcBadge called, waiting for tap...');" +
        "          if (window.__pecLastBadge) {" +
        "            var b = window.__pecLastBadge; window.__pecLastBadge = null;" +
        "            resolve(b); return;" +
        "          }" +
        "          var t = setTimeout(function() { c(); resolve(null); }, 30000);" +
        "          function h(e) { clearTimeout(t); c(); resolve(e.detail.tagId); }" +
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
        "    setTimeout(function() { clearInterval(iv); }, 20000);" +
        "  }" +
        // NDEFReader polyfill
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
        WebView webView = getBridge().getWebView();

        // Expose native bridge (always available, survives navigation)
        webView.addJavascriptInterface(new NfcJsBridge(), "PecNfcNative");

        // API 33+: inject at document start (before page JS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Set<String> origins = new HashSet<>();
            origins.add("*");
            webView.addDocumentStartJavaScript(NFC_SETUP_JS, origins);
            Log.i(TAG, "addDocumentStartJavaScript registered");
        }

        // Also inject with retries
        injectSetupWithRetries();

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
        injectSetupWithRetries();
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
                lastScannedBadge = uid;

                // Show native toast so user KNOWS the scan worked
                runOnUiThread(() ->
                    Toast.makeText(this, "Badge scanned: " + uid, Toast.LENGTH_SHORT).show()
                );

                // Deliver to WebView
                deliverBadgeToWebView(uid);
            }
        }
    }

    /**
     * Deliver the badge UID to the web page using every mechanism available:
     * 1. Custom event (nfc-tag-discovered)
     * 2. Set window.__pecLastBadge for PecAuth.readNfcBadge to pick up
     * 3. Try calling PecAuth.readNfcBadge resolve callback
     * 4. Try filling any visible badge/NFC input fields on the page
     * 5. Show a visible banner on the page with the badge ID
     */
    private void deliverBadgeToWebView(String tagId) {
        WebView webView = getBridge().getWebView();
        String safeId = tagId.replace("'", "\\'");

        String js =
            "(function() {" +
            "  var uid = '" + safeId + "';" +
            "  console.log('[PEC-NFC] Delivering badge: ' + uid);" +
            // Store for later retrieval
            "  window.__pecLastBadge = uid;" +
            // Dispatch custom event
            "  window.dispatchEvent(new CustomEvent('nfc-tag-discovered', {detail:{tagId:uid}}));" +
            // Try calling global NFC callbacks
            "  try { if(window.onNfcRead) window.onNfcRead(uid); } catch(e){}" +
            "  try { if(window.onBadgeScanned) window.onBadgeScanned(uid); } catch(e){}" +
            "  try { if(window.handleNfcTag) window.handleNfcTag(uid); } catch(e){}" +
            "  try { if(typeof PecAuth!=='undefined' && PecAuth.onBadgeScanned) PecAuth.onBadgeScanned(uid); } catch(e){}" +
            // Try to find and fill input fields that look badge-related
            "  var filled = false;" +
            "  var inputs = document.querySelectorAll('input');" +
            "  for(var i=0; i<inputs.length; i++) {" +
            "    var inp = inputs[i];" +
            "    var id = (inp.id||'').toLowerCase();" +
            "    var name = (inp.name||'').toLowerCase();" +
            "    var ph = (inp.placeholder||'').toLowerCase();" +
            "    if(id.indexOf('badge')>=0||id.indexOf('nfc')>=0||id.indexOf('card')>=0||" +
            "       name.indexOf('badge')>=0||name.indexOf('nfc')>=0||name.indexOf('card')>=0||" +
            "       ph.indexOf('badge')>=0||ph.indexOf('scan')>=0) {" +
            "      inp.value = uid;" +
            "      inp.dispatchEvent(new Event('input',{bubbles:true}));" +
            "      inp.dispatchEvent(new Event('change',{bubbles:true}));" +
            "      filled = true;" +
            "    }" +
            "  }" +
            // Show a visible banner at the top of the page
            "  var banner = document.getElementById('pec-nfc-banner');" +
            "  if(!banner) {" +
            "    banner = document.createElement('div');" +
            "    banner.id = 'pec-nfc-banner';" +
            "    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;" +
            "      background:#4CAF50;color:white;padding:12px;text-align:center;" +
            "      font-size:16px;font-weight:bold;box-shadow:0 2px 8px rgba(0,0,0,0.3);';" +
            "    document.body.appendChild(banner);" +
            "  }" +
            "  banner.textContent = '✓ Badge: ' + uid;" +
            "  banner.style.display = 'block';" +
            "  setTimeout(function(){ banner.style.display='none'; }, 5000);" +
            "})();";

        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void injectSetupWithRetries() {
        WebView webView = getBridge().getWebView();
        int[] delays = {0, 300, 700, 1500, 3000, 5000};
        for (int delay : delays) {
            if (delay == 0) {
                webView.post(() -> webView.evaluateJavascript(NFC_SETUP_JS, null));
            } else {
                mainHandler.postDelayed(() ->
                    webView.post(() -> webView.evaluateJavascript(NFC_SETUP_JS, null)), delay);
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
