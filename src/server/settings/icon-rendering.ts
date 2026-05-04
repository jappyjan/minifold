import sharp from "sharp";

export async function resizeAny(
  input: Buffer,
  size: 180 | 192 | 512,
): Promise<Buffer> {
  return sharp(input)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export async function composeMaskable(
  input: Buffer,
  accentHex: string,
): Promise<Buffer> {
  const SIZE = 512;
  const SAFE = Math.round(SIZE * 0.7); // 70% safe zone per Android maskable spec
  const inset = Math.round((SIZE - SAFE) / 2);

  const logo = await sharp(input)
    .resize(SAFE, SAFE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: accentHex,
    },
  })
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toBuffer();
}
