# Lumina

Lumina is an intelligent EPUB reader that turns a book into a richer reading environment.

You still read the original text. Lumina does not replace the book, summarize it away, or turn every page into a picture. Instead, it studies the book, builds a narrative map, and uses that map to grow helpful layers around the reading experience: symbolic images, notes, study guides, quizzes, audio overviews, narration, and presentation material.

The core idea is simple:

> Lumina understands the shape of a book, then helps you see, remember, study, and revisit it.

## The Big Idea

Most reading apps treat a book like a file.

Lumina treats a book like a world.

When you import a book, Lumina analyzes its structure — chapters, scenes, emotional movement, recurring ideas, important moments, and useful study sections. That analysis becomes the book's narrative map.

Lumina then builds from that map:

- visual scenes that appear at meaningful points in the book
- study guides based on the actual structure of the text
- quizzes and flashcards tied to what you have read
- audio overviews that explain or explore the book
- narration and voice tools
- presentation decks for teaching, discussion, or review
- organized highlights and notes that stay connected to the book

Everything starts with the book. The AI is not floating beside the reader making random guesses — it works from the map Lumina builds out of the text itself.

## What Lumina Does

Lumina lets you import EPUB books, save them in a personal library, reopen them later, and continue from where you stopped.

For each book, Lumina keeps track of:

- the imported EPUB
- the parsed book structure
- reading position
- table of contents
- highlights
- notes
- selected visual style
- generated images
- study materials
- audio artifacts
- presentation decks
- archived generations

When you switch books, Lumina restores the state for the active book instead of mixing everything together. Each book carries its own world with it.

## Reading

Lumina is a real reader first.

The reader includes:

- EPUB import
- a saved local library
- table of contents
- reading progress
- search
- keyboard navigation
- touch-friendly navigation
- font size controls
- line height controls
- reading width controls
- dark, light, and system themes
- desktop, tablet, and phone layouts

Desktop uses a multi-panel reading workspace. Tablet and phone layouts reshape the same experience so the text stays readable, rather than being squeezed into a tiny dashboard.

## Visual Reading

Lumina's visual system is not meant to make a comic-book version of a novel.

It creates a limited set of symbolic, atmospheric images for the moments that matter. The goal is to make the reading experience feel illuminated, not interrupted.

Lumina can:

- analyze the book's emotional arc
- identify important visual moments
- create a visual plan for the whole book
- generate images from that plan
- show images as you read
- cache generated images locally
- open a gallery of planned and generated scenes
- regenerate individual images
- re-ingest a book to rebuild its generated layer
- preserve older generations in the archive

The images are guided by three things working together: the book's narrative map, the selected visual style, and the reader's own settings. Because the map knows whether a book is narrative or informational, the visual treatment adapts to fit the kind of book it is illustrating instead of forcing one look onto everything.

## Narrative Map

The narrative map is the center of Lumina.

It is the internal understanding Lumina builds from the book. It can include:

- chapter structure
- reading sections
- emotional movement
- important scenes
- recurring ideas
- character, place, object, and concept cues
- setup and payoff threads
- visual scene candidates
- study segments
- source intelligence for the audio and presentation tools

That map is what lets Lumina create features that feel connected to the book instead of bolted on. Images, quizzes, study guides, audio overviews, and presentation decks all become more useful because they are drawn from the same shared understanding of the text.

## Highlights, Notes, and the Knowledge Drawer

Lumina includes a knowledge layer for collecting what you notice while reading.

You can:

- highlight passages
- use different highlight lenses and colors
- attach notes to highlights
- browse highlights in a glossary-style view
- search saved highlights
- review notes in a notepad view
- return from a saved highlight straight back to the passage in the book
- customize the highlight lens palette in Lens Studio

The knowledge drawer also acts as the hub for Lumina's study, audio, voice, and presentation tools. When background work finishes — an audio overview that was generating, a re-ingest that just completed — the drawer surfaces a quiet "what's new" signal: a marker on the rail, a badge on the exact feature it belongs to, and a notice that clears once you open that feature. Updates find you without interrupting the page you are reading.

## Study Tools

Lumina can turn a book into a study workspace.

The Study Guide can:

