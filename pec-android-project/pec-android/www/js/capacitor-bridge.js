/**
 * Capacitor Bridge — provides native Android APIs to the PEC app.
 * Manages: server URL storage, device token, native camera, platform detection.
 *
 * The app loads the remote CRAW PWA at /pec/handheld/ in the WebView.
 * This bridge handles first-run configuration and native feature access.
 */
const PecNative = (function() {
  'use strict';

  const isNative = (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform());
  let _serverUrl = '';   // e.g. https://biapps01.abarta.com:8443/pec
  let _deviceToken = '';

  async function init() {
    if (isNative) {
      try {
        const { Preferences } = Capacitor.Plugins;
        const urlRes = await Preferences.get({ key: 'server_url' });
        if (urlRes.value) _serverUrl = urlRes.value;
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
          StatusBar.setStyle({ style: 'DARK' });
        }
      } catch(e) {}
    }
    console.log('[PecNative] isNative:', isNative, 'serverUrl:', _serverUrl || '(not configured)');
  }

  function isConfigured() { return !!_serverUrl && !!_deviceToken; }
  function getServerUrl() { return _serverUrl; }
  function getDeviceToken() { return _deviceToken; }
  function isNativeApp() { return isNative; }

  /** Build the full handheld PWA URL with token for first auth */
  function getHandheldUrl() {
    const base = _serverUrl.replace(/\/+$/, '');
    return base + '/handheld/?token=' + encodeURIComponent(_deviceToken);
  }

  async function setServerUrl(url) {
    _serverUrl = url.replace(/\/+$/, '');
    if (isNative) {
      await Capacitor.Plugins.Preferences.set({ key: 'server_url', value: _serverUrl });
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
    return null;
  }

  return { init, isConfigured, getServerUrl, setServerUrl, getDeviceToken, setDeviceToken, getHandheldUrl, takePhoto, isNativeApp };
})();
