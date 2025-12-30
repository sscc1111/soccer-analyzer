import { View, Text } from "react-native";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

export default function SettingsScreen() {
  return (
    <View className="flex-1 bg-background p-4">
      <Card>
        <CardHeader>
          <CardTitle>Accuracy Boosters</CardTitle>
        </CardHeader>
        <CardContent>
          <Text className="text-muted-foreground">
            Camera position/direction, attack direction, team colors, formation, jersey numbers...
          </Text>
        </CardContent>
      </Card>
    </View>
  );
}
