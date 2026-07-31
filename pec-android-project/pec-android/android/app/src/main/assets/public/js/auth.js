/**
 * Authentication: Badge (NFC / manual) + PIN (PBKDF2 client-side).
 * NFC reading is overridden by nfc-native.js for Android.
 */
const PecAuth = (function() {
  let _currentOperator = null;
  const MAX_PIN_ATTEMPTS = 5;
  const COOLDOWN_MS = 60000;
  let _failedAttempts = 0;
  let _cooldownUntil = 0;

  function getCurrentOperator() { return _currentOperator; }
  function setCurrentOperator(op) { _currentOperator = op; }
  function logout() { _currentOperator = null; _failedAttempts = 0; }

  async function findByBadge(badgeUid) {
    const operators = await PecDB.getAll('operators');
    return operators.find(o => o.badgeUid && o.badgeUid.toUpperCase() === badgeUid.toUpperCase()) || null;
  }

  async function findById(operatorId) {
    return await PecDB.get('operators', operatorId);
  }

  async function validatePin(operator, pin) {
    if (Date.now() < _cooldownUntil) {
      return { valid: false, cooldown: true, remainingMs: _cooldownUntil - Date.now() };
    }

    const saltBytes = base64ToBytes(operator.pinSalt);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const computedHash = bytesToBase64(new Uint8Array(derivedBits));

    if (computedHash === operator.pinHash) {
      _failedAttempts = 0;
      return { valid: true };
    } else {
      _failedAttempts++;
      if (_failedAttempts >= MAX_PIN_ATTEMPTS) {
        _cooldownUntil = Date.now() + COOLDOWN_MS;
        _failedAttempts = 0;
        return { valid: false, cooldown: true, remainingMs: COOLDOWN_MS };
      }
      return { valid: false, attemptsRemaining: MAX_PIN_ATTEMPTS - _failedAttempts };
    }
  }

  /**
   * Read NFC badge — Web NFC fallback.
   * This is overridden by nfc-native.js with Android Intent-based NFC.
   */
  async function readNfcBadge() {
    if (!('NDEFReader' in window)) return null;
    try {
      const reader = new NDEFReader();
      await reader.scan();
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 10000);
        reader.onreading = (event) => {
          clearTimeout(timeout);
          resolve(event.serialNumber || null);
        };
        reader.onreadingerror = () => { clearTimeout(timeout); resolve(null); };
      });
    } catch { return null; }
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToBase64(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  return { getCurrentOperator, setCurrentOperator, logout, findByBadge, findById, validatePin, readNfcBadge };
})();
