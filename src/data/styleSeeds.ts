import type { StyleSeed } from "@/types";

export const STYLE_SEEDS: StyleSeed[] = [
  {
    id: "dreamlike-watercolor",
    name: "Dreamlike Watercolor",
    description: "Soft washes of color, bleeding edges, impressionistic and ethereal",
    promptFragment:
      "soft watercolor painting, bleeding color washes, impressionistic, ethereal luminance, translucent layers, wet-on-wet technique, muted pastels with deep accent tones, dreamlike atmosphere, painterly edges",
    paletteKeywords: ["muted lavender", "soft cerulean", "pale gold", "deep indigo", "warm ivory"],
    previewImage: "/assets/seed-previews/dreamlike-watercolor.jpg",
  },
  {
    id: "dark-ink-shadow",
    name: "Dark Ink & Shadow",
    description: "High-contrast ink illustration with dramatic shadow and fine linework",
    promptFragment:
      "ink illustration, high contrast, deep blacks, fine detailed linework, woodcut texture, dramatic chiaroscuro shadow, engraving style, gothic atmosphere, stark composition, bold silhouettes",
    paletteKeywords: ["deep black", "stark white", "charcoal gray", "aged sepia", "cold silver"],
    previewImage: "/assets/seed-previews/dark-ink-shadow.jpg",
  },
  {
    id: "golden-manuscript",
    name: "Golden Manuscript",
    description: "Illuminated manuscript style with gold leaf accents and ornate warmth",
    promptFragment:
      "illuminated manuscript style, gold leaf accents, ornate decorative borders, warm amber and ochre tones, medieval parchment texture, Byzantine influence, jewel-like color palette, ceremonial composition",
    paletteKeywords: ["deep gold", "warm amber", "rich burgundy", "forest green", "aged parchment"],
    previewImage: "/assets/seed-previews/golden-manuscript.jpg",
  },
  {
    id: "cold-northern-light",
    name: "Cold Northern Light",
    description: "Pale blues and silvers, winter atmosphere, spare Scandinavian minimalism",
    promptFragment:
      "cold northern light, pale blue and silver palette, minimalist composition, winter stillness, Scandinavian aesthetic, sparse negative space, muted tones, frost and ice textures, quiet melancholy",
    paletteKeywords: ["pale blue", "silver", "arctic white", "deep slate", "cold gray"],
    previewImage: "/assets/seed-previews/cold-northern-light.jpg",
  },
  {
    id: "smoke-ember",
    name: "Smoke & Ember",
    description: "Warm orange and deep brown, ash and fire, baroque chiaroscuro",
    promptFragment:
      "warm ember tones, deep burnt sienna and charcoal, smoke and ash textures, baroque chiaroscuro, candlelight atmosphere, dramatic warm shadows, moody and intense, Renaissance painting influence",
    paletteKeywords: ["burnt orange", "deep brown", "ember red", "warm black", "ashen gray"],
    previewImage: "/assets/seed-previews/smoke-ember.jpg",
  },
  {
    id: "pale-surrealism",
    name: "Pale Surrealism",
    description: "Desaturated dreamlike compositions with impossible scale and soft diffused light",
    promptFragment:
      "pale surrealist composition, desaturated muted palette, dreamlike scale distortion, soft diffused light, impossible geometry, quiet uncanny atmosphere, metaphysical stillness, Giorgio de Chirico influence, long shadows",
    paletteKeywords: ["pale cream", "dusty rose", "muted sage", "warm gray", "faded blue"],
    previewImage: "/assets/seed-previews/pale-surrealism.jpg",
  },
];

export const getStyleSeedById = (id: string): StyleSeed | undefined =>
  STYLE_SEEDS.find((s) => s.id === id);
