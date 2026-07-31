package com.abarta.pec;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

/**
 * Main activity with NFC foreground dispatch.
 *
 * When an NFC tag is tapped while the app is in the foreground, Android
 * delivers the intent here. We extract the tag UID and push it into the
 * WebView via a JavaScript custom event so the web layer can handle it.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "PEC-NFC";
    private NfcAdapter nfcAdapter;
    private PendingIntent nfcPendingIntent;
    private IntentFilter[] nfcIntentFilters;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the custom NFC Capacitor plugin
        registerPlugin(PecNfcPlugin.class);

        super.onCreate(savedInstanceState);

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
