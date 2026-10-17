import type { ConfigContext, ExpoConfig } from 'expo/config';

// Config nativa de la app. Todo plugin nativo del finde va acá desde el primer dev build
// (cada rebuild nativo cuesta 15–25 min). Las EXPO_PUBLIC_* se leen de apps/mobile/.env.

const IOS_URL_SCHEME_PLACEHOLDER = 'com.googleusercontent.apps.placeholder';

/** iOS URL scheme de Google = client id de iOS invertido. */
function googleIosUrlScheme(): string {
  const explicit = process.env.GOOGLE_IOS_URL_SCHEME;
  if (explicit) return explicit;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  // "1234-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.1234-abc"
  if (iosClientId && iosClientId.endsWith('.apps.googleusercontent.com')) {
    return `com.googleusercontent.apps.${iosClientId.replace('.apps.googleusercontent.com', '')}`;
  }
  return IOS_URL_SCHEME_PLACEHOLDER;
}

const PERMS = {
  locationWhenInUse: 'Usamos tu ubicación para mostrarte en el mapa y que el guía sepa dónde estás.',
  locationAlways:
    'Usamos tu ubicación también en segundo plano para que el guía te avise cuando llegás a una parada del tour, aunque tengas el celu en el bolsillo.',
  microphone: 'Usamos el micrófono para que puedas hablar con tu guía de viaje.',
  camera: 'Usamos la cámara para que le muestres al guía lo que estás mirando.',
  photos: 'Usamos tus fotos para sumarlas al diario del viaje o leer un ticket.',
  motion: 'Usamos el sensor de movimiento para saber si estás caminando durante el tour.',
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Compañero',
  slug: 'build101',
  scheme: 'build101',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'dev.build101.companion',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: PERMS.locationWhenInUse,
      NSLocationAlwaysAndWhenInUseUsageDescription: PERMS.locationAlways,
      NSMicrophoneUsageDescription: PERMS.microphone,
      NSCameraUsageDescription: PERMS.camera,
      NSPhotoLibraryUsageDescription: PERMS.photos,
      UIBackgroundModes: ['audio', 'location'],
    },
  },
  android: {
    package: 'dev.build101.companion',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.CAMERA',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    [
      'expo-location',
      {
        locationWhenInUsePermission: PERMS.locationWhenInUse,
        locationAlwaysAndWhenInUsePermission: PERMS.locationAlways,
        motionUsagePermission: PERMS.motion,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-task-manager',
    [
      'expo-camera',
      {
        cameraPermission: PERMS.camera,
        microphonePermission: PERMS.microphone,
        recordAudioAndroid: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: PERMS.photos,
        cameraPermission: PERMS.camera,
        microphonePermission: PERMS.microphone,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission: PERMS.microphone,
        enableBackgroundPlayback: true,
        enableBackgroundRecording: true,
      },
    ],
    ['expo-notifications', { color: '#1F6FEB' }],
    // Mapbox SDK v11 (default de @rnmapbox/maps 10.3). El token público se pasa en runtime (EXPO_PUBLIC_MAPBOX_TOKEN).
    '@rnmapbox/maps',
    [
      '@config-plugins/react-native-webrtc',
      { cameraPermission: PERMS.camera, microphonePermission: PERMS.microphone },
    ],
    ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme() }],
    'expo-sharing',
    'expo-web-browser',
  ],
  extra: {
    ...config.extra,
  },
});
