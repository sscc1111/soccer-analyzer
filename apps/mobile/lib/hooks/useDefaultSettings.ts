import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DefaultSettings } from "@soccer/shared";

const STORAGE_KEY = "@soccer/defaultSettings";

// Re-export type for convenience
export type { DefaultSettings } from "@soccer/shared";

type UseDefaultSettingsResult = {
  settings: DefaultSettings;
  loading: boolean;
  updateSettings: (updates: Partial<DefaultSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
};

export function useDefaultSettings(): UseDefaultSettingsResult {
  const [settings, setSettings] = useState<DefaultSettings>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSettings(JSON.parse(stored));
      }
    } catch (err) {
      console.error("Failed to load default settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = useCallback(
    async (updates: Partial<DefaultSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      } catch (err) {
        console.error("Failed to save default settings:", err);
        throw err;
      }
    },
    [settings]
  );

  const resetSettings = useCallback(async () => {
    setSettings({});
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to reset default settings:", err);
      throw err;
    }
  }, []);

  return { settings, loading, updateSettings, resetSettings };
}

// Helper to get default settings synchronously (for initial match creation)
export async function getDefaultSettings(): Promise<DefaultSettings> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}
