/**
 * Capacitor Bridge — provides native Android APIs to the PEC app.
 * Manages: API base URL storage, native camera, platform detection.
 */
const PecNative = (function() {
  'use strict';

  const isNative = (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform());
  let _apiBase = '';
  let _deviceToken = '';

  async function init() {
    if (isNative) {
      try {
        const { Preferences } = Capacitor.Plugins;
        const baseRes = await Preferences.get({ key: 'api_base_url' });
        if (baseRes.value) _apiBase = baseRes.value;
        const tokenRes = await Preferences.get({ key: 'device_token' });
        if (tokenRes.value) _deviceToken = tokenRes.value;
      } catch(e) {
        console.warn('[PecNative] Preferences read error:', e);
      }

      // Style the status bar
      try {
        const { StatusBar } = Capacitor.Plugins;
        if (StatusBar) {
          StatusBar.setBackgroundColor({ color: '#1e3a5f' });
          StatusBar.setStyle({ style: 'DARK' }); // light text
        }
      } catch(e) {}
    }
    console.log('[PecNative] isNative:', isNative, 'apiBase:', _apiBase || '(not configured)');
  }

  function isConfigured() { return !!_apiBase; }
  function getApiBase() { return _apiBase; }
  function getDeviceToken() { return _deviceToken; }
  function isNativeApp() { return isNative; }

  async function setApiBase(url) {
    _apiBase = url.replace(/\/+$/, ''); // strip trailing slash
    if (isNative) {
      await Capacitor.Plugins.Preferences.set({ key: 'api_base_url', value: _apiBase });
    }
  }

  async function setDeviceToken(token) {
    _deviceToken = token;
    if (isNative) {
      await Capacitor.Plugins.Preferences.set({ key: 'device_token', value: _deviceToken });
    }
  }

  /**
   * Take a photo using native camera.
   * Returns { dataUrl: string } or null on cancel/error.
   */
  async function takePhoto() {
    if (isNative && Capacitor.Plugins.Camera) {
      try {
        const photo = await Capacitor.Plugins.Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: 'base64',
          source: 'CAMERA',
          saveToGallery: false
        });
        return {
          dataUrl: 'data:image/' + (photo.format || 'jpeg') + ';base64,' + photo.base64String,
          fileName: 'failure_photo_' + Date.now() + '.' + (photo.format || 'jpeg')
        };
      } catch(e) {
        console.warn('[PecNative] Camera error:', e);
        return null;
      }
    }
    return null; // Fallback to HTML file input in app.js
  }

  return { init, isConfigured, getApiBase, setApiBase, getDeviceToken, setDeviceToken, takePhoto, isNativeApp };
})();
