# Lumina

Lumina is an EPUB reader with local library storage, reading progress, notes, highlights, search, and optional AI-generated visual scenes.

It runs as a Tauri desktop app and also has a web/PWA build for browser and tablet use.

## What Lumina Does

Lumina lets you import EPUB files, save them in a library, reopen them later, and continue reading from where you stopped.

It keeps book data separate per book:

- imported EPUB file
- parsed book structure
- reading position
- notes
- highlights
- selected visual style
- analysis results
- planned image scenes
- generated image files

When one book is closed and another is opened, Lumina loads the saved state for the active book.

## Reader

The reader supports:

- EPUB import
- library view
- table of contents
- reading progress
- page navigation
- touch navigation
- keyboard navigation
- font size controls
- reading width controls
- search
- highlights
- notes
- dark mode
- light paper mode

Dark mode is the default. It uses Lumina's blue and gold interface.

Light mode uses a soft paper-colored surface, charcoal text, muted borders, and subtle paper texture.

## Layout

Lumina has a three-panel reading layout:

- contents panel
- visual panel
- reader panel

The desktop layout can be changed between preset arrangements.

The tablet layout is designed around a larger touch screen. The contents area can be opened and closed, the visual panel stays available, and the reading panel keeps the book text readable.

## Visual Story System

Lumina can analyze a book and create a visual plan for it.

The analysis does not generate an image for every page. It creates a limited set of planned visual moments across the book.

The visual plan includes:

- the book's emotional arc
- important scene candidates
- setup and payoff threads
- planned image moments
- scene anchors inside the book
- visual direction for each generated scene
- broad lore descriptors for recurring people, places, objects, factions, or concepts

The goal is to show selected scenes that matter to the book instead of filling the reader with constant images.

## Image Generation

Images are generated only if image generation is enabled and an API key is configured.

Lumina currently uses:

- Google AI Studio / Gemini for book analysis
- Google Imagen 3 for image generation
- Gemini image generation as a fallback
- fal.ai / Flux as an optional fallback if a fal.ai key is provided

Generated images are saved. If you reopen a book, Lumina loads the saved images instead of generating them again.

## Re-Analyze vs Regenerate

Lumina separates visual planning from image replacement.

**Re-Analyze This Book** rebuilds the book's visual scaffold:

- story shape
- scene plan
- narrative threads
- lore grounding
- director briefs
- storyboard

It does not intentionally replace existing generated images.

**Regenerate Image** replaces one image for the same scene.

**Slide to regenerate all images** clears and recreates the generated image set.

## Reader-Selected Images

The reader can select a passage and ask Lumina to generate an image for that selected text.

That image is attached to the selected passage and inserted into the book's visual story near that location.

## Storage

Lumina uses different storage depending on where it is running.

In the Tauri desktop app:

- EPUBs are copied into app storage
- generated images are saved as files
- book metadata, notes, highlights, reading progress, and analysis results are saved in SQLite

In the web/PWA version:

- EPUBs are stored in browser storage
- generated images are stored in browser storage
- metadata, notes, highlights, reading progress, and analysis results are stored in IndexedDB

Browser storage is local to that browser and device.

## API Keys

Lumina uses your own API keys.

Required for analysis and image generation:

- Google AI Studio key

Optional fallback image generation:

- fal.ai key

The Google key is used for semantic analysis, visual planning, lore grounding, and image generation.

## Development

Install dependencies:

```bash
npm install
```

Run the web/PWA dev server:

```bash
npm run web:dev
```

The web dev server uses port `5175`.

Run the desktop Tauri app:

```bash
npm run tauri dev
```

Build the web app:

```bash
npm run build
```

Preview the web build:

```bash
npm run web:preview
```

## GitHub Pages

The repository includes a GitHub Actions workflow for GitHub Pages.

The Pages build is configured for the project URL:

```text
https://jharp199345.github.io/Lumina/
```

In GitHub, set Pages to deploy from **GitHub Actions**. After that, pushes to `main` build and publish the web/PWA version automatically.

## Android / Tablet Notes

The current practical tablet path is the web/PWA version.

Start the web dev server on the computer, then open the local network address from the tablet browser.

Example:

```text
http://192.168.x.x:5175/
```

The exact address depends on the computer's local network IP.

For PWA use, install the site from the tablet browser after opening it.

## Desktop Requirements

For the Tauri desktop app, Rust and Cargo must be installed because Tauri uses Rust for the native shell.

The web/PWA version does not require Rust.

## Notes About Imported Books

Import books you own or have the right to use.

Book text is sent to the configured AI provider when analysis is run.

Generated images and analysis artifacts are saved locally by Lumina.

## Current Scope

Lumina currently includes:

- EPUB import
- local library
- saved book structure
- reading progress
- notes
- highlights
- search
- desktop layout presets
- tablet-oriented layout
- dark mode
- light paper mode
- visual scene analysis
- narrative thread mapping
- visual storyboard
- lore grounding
- generated image cache
- image gallery
- single-image regeneration
- full image regeneration
- reader-selected image generation
- Tauri desktop runtime
- web/PWA runtime
