import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element -- Satori rasterizes for Apple touch icon
      <img src={src} width={180} height={180} alt="" />
    ),
    { ...size },
  );
}