- build a draft segment map from the book
- refine that guide with AI
- organize the book into study sections
- generate quizzes for a segment, a chapter, or the full book
- create flashcards
- track quiz attempts
- award study badges

The point is not to replace reading. The point is to help you remember what you read and return to it with more structure.

## Audio Tools

Lumina includes audio features for listening, review, and guided understanding.

Audio Overview generates spoken explanations or guided summaries for:

- the whole book
- the current chapter
- selected chapters

Audio Overview summarizes first and then speaks — it distills a section into a briefing rather than reading the raw text aloud, so an overview stays short and explanatory.

Voice Studio supports narration-style audio for book sections and chapters, and can draw on a dedicated voice provider when one is configured. While narration plays, Lumina can highlight the words in time with the audio, so the text follows along as you listen. Generated audio is saved with the book so it can be replayed later, and a floating audio player, an audio cache, and voice choices keep playback close at hand.

## Presentation Studio

Lumina can generate presentation decks from a book.

Presentation Studio can:

- choose a scope, such as the whole book or selected chapters
- use templates for different presentation goals
- suggest directions based on the book
- generate slide outlines
- preview slides
- copy the deck as Markdown
- download the deck data as JSON

This makes Lumina useful not only for private reading, but also for teaching, discussion, study groups, and book analysis.

## Open Shelf

Lumina includes Open Shelf, a built-in public-domain book browser.

Open Shelf can:

- search public-domain books
- filter by genre
- sort results
- import available EPUBs
- keep download and import history
- offer manual import help when browser or source restrictions get in the way

You can also import your own EPUB files directly.

## Archive

Lumina tries not to destroy useful work.

When a book is removed or re-ingested, its generated artifacts can be moved into the Archive instead of being discarded. The archive can preserve:

- images
- audio
- notes
- presentations
- study badges

Archived material can be reviewed later, or permanently purged when you decide you no longer need it.

## AI Engines

Lumina supports two AI paths:

- **Local / Odysseus** — runs work through a local or self-hosted AI server
- **Cloud / Gemini** — uses Google AI Studio for analysis and generation

Image generation can use Google image generation, with optional fallback support where configured. Voice features can use additional voice providers when keys are supplied.

Lumina follows a bring-your-own-key model. You decide which services to connect, and the work runs through the providers you choose.

## Storage and Privacy

Lumina is designed around local ownership.

In the Tauri desktop app:

- EPUBs are copied into app storage
- generated images and audio are saved locally
- book metadata, progress, notes, highlights, analysis, study materials, and presentations are stored in SQLite

In the web / PWA build:

- book data is stored in browser storage
- generated artifacts are stored locally on that browser or device
- metadata and book state are stored in IndexedDB

Your reading work — the books, annotations, progress, and generated layers — stays on your device. Book text is sent to an AI provider only when you ask Lumina to run analysis or generation that requires that provider.

## Current App Shape

Lumina currently includes:

- a Tauri desktop app
- a web / PWA build
- a local library
- the Open Shelf public-domain browser
- EPUB import
- EPUB reading
- saved progress
- search
- highlights and notes
- the knowledge drawer
- "what's new" notifications for background work
- visual narrative analysis
- symbolic image generation
- an image gallery
- the re-ingest and archive flow
- a study guide
- quizzes
- flashcards
- badges
- audio overview
- voice studio
- a floating audio player
- presentation studio
- desktop, tablet, and phone responsive layouts

Some areas are still evolving, but the main direction is clear: Lumina is becoming a complete reading companion built around the book itself.

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

Build the app:

```bash
npm run build
```

Preview the web build:

```bash
npm run web:preview
```

## GitHub Pages

The repository includes a GitHub Actions workflow for GitHub Pages.

The Pages build is configured for:

```text
https://jharp199345.github.io/Lumina/
```

In GitHub, set Pages to deploy from **GitHub Actions**. Pushes to `main` then build and publish the web/PWA version automatically.

## Desktop Requirements

The Tauri desktop app requires Rust and Cargo, because Tauri uses a Rust native shell.

The web/PWA build does not require Rust.

## Notes About Books

Import books you own or have the right to use.

Public-domain books can be browsed through Open Shelf.

AI analysis and generation may send book text or excerpts to the configured AI provider. Generated artifacts are saved locally by Lumina.
