import { Text } from "react-native";
import { useLoaderData } from "expo-router";

export async function loader() {
  return { message: "LOADER DATA RENDERED" };
}

export default function Page() {
  const data = useLoaderData<typeof loader>();
  return <Text>{data.message}</Text>;
}
