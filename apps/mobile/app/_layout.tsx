import "../global.css";
import { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { isExpoGo } from "../lib/expo-go-guard";
import { useNotifications, useAuth } from "../lib/hooks";
import { clearBadge } from "../lib/notifications";

export default function RootLayout() {
  const { register } = useNotifications();
  const { loading, error } = useAuth();

  // Initialize notifications on app start (skip in Expo Go)
  useEffect(() => {
    if (isExpoGo) {
      console.log("[Expo Go] Skipping notification initialization");
      return;
    }

    const initNotifications = async () => {
      // Register for push notifications
      await register();
      // Clear badge when app opens
      await clearBadge();
    };

    initNotifications();
  }, [register]);

  // Show loading screen while authenticating
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={{ color: "#888", marginTop: 16 }}>Initializing...</Text>
      </View>
    );
  }

  // Show error if authentication failed
  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000", padding: 20 }}>
        <Text style={{ color: "#f00", fontSize: 16, textAlign: "center" }}>
          Authentication Error: {error.message}
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
