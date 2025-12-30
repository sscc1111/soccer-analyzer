import { View, Text, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { Card, CardContent, CardHeader, CardTitle, Button } from "../../components/ui";

export default function AppSettingsScreen() {
  return (
    <ScrollView className="flex-1 bg-background">
      <View className="p-4">
        <Text className="text-2xl font-semibold text-foreground mb-6">
          Settings
        </Text>

        {/* App Info */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted-foreground">App Version</Text>
              <Text className="text-foreground">0.0.1</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-muted-foreground">Pipeline Version</Text>
              <Text className="text-foreground">v1</Text>
            </View>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Match-specific settings (camera, colors, roster) are available in each match's settings page.
            </Text>
            <Button
              variant="outline"
              onPress={() => router.push("/")}
            >
              Go to Matches
            </Button>
          </CardContent>
        </Card>

        {/* Data Management */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              All match data is synced with Firebase and available across devices.
            </Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted-foreground">Storage</Text>
              <Text className="text-foreground">Firebase Storage</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-muted-foreground">Database</Text>
              <Text className="text-foreground">Cloud Firestore</Text>
            </View>
          </CardContent>
        </Card>

        {/* Help */}
        <Card>
          <CardHeader>
            <CardTitle>Help & Support</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground">
              For best results, record matches from the sideline at mid-field height. Ensure good lighting and stable camera position.
            </Text>
          </CardContent>
        </Card>
      </View>
    </ScrollView>
  );
}
