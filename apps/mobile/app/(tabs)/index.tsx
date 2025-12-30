import { View, Text } from "react-native";
import { Button } from "../../components/ui/button";

export default function MatchesScreen() {
  return (
    <View className="flex-1 bg-background p-4">
      <Text className="text-2xl font-semibold text-foreground">Matches</Text>
      <Text className="mt-2 text-muted-foreground">
        Upload a match video and see events & stats.
      </Text>
      <Button className="mt-4" onPress={() => {}}>
        Upload (stub)
      </Button>
    </View>
  );
}
