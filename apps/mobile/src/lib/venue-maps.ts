import * as Linking from "expo-linking";

/** Opens Apple Maps (iOS) or the default maps app with a search query for the venue. */
export async function openVenueInMaps(address: string): Promise<void> {
  const q = encodeURIComponent(address.trim());
  if (!q) return;
  await Linking.openURL(`http://maps.apple.com/?q=${q}`);
}
