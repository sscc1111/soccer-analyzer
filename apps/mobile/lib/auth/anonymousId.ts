import AsyncStorage from "@react-native-async-storage/async-storage";

const ANONYMOUS_ID_KEY = "@soccer_analyzer/anonymous_user_id";

function generateId(): string {
  return `anon_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

let cachedId: string | null = null;

export async function getAnonymousUserId(): Promise<string> {
  if (cachedId) return cachedId;

  try {
    const stored = await AsyncStorage.getItem(ANONYMOUS_ID_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // AsyncStorage not available, fallback to in-memory
  }

  const newId = generateId();
  cachedId = newId;

  try {
    await AsyncStorage.setItem(ANONYMOUS_ID_KEY, newId);
  } catch {
    // Ignore storage errors
  }

  return newId;
}
