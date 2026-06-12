import type { StyleSeed } from "@/types";

export const STYLE_SEEDS: StyleSeed[] = [
  {
    id: "dreamlike-watercolor",
    name: "Dreamlike Watercolor",
    description: "Soft washes of color, bleeding edges, impressionistic and ethereal",
    promptFragment:
      "soft watercolor painting, bleeding color washes, impressionistic, ethereal luminance, translucent layers, wet-on-wet technique, muted pastels with deep accent tones, dreamlike atmosphere, painterly edges",
    paletteKeywords: ["muted lavender", "soft cerulean", "pale gold", "deep indigo", "warm ivory"],
    previewImage: "/assets/seed-previews/dreamlike-watercolor.svg",
  },
  {
    id: "dark-ink-shadow",
    name: "Dark Ink & Shadow",
    description: "High-contrast ink illustration with dramatic shadow and fine linework",
    promptFragment:
      "ink illustration, high contrast, deep blacks, fine detailed linework, woodcut texture, dramatic chiaroscuro shadow, engraving style, gothic atmosphere, stark composition, bold silhouettes",
    paletteKeywords: ["deep black", "stark white", "charcoal gray", "aged sepia", "cold silver"],
    previewImage: "/assets/seed-previews/dark-ink-shadow.svg",
  },
  {
    id: "golden-manuscript",
    name: "Golden Manuscript",
    description: "Illuminated manuscript style with gold leaf accents and ornate warmth",
    promptFragment:
      "illuminated manuscript style, gold leaf accents, ornate decorative borders, warm amber and ochre tones, medieval parchment texture, Byzantine influence, jewel-like color palette, ceremonial composition",
    paletteKeywords: ["deep gold", "warm amber", "rich burgundy", "forest green", "aged parchment"],
    previewImage: "/assets/seed-previews/golden-manuscript.svg",
  },
  {
    id: "cold-northern-light",
    name: "Cold Northern Light",
    description: "Pale blues and silvers, winter atmosphere, spare Scandinavian minimalism",
    promptFragment:
      "cold northern light, pale blue and silver palette, minimalist composition, winter stillness, Scandinavian aesthetic, sparse negative space, muted tones, frost and ice textures, quiet melancholy",
    paletteKeywords: ["pale blue", "silver", "arctic white", "deep slate", "cold gray"],
    previewImage: "/assets/seed-previews/cold-northern-light.svg",
  },
  {
    id: "smoke-ember",
    name: "Smoke & Ember",
    description: "Warm orange and deep brown, ash and fire, baroque chiaroscuro",
    promptFragment:
      "warm ember tones, deep burnt sienna and charcoal, smoke and ash textures, baroque chiaroscuro, candlelight atmosphere, dramatic warm shadows, moody and intense, Renaissance painting influence",
    paletteKeywords: ["burnt orange", "deep brown", "ember red", "warm black", "ashen gray"],
    previewImage: "/assets/seed-previews/smoke-ember.svg",
  },
  {
    id: "pale-surrealism",
    name: "Pale Surrealism",
    description: "Desaturated dreamlike compositions with impossible scale and soft diffused light",
    promptFragment:
      "pale surrealist composition, desaturated muted palette, dreamlike scale distortion, soft diffused light, impossible geometry, quiet uncanny atmosphere, metaphysical stillness, Giorgio de Chirico influence, long shadows",
    paletteKeywords: ["pale cream", "dusty rose", "muted sage", "warm gray", "faded blue"],
    previewImage: "/assets/seed-previews/pale-surrealism.svg",
  },

  // ── Photorealistic / Flux-optimized styles ─────────────────────────────────

  {
    id: "cinematic-photorealism",
    name: "Cinematic Photorealism",
    description: "Ultra-detailed RAW photography with anamorphic cinema lens and dramatic lighting",
    renderMode: "photorealistic",
    promptFragment:
      "RAW photo, ultra detailed, 8k resolution, anamorphic cinema lens, shallow depth of field, bokeh, cinematic color grading, film grain, dramatic volumetric lighting, photojournalism quality, sharp foreground detail, atmospheric haze in background",
    paletteKeywords: ["deep shadow", "golden hour amber", "cool blue midtones", "warm skin tones", "cinematic teal"],
    previewImage: "/assets/seed-previews/cinematic-photorealism.svg",
    negativePrompt:
      "painting, illustration, cartoon, anime, manga, watercolor, sketch, drawing, 3d render, CGI, low quality, blurry, oversaturated, plastic, unrealistic lighting, ugly, deformed",
  },
  {
    id: "dark-fantasy-photo",
    name: "Dark Fantasy Photography",
    description: "Hyperreal dark fantasy — practical effects, dramatic practical lighting, Weta Workshop quality",
    renderMode: "photorealistic",
    promptFragment:
      "hyperrealistic dark fantasy photography, practical lighting, dramatic chiaroscuro, shallow depth of field, sharp textures, weathered materials, RAW photo quality, 8k, cinematic scale, Weta Workshop aesthetic, location photography, atmospheric fog, believable world",
    paletteKeywords: ["deep charcoal", "burnished bronze", "aged stone", "blood red accent", "pale moonlight"],
    previewImage: "/assets/seed-previews/dark-fantasy-photo.svg",
    negativePrompt:
      "painting, illustration, cartoon, anime, manga, watercolor, sketch, flat colors, 3d render, CGI, video game, low quality, blurry, plastic, toy-like",
  },
  {
    id: "neon-noir-photo",
    name: "Neon Noir Photography",
    description: "Rain-slick neon-lit streets and faces — photorealistic cyberpunk noir",
    renderMode: "photorealistic",
    promptFragment:
      "neon noir photography, rain reflections on wet streets, neon light color cast, backlit subjects, cinematic shadow, RAW photo, 8k detail, shallow depth of field, city night atmosphere, practical light sources, hard shadow edges, dramatic contrast",
    paletteKeywords: ["electric blue", "hot pink neon", "deep wet black", "amber sodium lamp", "cold purple"],
    previewImage: "/assets/seed-previews/neon-noir-photo.svg",
    negativePrompt:
      "painting, illustration, cartoon, anime, manga, watercolor, daytime, bright flat light, 3d render, CGI, low quality, blurry, oversaturated",
  },

  // ── Fine art / painterly expansion ────────────────────────────────────────

  {
    id: "oil-painting-master",
    name: "Old Master Oil",
    description: "Rembrandt and Vermeer — rich impasto, dramatic chiaroscuro, glazed amber warmth",
    promptFragment:
      "old master oil painting, Rembrandt lighting, rich impasto texture, golden amber glaze, dramatic chiaroscuro, deep shadow wells, warm candlelight, sfumato edges, museum quality, layered oil pigment, craquelure texture, classical composition",
    paletteKeywords: ["deep burnt umber", "rich amber", "warm ivory highlight", "forest shadow green", "aged ochre"],
    previewImage: "/assets/seed-previews/oil-painting-master.svg",
  },
  {
    id: "hyperdetail-concept",
    name: "Hyperdetail Concept Art",
    description: "ArtStation-quality digital painting — intricate material detail, cinematic scope, epic scale",
    promptFragment:
      "hyperdetailed concept art, ArtStation trending, digital painting, intricate material detail, cinematic composition, epic scale, matte painting quality, detailed environment design, sharp focal point, subsurface scattering, realistic material rendering, professional illustration",
    paletteKeywords: ["deep navy", "iridescent metal", "warm focal accent", "cool atmospheric blue", "rich earth tone"],
    previewImage: "/assets/seed-previews/hyperdetail-concept.svg",
  },
  {
    id: "graphic-novel-painted",
    name: "Painted Graphic Novel",
    description: "Alex Ross style — photorealistic painted comics with bold heroic staging and deep color",
    promptFragment:
      "painted graphic novel illustration, Alex Ross style, realistic painted figures, bold heroic composition, deep saturated color, dramatic staged lighting, painted detail, comic book storytelling framing, muscular confident staging, rich color narrative",
    paletteKeywords: ["deep primary red", "rich cobalt", "warm golden highlight", "dark forest shadow", "bright accent white"],
    previewImage: "/assets/seed-previews/graphic-novel-painted.svg",
  },
  {
    id: "vintage-pulp",
    name: "Vintage Pulp",
    description: "1940s–60s science fiction pulp magazine illustration — bold color, dramatic action",
    promptFragment:
      "vintage pulp science fiction illustration, 1950s magazine cover style, bold graphic color, dramatic action staging, retro-futurist aesthetic, airbrush painted, Frank R. Paul influence, wide-eyed wonder composition, exaggerated drama, Technicolor palette",
    paletteKeywords: ["rocket red", "alien green", "deep space black", "chrome silver", "atomic orange"],
    previewImage: "/assets/seed-previews/vintage-pulp.svg",
  },
];

export const getStyleSeedById = (id: string): StyleSeed | undefined =>
  STYLE_SEEDS.find((s) => s.id === id);
