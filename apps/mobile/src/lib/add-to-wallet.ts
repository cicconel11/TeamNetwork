import { Linking, Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { getWebAppUrl } from "@/lib/web-api";

export type AddToWalletInput = {
  /** Path under /api/wallet/, e.g. `/api/wallet/member/foo` */
  apiPath: string;
  /** Filename to write to the cache directory (without extension). */
  fileBaseName: string;
};

export type AddToWalletResult =
  | { status: "added" }
  | { status: "unsupported_platform" }
  | { status: "unauthenticated" }
  | { status: "error"; message: string };

/**
 * Shared helper: downloads a signed `.pkpass` from the platform API and hands
 * it off to iOS Wallet via `Linking.openURL`. Use one of the typed wrappers
 * (`addMemberCardToWallet`, etc.) rather than calling this directly.
 */
export async function addToWallet(input: AddToWalletInput): Promise<AddToWalletResult> {
  if (Platform.OS !== "ios") {
    return { status: "unsupported_platform" };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { status: "unauthenticated" };
  }

  try {
    const cacheDir = new Directory(Paths.cache, "wallet");
    cacheDir.create({ intermediates: true, idempotent: true });
    const destination = new File(cacheDir, `${input.fileBaseName}.pkpass`);
    if (destination.exists) destination.delete();

    const url = `${getWebAppUrl()}${input.apiPath}`;
    const downloaded = await File.downloadFileAsync(url, destination, {
      headers: { Authorization: `Bearer ${accessToken}` },
      idempotent: true,
    });

    const opened = await Linking.openURL(downloaded.uri);
    if (opened === false) {
      return { status: "error", message: "Could not open the pass in Wallet." };
    }
    return { status: "added" };
  } catch (e) {
    return {
      status: "error",
      message: (e as Error).message || "Could not add the pass to Wallet.",
    };
  }
}
