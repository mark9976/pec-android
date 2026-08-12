package com.abarta.pec;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

/**
 * Main activity with NFC foreground dispatch and Web NFC polyfill injection.
 *
 * When an NFC tag is tapped while the app is in the foreground, Android
 * delivers the intent here. We extract the tag UID and push it into the
 * WebView via a JavaScript custom event so the web layer can handle it.
 *
 * We also inject a Web NFC (NDEFReader) polyfill into every page loaded
 * in the WebView, so that the CRAW PWA's Web NFC code works transparently
 * with Android's native NFC intents.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PEC-NFC";
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private IntentFilter[] nfcIntentFilters;

    /** Web NFC polyfill — makes NDEFReader work via native nfc-tag-discovered events */
    private static final String NFC_POLYFILL_JS =
        "(function() {" +
        "  if (window.__pecNfcPolyfillInstalled) return;" +
        "  window.__pecNfcPolyfillInstalled = true;" +
        "  window.NDEFReader = class NDEFReader {" +
        "    constructor() { this.onreading = null; this.onreadingerror = null; }" +
        "    async scan() {" +
        "      this._listener = (e) => {" +
        "        if (this.onreading) {" +
        "          this.onreading({ serialNumber: e.detail.tagId, message: { records: [] } });" +
        "        }" +
        "      };" +
        "      window.addEventListener('nfc-tag-discovered', this._listener);" +
        "      return Promise.resolve();" +
        "    }" +
        "  };" +
        "  console.log('[PEC] Web NFC polyfill installed');" +
        "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the custom NFC Capacitor plugin
        registerPlugin(PecNfcPlugin.class);

        super.onCreate(savedInstanceState);

        // Inject NFC polyfill on every page load
        WebView webView = getBridge().getWebView();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(NFC_POLYFILL_JS, null);
                Log.i(TAG, "NFC polyfill injected for: " + url);
            }
        });

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

            Log.i(TAG, "NFC adapter found and configured");
        } else {
            Log.w(TAG, "No NFC adapter available on this device");
        }

        // Handle NFC intent if the app was launched by tapping a tag
        handleNfcIntent(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfcAdapter != null) {
            nfcAdapter.enableForegroundDispatch(this, nfcPendingIntent, nfcIntentFilters, null);
        }
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

    /**
     * Extract the tag UID from an NFC intent and dispatch it to the WebView.
     */
    private void handleNfcIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (NfcAdapter.ACTION_TAG_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) ||
            NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)) {

            Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
            if (tag != null) {
                String uid = bytesToHex(tag.getId());
                Log.i(TAG, "NFC tag detected, UID: " + uid);
                dispatchTagToWebView(uid);
            }
        }
    }

    /**
     * Send the tag UID to the WebView via a custom DOM event.
     * The nfc-native.js module listens for 'nfc-tag-discovered'.
     */
    private void dispatchTagToWebView(String tagId) {
        String js = "window.dispatchEvent(new CustomEvent('nfc-tag-discovered', " +
                    "{ detail: { tagId: '" + tagId + "' } }));";
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(js, null)
        );
    }

    /**
     * Convert raw tag ID bytes to colon-separated uppercase hex.
     * e.g. {0x04, 0x33, 0x15} → "04:33:15"
     */
    private static String bytesToHex(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(':');
            sb.append(String.format("%02X", bytes[i]));
        }
        return sb.toString();
    }
}
