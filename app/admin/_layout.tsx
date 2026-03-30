import { Stack } from "expo-router";

/** Admin routes: separate stack, headers off (each screen owns its chrome). */
export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
