import sharp from "sharp"
import type { ImageResponse } from "next/og"

// Share images go out as JPEG. next/og draws PNG, and with the fresco in it a card is about 560 KB: WhatsApp leaves out
// a preview image over about 300 KB, so a link showed no picture there. The same card as a JPEG is a fifth of that.
export async function asJpeg(image: ImageResponse): Promise<Response> {
  const png = Buffer.from(await image.arrayBuffer())
  const jpeg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
  return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg" } })
}
