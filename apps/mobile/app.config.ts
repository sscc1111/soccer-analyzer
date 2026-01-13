import "dotenv/config";

export default {
  name: "SoccerAnalyzer",
  slug: "soccer-analyzer",
  scheme: "socceranalyzer",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  splash: {
    backgroundColor: "#111827",
  },
  ios: {
    bundleIdentifier: "com.sscc.soccer-analyzer",
    supportsTablet: true,
    infoPlist: {
      UIBackgroundModes: ["remote-notification"],
      NSLocalNetworkUsageDescription:
        "This app uses the local network to connect to the Metro development server.",
      NSBonjourServices: ["_expo._tcp."],
    },
  },
  android: {
    package: "com.sscc.socceranalyzer",
    adaptiveIcon: {
      backgroundColor: "#111827",
    },
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || "./google-services.json",
  },
  plugins: [
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#6366F1",
        sounds: ["./assets/sounds/notification.wav"],
        defaultChannel: "analysis",
      },
    ],
  ],
  extra: {
    firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
};
