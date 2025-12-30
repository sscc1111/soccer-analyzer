import { initializeApp, getApps } from "firebase/app";
import Constants from "expo-constants";

function getFirebaseConfig() {
  const extra: any = Constants.expoConfig?.extra ?? {};
  return {
    apiKey: extra.firebaseApiKey,
    authDomain: extra.firebaseAuthDomain,
    projectId: extra.firebaseProjectId,
    storageBucket: extra.firebaseStorageBucket,
    messagingSenderId: extra.firebaseMessagingSenderId,
    appId: extra.firebaseAppId,
  };
}

export function getFirebaseApp() {
  if (getApps().length) return getApps()[0]!;
  return initializeApp(getFirebaseConfig());
}
