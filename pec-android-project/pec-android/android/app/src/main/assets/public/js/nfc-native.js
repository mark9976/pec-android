/**
 * NFC Native Bridge for Android.
 *
 * Android NFC works via Intents, not the Web NFC API. When the user taps a
 * tag while the app is in the foreground, the native MainActivity (with
 * foreground dispatch) intercepts the Intent and posts the tag UID to the
 * WebView via a custom event: 'nfc-tag-discovered'.
 *
 * This module overrides PecAuth.readNfcBadge to listen for that event
 * and also checks for a registered Capacitor NFC plugin as a fallback.
 */
(function() {
  'use strict';

  const TAG_TIMEOUT_MS = 20000; // how long to wait for a tap
  const originalReadNfc = PecAuth.readNfcBadge;

  // Track whether NFC is currently waiting for a tap
  let _waitingForNfc = false;

  /**
   * Format raw byte array to colon-separated hex UID.
   * e.g. [4, 51, 21, 162, 129, 24, 144] → "04:33:15:A2:81:18:90"
   */
  function bytesToHexUid(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  }

  /**
   * readNfcBadge — Android version.
   * Waits for the native side to dispatch 'nfc-tag-discovered' with
   * { detail: { tagId: "04:33:15:..." } }
   */
  async function readNfcBadgeNative() {
    if (_waitingForNfc) return null;
    _waitingForNfc = true;

    // Enable foreground dispatch on the native side
    try {
      if (typeof Capacitor !== 'undefined' && Capacitor.Plugins.PecNfc) {
        await Capacitor.Plugins.PecNfc.startListening();
      }
    } catch(e) {
      console.warn('[NFC] Could not start native listener:', e);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, TAG_TIMEOUT_MS);

      function handler(event) {
        clearTimeout(timeout);
        cleanup();
        const uid = event.detail?.tagId || null;
        console.log('[NFC] Tag detected:', uid);
        resolve(uid);
      }

      function cleanup() {
        _waitingForNfc = false;
        window.removeEventListener('nfc-tag-discovered', handler);
        try {
          if (typeof Capacitor !== 'undefined' && Capacitor.Plugins.PecNfc) {
            Capacitor.Plugins.PecNfc.stopListening();
          }
        } catch(e) {}
      }

      window.addEventListener('nfc-tag-discovered', handler);
    });
  }

  // Override the auth module's NFC reader
  PecAuth.readNfcBadge = readNfcBadgeNative;

  // Also expose a helper for the app to check NFC availability
  window.PecNfcAvailable = true;

  console.log('[NFC] Android NFC bridge installed');
})();
