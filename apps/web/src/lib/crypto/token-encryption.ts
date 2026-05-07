import crypto from "crypto";

/**
 * Validates and converts a 64 hex-character key string to a Buffer.
 */
export function getEncryptionKeyBuffer(keyHex: string): Buffer {
  if (!keyHex || keyHex.trim() === "") {
    throw new Error("Encryption key must not be empty");
  }
  if (keyHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("Encryption key must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypts a token using AES-256-GCM.
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 */
export function encryptToken(token: string, keyHex: string): string {
  const key = getEncryptionKeyBuffer(keyHex);
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(token, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypts a token encrypted with encryptToken.
 * @returns The decrypted plaintext token
 */
export function decryptToken(encryptedToken: string, keyHex: string): string {
  const key = getEncryptionKeyBuffer(keyHex);
  const parts = encryptedToken.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }

  const [ivBase64, authTagBase64, ciphertext] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
