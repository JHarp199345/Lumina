# Lumina

Lumina is an intelligent EPUB reader that turns a book into a richer reading environment.

Lumina runs on your own AI backend. It is built **Odysseus-first** — Odysseus is the default engine, driving a set of named agents (reading, writer, narrator, visual analyst, audio director) for analysis, imagery, audio, and study tools — with Google Gemini as a drop-in cloud fallback. Bring your own Odysseus URL and token, or your own Gemini key. Your books and everything Lumina generates stay on your device.

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

Lumina supports two AI paths, and you decide which one is active:

- **Odysseus (default)** — runs the work through a local or self-hosted Odysseus server
- **Gemini (fallback)** — uses Google AI Studio for analysis and generation

### Odysseus

Lumina is built Odysseus-first. The reading, writing, narration, visual, and audio work is dispatched to **named Odysseus agents** rather than a single model, so each kind of task is handled by the agent suited to it:

- `reading` — narrative analysis and the book's structural map
- `writer` — study guides, summaries, and presentation text
- `narrator` — spoken-overview and narration scripting
- `visual_analyst` — scene selection and image direction
- `audio_director` — audio overview planning

Under the hood, Lumina talks to the standard Odysseus API surface: it queues a job at `/api/agents/{agent}/queue`, polls `/api/agents/jobs/{job_id}` until the job is done (tolerant of long, tunnel-backed runs), authenticates with an `ody_` bearer token, reports step telemetry to `/api/workflow`, and records skill outcomes to the Odysseus skills catalog so it improves over repeated runs.

To connect Odysseus, open Settings and provide:

- the **Odysseus URL** (defaults to `http://localhost:7860`, and a tunnel URL works too)
- an **`ody_` access token**

Settings includes a connection test that pings `/api/agents` and reports how many agents answered.

Lumina works with Odysseus; it is not affiliated with or endorsed by the Odysseus project.

### Gemini

If you would rather run in the cloud, switch the provider to Gemini and supply a Google AI Studio key. Gemini then handles the same analysis and generation work. Image generation can use Google image generation, with optional fallback support where configured, and voice features can use additional voice providers when keys are supplied.

Lumina follows a bring-your-own-key model throughout. Nothing is hosted for you — you connect the providers you choose, and the work runs through them.

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

## How Lumina Builds a Book

Lumina's generated features all start from the same place: the book is turned into a narrative map.

That map is not one giant prompt asking the AI to "understand the book." Lumina breaks the work into focused passes. Each pass has a job, and each job adds a different kind of understanding that later features can reuse.

### 1. Book Parsing

Lumina first turns the EPUB into a usable book structure.

It extracts:

- title and author information
- chapters
- table of contents entries
- raw chapter text
- word counts
- reading sections
- collection boundaries when one EPUB contains multiple books or parts

This gives Lumina the physical map of the book: where things are, how long they are, and how the reader can move through them.

### 2. Semantic Analysis

Semantic analysis builds the first version of the narrative map.

This stage is focused on what the book is doing. It can identify:

- whether the book should be treated as narrative, expository, or another reading mode
- the emotional shape of the book
- major changes in tone or direction
- important scenes or idea sections
- central themes
- symbolic motifs
- recurring concepts
- visual candidates
- the "golden number" of visual moments Lumina should aim for

Internally, this stage is split into smaller phases:

- **Preparation** decides how the book should be analyzed.
- **Chapter scoring** studies the emotional and structural weight of each chapter.
- **Arc fitting** finds the book's larger movement.
- **Scene identification** chooses moments that deserve visual or study attention.
- **Image description drafting** writes the first plain-language visual description for each scene.
- **Narrative blueprinting** tracks setups, payoffs, threads, and recurring ideas.

The output is the base semantic map.

### 3. Source Intelligence Profile

After the base map exists, Lumina can build a source intelligence profile.

This profile helps the study, audio, and presentation tools understand what kind of material they are working with. A novel, a philosophical text, a mythology collection, and a practical nonfiction book should not all produce the same kind of summary, quiz, or presentation.

The source profile helps Lumina decide:

- what kind of work the book is
- what a useful explanation should emphasize
- what kinds of study prompts make sense
- what angles an audio overview might take
- what presentation directions would fit the material

This is one reason the same book map can power many different tools without each tool starting over from zero.

### 4. Visual Lore

For fiction and story-like books, Lumina builds visual lore.

