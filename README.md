# Lumina

A symbolic EPUB reader that augments reading with sparse, emotionally guided AI-generated imagery.

The images are not illustrations. They are atmospheric anchors — closer to watercolor, illuminated manuscript, and symbolic painting than literal scene depiction. They appear at key emotional moments only, determined by story-shape analysis of the text.

## Philosophy

- Text is always primary
- Images appear at key emotional inflection points — never constantly
- Visuals are symbolic, not literal. Your imagination stays active.
- The system is invisible. Wonder, not mechanism.

## Stack

- **Tauri** + **React** + **TypeScript** — native desktop app
- **EPUB.js** — text rendering
- **Gemini Flash** — semantic analysis, story shape, image description generation
- **Imagen 3** — symbolic image generation (same Google AI Studio key)
- **SQLite** — all persistence (books, progress, highlights, notes, image cache)

## Setup

1. Get a [Google AI Studio API key](https://aistudio.google.com/app/apikey) (free tier works)
2. Run Lumina — first launch shows onboarding
3. Enter your API key
4. Import an EPUB and choose a visual style

## Development

```bash
npm install
source "$HOME/.cargo/env"
npm run tauri dev
```

## How It Works

When you import a book:

1. **EPUB parsing** — adaptive fallback chain: NCX/OPF → heading detection → scene breaks → word-count chunking
2. **Story shape analysis** — Gemini scores each chapter emotionally, applies rolling-average smoothing, fits to one of six arc shapes (rise, fall, fall-rise, rise-fall, rise-fall-rise, fall-rise-fall), locates mathematical inflection points
3. **Scene identification** — Gemini zooms into each inflection, extracts emotional vectors, symbolic motifs, atmospheric qualities
4. **Image descriptions** — Gemini writes 2-4 sentence symbolic painting briefs
5. **Image generation** — Imagen 3 renders using your chosen style seed
6. **Read-ahead buffering** — images generate 2,000+ words ahead; no lag, no burst cost

## Personal Use

Import only books you own. Text is sent to Google's API via your own key for analysis only — never stored by Lumina.

## MVP Scope

EPUB import · adaptive parsing · three-panel layout · story-shape analysis · sparse symbolic image generation · 6 style seeds · local image cache · text highlighting · notes · in-book search · reading progress persistence · SQLite throughout · BYOK
