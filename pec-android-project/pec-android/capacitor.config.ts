import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abarta.pec',
  appName: 'Power Equipment Checkout',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    // Allow the WebView to navigate to any configured server without opening external browser
    allowNavigation: ['*'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#1e3a5f',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'dark',          // light icons on dark bar
      backgroundColor: '#1e3a5f'
    },
    Camera: {
      promptLabelPhoto: 'Take Photo',
      promptLabelPicture: 'Choose from Gallery'
    },
    CapacitorHttp: {
      enabled: true           // Route fetch() through native HTTP (bypasses CORS + uses system SSL trust)
    }
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#1e3a5f'
  }
};

export default config;
