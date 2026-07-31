package com.abarta.pec;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Minimal Capacitor plugin for NFC state control.
 *
 * The actual NFC tag reading is handled by MainActivity's foreground dispatch.
 * This plugin just lets the web layer signal that it's ready to receive a tag
 * (for UI feedback) and check NFC availability.
 */
@CapacitorPlugin(name = "PecNfc")
public class PecNfcPlugin extends Plugin {

    @PluginMethod()
    public void startListening(PluginCall call) {
        // Foreground dispatch is always active while the activity is resumed.
        // This method exists so the web layer can know it was acknowledged.
        call.resolve();
    }

    @PluginMethod()
    public void stopListening(PluginCall call) {
        call.resolve();
    }

    @PluginMethod()
    public void isAvailable(PluginCall call) {
        android.nfc.NfcAdapter adapter = android.nfc.NfcAdapter.getDefaultAdapter(getContext());
        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
        result.put("available", adapter != null);
        result.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(result);
    }
}
