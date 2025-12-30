import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "rgb(10, 10, 10)" },
        headerTintColor: "rgb(245, 245, 245)",
        tabBarStyle: { backgroundColor: "rgb(10, 10, 10)", borderTopColor: "rgb(45, 45, 45)" },
        tabBarActiveTintColor: "rgb(99, 102, 241)",
        tabBarInactiveTintColor: "rgb(170, 170, 170)",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Matches",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚽</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
