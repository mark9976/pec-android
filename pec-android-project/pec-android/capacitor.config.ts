import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abarta.pec',
  appName: 'Power Equipment Checkout',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    // To point at a remote CRAW server instead of bundled assets, uncomment:
    // url: 'https://your-craw-host/pec/handheld/',
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
    }
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#1e3a5f'
  }
};

export default config;
