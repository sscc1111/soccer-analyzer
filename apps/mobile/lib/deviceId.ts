import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_ID_KEY = "@soccer_analyzer_device_id";

let cachedDeviceId: string | null = null;

/**
 * Get or generate a persistent device ID.
 * This ID persists across app restarts and Firebase auth changes.
 */
export async function getDeviceId(): Promise<string> {
  // Return cached value if available
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  // Try to get from AsyncStorage
  const storedId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (storedId) {
    cachedDeviceId = storedId;
    return storedId;
  }

  // Generate new device ID
  const newId = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
  cachedDeviceId = newId;
  return newId;
}

/**
 * Generate a unique device ID using random values
 */
function generateDeviceId(): string {
  // Generate a UUID-like string using Math.random()
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(Math.random().toString(36).substring(2, 10));
  }
  return `device_${segments.join("-")}`;
}

/**
 * Get device ID synchronously (only works after first async call)
 * Returns null if not yet initialized
 */
export function getDeviceIdSync(): string | null {
  return cachedDeviceId;
}

/**
 * Clear device ID (for testing or reset purposes)
 */
export async function clearDeviceId(): Promise<void> {
  await AsyncStorage.removeItem(DEVICE_ID_KEY);
  cachedDeviceId = null;
}
