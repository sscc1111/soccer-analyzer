import { initializeApp, getApps } from "firebase/app";
import Constants from "expo-constants";

function getFirebaseConfig() {
  const extra: any = Constants.expoConfig?.extra ?? {};

  // Use env vars or fallback to demo project for development
  const config = {
    apiKey: extra.firebaseApiKey || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
    authDomain: extra.firebaseAuthDomain || process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
    projectId: extra.firebaseProjectId || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
    storageBucket: extra.firebaseStorageBucket || process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo-project.appspot.com",
    messagingSenderId: extra.firebaseMessagingSenderId || process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
    appId: extra.firebaseAppId || process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:000000000000",
  };

  return config;
}

export function getFirebaseApp() {
  if (getApps().length) return getApps()[0]!;
  return initializeApp(getFirebaseConfig());
}
