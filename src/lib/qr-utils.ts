import QRCode from "qrcode";

type QRResult =
  | { svg: string; error: null }
  | { svg: null; error: string };

export async function generateQRSvg(
  url: string,
  size: number = 200,
  margin: number = 4
): Promise<QRResult> {
  if (!url?.trim()) {
    return { svg: null, error: "No URL provided" };
  }

  try {
    const svg = await QRCode.toString(url, {
      type: "svg",
      width: size,
      margin,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    });
    return { svg, error: null };
  } catch {
    return { svg: null, error: "Failed to generate QR code" };
  }
}
