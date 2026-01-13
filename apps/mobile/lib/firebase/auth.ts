import {
  initializeAuth,
  signInAnonymously,
  onAuthStateChanged,
  User,
  Persistence,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getFirebaseApp } from "./client";

// Type for getReactNativePersistence (exported from RN build via metro config)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function getReactNativePersistence(storage: any): Persistence;

// Import getReactNativePersistence from firebase/auth (resolved to RN build via metro.config.js)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getReactNativePersistence: getRNPersistence } = require("firebase/auth");

let authInstance: ReturnType<typeof initializeAuth> | null = null;

export function getFirebaseAuth() {
  if (!authInstance) {
    authInstance = initializeAuth(getFirebaseApp(), {
      persistence: getRNPersistence(AsyncStorage),
    });
  }
  return authInstance;
}

export async function ensureAuthenticated(): Promise<User> {
  const auth = getFirebaseAuth();

  // If already signed in, return current user
  if (auth.currentUser) {
    return auth.currentUser;
  }

  // Wait for auth state to be determined
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();

      if (user) {
        resolve(user);
      } else {
        // Sign in anonymously
        try {
          const credential = await signInAnonymously(auth);
          resolve(credential.user);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

export function getCurrentUser(): User | null {
  return getFirebaseAuth().currentUser;
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}
