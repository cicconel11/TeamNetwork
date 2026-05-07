import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";

export type AppleSignupAgeMetadata = {
  ageBracket: "13_17" | "18_plus";
  isMinor: boolean;
  token: string;
};

export const APPLE_AUTH_CANCELED_CODE = "ERR_REQUEST_CANCELED";

export function isAppleAuthCanceled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === APPLE_AUTH_CANCELED_CODE
  );
}

export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") {
    return false;
  }

  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch (error) {
    captureException(error as Error, { context: "isAppleAuthAvailable" });
    return false;
  }
}

export async function signInWithApple() {
  return authenticateWithApple({ metadataRequired: false });
}

export async function signUpWithApple(ageMetadata: AppleSignupAgeMetadata) {
  const result = await authenticateWithApple({
    extraMetadata: {
      age_bracket: ageMetadata.ageBracket,
      is_minor: ageMetadata.isMinor,
      age_validation_token: ageMetadata.token,
    },
    metadataRequired: true,
  });

  return result;
}

async function authenticateWithApple({
  extraMetadata,
  metadataRequired,
}: {
  extraMetadata?: Record<string, unknown>;
  metadataRequired: boolean;
}) {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token. Please try again.");
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) {
    throw error;
  }

  const metadata = {
    ...buildAppleNameMetadata(credential.fullName),
    ...extraMetadata,
  };

  if (Object.keys(metadata).length > 0) {
    const { error: updateError } = await supabase.auth.updateUser({ data: metadata });
    if (updateError) {
      captureException(new Error(updateError.message), {
        context: "authenticateWithApple.updateUser",
      });

      if (metadataRequired) {
        await supabase.auth.signOut();
        throw new Error("Could not save age verification. Please try again.");
      }
    }
  }

  return data;
}

function buildAppleNameMetadata(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null
): Record<string, string> {
  if (!fullName) {
    return {};
  }

  const formattedName = AppleAuthentication.formatFullName(fullName, "default").trim();
  const givenName = fullName.givenName?.trim();
  const familyName = fullName.familyName?.trim();

  const metadata: Record<string, string> = {};
  if (formattedName) {
    metadata.full_name = formattedName;
    metadata.name = formattedName;
  }
  if (givenName) {
    metadata.given_name = givenName;
    metadata.first_name = givenName;
  }
  if (familyName) {
    metadata.family_name = familyName;
    metadata.last_name = familyName;
  }

  return metadata;
}
