import { Platform } from "react-native";
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

type ExpoSharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (
    url: string,
    options?: { UTI?: string; mimeType?: string }
  ) => Promise<void>;
};

async function loadSharing(): Promise<ExpoSharingModule | null> {
  try {
    return await import("expo-sharing");
  } catch {
    return null;
  }
}

/**
 * Shared helper: downloads a signed `.pkpass` from the platform API and presents
 * it to iOS Wallet. iOS cannot open a local `.pkpass` `file://` URL via
 * `Linking.openURL` — passes must go through PassKit/QuickLook — so we hand the
 * downloaded file to the system share sheet (`Sharing.shareAsync` with the
 * `com.apple.pkpass` UTI), which previews the pass with an "Add" affordance.
 * Use one of the typed wrappers (`addMemberCardToWallet`, etc.) rather than
 * calling this directly.
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
    const Sharing = await loadSharing();
    if (!Sharing) {
      return {
        status: "error",
        message: "This development build needs to be rebuilt before Wallet sharing is available.",
      };
    }

    const cacheDir = new Directory(Paths.cache, "wallet");
    cacheDir.create({ intermediates: true, idempotent: true });
    const destination = new File(cacheDir, `${input.fileBaseName}.pkpass`);
    if (destination.exists) destination.delete();

    const url = `${getWebAppUrl()}${input.apiPath}`;
    const downloaded = await File.downloadFileAsync(url, destination, {
      headers: { Authorization: `Bearer ${accessToken}` },
      idempotent: true,
    });

    if (!(await Sharing.isAvailableAsync())) {
      return { status: "error", message: "Sharing is not available on this device." };
    }

    // Resolves when the sheet is dismissed; iOS routes `.pkpass` to the Wallet
    // "Add" preview. We can't observe whether the user tapped Add, so treat a
    // successfully presented sheet as success.
    await Sharing.shareAsync(downloaded.uri, {
      UTI: "com.apple.pkpass",
      mimeType: "application/vnd.apple.pkpass",
    });
    return { status: "added" };
  } catch (e) {
    return {
      status: "error",
      message: (e as Error).message || "Could not add the pass to Wallet.",
    };
  }
}
