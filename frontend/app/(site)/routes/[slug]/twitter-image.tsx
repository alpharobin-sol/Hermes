// The same image for X cards. Segment settings must be written out here, not re-exported.
import Image, { alt, contentType, size } from "./opengraph-image"

export const revalidate = 60
export async function generateStaticParams() {
  return []
}
export { alt, contentType, size }
export default Image
