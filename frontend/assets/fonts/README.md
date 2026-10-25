# Fonts for share images

The route pages' share images are drawn on the server with `next/og`, which can't load the site's web fonts, so the
fonts it needs are kept here as files. All four are under the SIL Open Font License 1.1 (the `OFL-*.txt` files).

- `HermesCormorant-SemiBold.ttf` and `HermesCormorant-MediumItalic.ttf`: Cormorant Garamond with lining figures made
  the default (each digit points at its `.lf` glyph) and renamed, since the image renderer can't turn on `lnum` and
  "Project 0" would read as "Project o".
- `Cinzel-Bold.ttf`, `Inter-Medium.ttf`: unchanged, from Google Fonts.