This is a continuity layer for generated imagery. It gathers recurring visual information about:

- characters
- places
- objects
- factions
- symbols
- atmosphere
- repeated visual cues

The point is consistency. If a person, place, or object matters across the book, Lumina tries to carry that memory into future image direction instead of treating every scene like an unrelated prompt.

For informational or expository books, this step can be skipped or handled differently because the useful visual layer may be diagrams, concepts, argument structure, or symbolic explanation rather than character continuity.

### 5. Visual Direction

Visual direction turns planned scenes into image-ready creative briefs.

This is where Lumina decides how a scene should be shown. It considers:

- the selected visual style
- the reader's interpretive-to-depictive setting
- the narrative map
- visual lore
- the scene's emotional role
- whether the image should be symbolic, atmospheric, concrete, or explanatory

The result is a director brief for each visual moment. That brief is what image generation uses.

### 6. Opening Image and Read-Ahead Generation

Lumina usually creates an opening image first so the visual layer has an immediate anchor.

After that, images are generated as the reader moves through the book. Lumina watches the current reading position, looks ahead to upcoming planned visual moments, and queues images close to where they will be needed.

The goal is:

- no image for every page
- no random image spam
- no waiting every time the reader reaches a meaningful moment
- no old image pretending to belong to a new passage

If a planned visual moment has no generated image yet, Lumina should show an empty planned state with actions to generate the image or visit the passage.

### 7. Reuse Across the App

Once the map exists, other features build from it.

- **Visual Reading** uses the scene plan and director briefs.
- **Gallery** shows generated images and ungenerated planned moments.
- **Study Guide** uses the book structure and study segments.
- **Quizzes** use the current segment, chapter, or whole-book scope.
- **Flashcards** use the study map and important concepts.
- **Audio Overview** uses the semantic map and source profile to create a focused spoken briefing.
- **Voice Studio** uses the book structure to generate narration sections.
- **Presentation Studio** uses the map, source profile, notes, and selected scope to create decks.
- **Highlights and Notes** stay attached to passages and can send the reader back to the text.
- **Archive** preserves generated layers when the book is removed or re-ingested.

That is the important design choice: Lumina does not ask each feature to rediscover the book. The book is mapped once, and the rest of the app grows from that shared understanding.

## Navigation Philosophy

Lumina has several surfaces: reader, contents, visual panel, gallery, notes, study tools, and audio tools.

The rule is simple:

> The table of contents always moves the book. The gallery views or creates art for the book. The reader remains the source of truth for where you are.

On desktop, multiple panels can sit beside each other. On phone, only one major surface is visible at a time, so navigation has to be more deliberate.

Mobile navigation now follows these ideas:

- tapping the table of contents always goes to the passage in the reader
- if the reader panel is not mounted yet, Lumina queues the navigation and performs it when the reader opens
- the visual panel follows the current passage rather than holding onto stale art
- if a passage has a planned image but no generated image, Lumina shows a planned placeholder
- the gallery can visit a passage whether or not that scene has an image yet
- mobile gallery controls can return to contents, reader, or visuals without trapping the user

This keeps the app from feeling like separate screens that disagree with each other.

## Evolution

Lumina started as a simple idea: an EPUB reader that could add images to books.

The first version was closer to a basic reader with a visual panel. It could import a book, show text, and generate occasional images. That was enough to prove the feeling, but not enough to make the app coherent.

The project has since grown through several layers:

- **Reader foundation** — importing EPUBs, saving a library, restoring progress, and making the text comfortable to read.
- **Visual layer** — identifying meaningful book moments and generating symbolic images instead of constant illustrations.
- **Narrative map** — building a reusable understanding of the book so every feature can work from the same source.
- **Knowledge layer** — highlights, notes, lens colors, and a drawer for returning to what mattered.
- **Study layer** — study guides, quizzes, flashcards, and badges.
- **Audio layer** — spoken overviews, narration tools, voice choices, and a floating player.
- **Presentation layer** — turning book understanding into decks for teaching, review, or discussion.
- **Archive layer** — preserving generated work instead of deleting everything when a book is removed or rebuilt.
- **Responsive shell** — reshaping the app for desktop, tablet, and phone instead of assuming one screen size.
- **Provider layer** — making Lumina Odysseus-first while keeping Gemini available as a cloud fallback.

The direction is still changing as the app becomes more capable. This README is meant to be a living document that tracks that evolution, not just a setup note.

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
