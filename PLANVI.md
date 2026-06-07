# PLANVI - Voice Studio, Segment Audio, and Cached Narration

---

## CONTEXT

Lumina is not trying to be a normal e-reader with a few extra buttons. The goal is a
reading environment: text, visuals, study tools, notes, highlights, and now voice all
working as book-specific artifacts that mount when a book opens and dismount when the
reader switches books.

Voice should not be a generic device text-to-speech handoff. It should feel like a
reader-facing studio: deliberate, configurable, saved, and emotionally aware without
interrupting the book.

This plan defines the first Voice Studio build.

The first version should be conservative:

- one narrator voice
- segment-based generation
- cached audio
- simple playback
- no automatic full-book audiobook generation
- no surprise API usage

Later versions can add multi-speaker narration, dialogue voices, cinematic presets,
and director-style tone mapping.

---

# PART ONE - FEATURE IDENTITY

## Drawer Entry

The Feature Drawer gets one new item:

- Icon: headphones, mic, or audio lines
- Label: Voice Studio
- Purpose: generate and play narrated audio for the current book

Voice Studio should live in the Feature Drawer because it is optional, powerful, and
book-specific. It should not replace the normal reading controls. It should not sit in
the top bar as a permanent feature until audio exists for the current book.

## What Voice Studio Is

Voice Studio is a book narration workspace.

It lets the reader:

- choose narration style
- generate audio for the current segment
- queue nearby segments
- play, pause, resume, and skip
- see what audio has already been generated
- reuse cached audio after closing and reopening the book

## What Voice Studio Is Not

Voice Studio is not:

- automatic audiobook generation for the whole book
- a hidden background cost machine
- a replacement for the reader's own imagination
- a separate subscription system
- a generic browser speech synthesis wrapper

The reader must deliberately ask Lumina to generate audio.

---

# PART TWO - MODEL AND API ASSUMPTION

## Gemini TTS Support

The architecture should support Gemini-native TTS through the same Google AI key Lumina
already stores. The exact model name should be kept configurable because Google model
names change.

Do not hardcode the product around a rumored or unstable model name.

Use a config value such as:

- `GEMINI_TTS_MODEL`
- default candidate: current official Gemini TTS preview model

The implementation should be able to swap model names without changing the UI,
storage model, or Voice Studio architecture.

## API Key

Voice Studio uses the same stored Google AI key:

- key name: `lumina_google_ai_key`
- no new key screen for v1
- no extra service subscription

If the key is missing, Voice Studio shows a clear message:

> Add a Google AI key in Settings to generate narration.

---

# PART THREE - AUDIO ARTIFACT MODEL

## Audio Is a Book Artifact

Generated audio should be treated like generated images:

- book-specific
- segment-specific
- saved locally
- mounted when the book opens
- reused instead of regenerated

The reader should be able to close the book, open another book, come back, and play
the same generated narration without paying to generate it again.

## Audio Artifact Fields

Create a saved audio artifact type.

Suggested shape:

- id
- bookId
- segmentId
- chapterIndex
- segmentTitle
- voiceId
- stylePresetId
- textHash
- promptHash
- durationSeconds
- mimeType
- filePath or blob key
- generatedAt
- generationApi
- status

The important fields are `segmentId`, `textHash`, and `promptHash`.

If the reader changes the voice or narration style, Lumina should know that cached audio
for the old settings is not the same as cached audio for the new settings.

## Status Values

Audio status should support:

- not-generated
- queued
- generating
- ready
- failed

Failures should not poison the segment forever. The reader should be able to retry.

---

# PART FOUR - STORAGE

## Web/PWA Storage

For the PWA, store audio in IndexedDB:

- metadata store: `audio_meta`
- blob store: `audio_blobs`

Audio blobs can be larger than image metadata, so the app should avoid generating too
many at once.

## Tauri/Desktop Storage

For the desktop app, store audio files in app data:

- `audio-cache/<bookId>/<artifactId>.<ext>`

Metadata should live in SQLite.

## Delete Behavior

Audio should be deleted when the book is deleted.

This is different from badges and notes:

- notes can survive as a reader's long-term notebook
- badges can survive as permanent awards
- generated audio is heavy and derived from the book

If later Lumina has an archive/export system, audio can be preserved explicitly.

---

# PART FIVE - AUDIO DIRECTOR PIPELINE

## New Pipeline File

Create:

- `src/pipeline/audioDirector.ts`

Responsibilities:

- select segment text
- build narration prompt
- call Gemini TTS
- normalize returned audio bytes
- return audio artifact data to storage

## Segment-Based Generation

Voice generation should start with Study Guide segments when available.

If no Study Guide exists, Voice Studio can offer:

- Generate Study Guide first
- or use current chapter chunk as a fallback

Preferred behavior:

1. Voice Studio checks for a Study Guide.
2. If missing, it explains that narration works best after a guide exists.
3. It offers a button: Generate Study Guide.

This keeps the audio system aligned with Lumina's existing segmentation layer.

## Prompt Shape

The audio prompt should include:

- narration style
- book title
- chapter title
- segment title
- short segment summary if available
- spoiler-safe direction
- passage text

Example direction:

> Read this passage with a steady, intimate audiobook cadence. Keep the narration clear,
> serious, and immersive. Do not overperform. Let tension rise naturally where the prose
> implies it.

## Text Limits

Do not send huge chunks.

V1 should target one segment at a time. If a segment is too large, split it into smaller
audio chunks internally while preserving one segment-level artifact in the UI.

Possible limit:

- 800 to 1,500 words per audio generation chunk

The exact limit should be based on the active Gemini TTS model's documented constraints.

---

# PART SIX - AUDIO STORE

## New Store

Create:

- `src/store/audioStore.ts`

This store tracks playback and queue state, not permanent storage by itself.

Suggested state:

- activeBookId
- activeSegmentId
- activeAudioId
- isPlaying
- isGenerating
- queue
- currentTime
- duration
- volume
- playbackRate
- selectedVoiceId
- selectedStylePresetId
- generationProgress
- error

Suggested actions:

- mount(bookId, artifacts)
- unmount()
- setVoice()
- setStylePreset()
- queueSegment()
- generateSegmentAudio()
- playAudio()
- pauseAudio()
- stopAudio()
- skipNext()
- skipPrevious()
- markReady()
- markFailed()

The store should not directly know about Gemini. It should call the pipeline or receive
pipeline results through a component action.

---

# PART SEVEN - VOICE STUDIO UI

## Empty State

If no book is open:

- show a simple empty state
- message: Open a book to use Voice Studio.

If a book is open but no Study Guide exists:

- explain that narration is generated from Study Guide segments
- primary action: Generate Study Guide
- secondary note: This keeps narration organized and cached by story segment.

## Main Voice Studio View

Once a Study Guide exists, show:

- current segment
- cached/generated status
- selected voice
- selected style
- generate current segment button
- play/pause button
- queue next segment button
- generated audio list

## Controls

Controls should be simple:

- Play/Pause
- Generate
- Queue Next
- Voice
- Style
- Speed
- Volume

Do not show complex waveform editing in v1.

## Voice Presets

Start with a small preset list:

- Clear Narrator
- Warm Storyteller
- Dark Dramatic
- Quiet Intimate
- Epic Chronicle

Each preset maps to a prompt style, not necessarily a different voice.

## Voice Selection

If Gemini exposes named voices, Lumina can list supported voice IDs.

For v1, keep a small internal list and allow it to be updated from config.

Suggested fields:

- id
- displayName
- description
- gender/character hint if applicable
- provider voice name

Do not let the UI depend on a voice name that may disappear.

---

# PART EIGHT - READER CONTROLS

## Minimal Reader Integration

Once audio exists for the current segment, the reader should show a small audio control.

Possible placement:

- reader footer, near page controls
- compact floating control near the bottom
- not in the top bar unless it stays very small

Controls:

- play/pause
- current segment title
- small progress indicator

Do not turn the reader into an audio app. The main studio stays in the drawer.

## Do Not Lose Reading Position

Playing audio should not move the reader.

Clicking an audio segment in Voice Studio may optionally offer:

- Play from here
- Jump to passage

Jumping to the passage should be a deliberate action, not the default side effect of
pressing play.

---

# PART NINE - QUEUE AND PREFETCH

## V1 Queue

The first queue should be simple:

- current segment
- next segment
- manually selected segments

The reader can click:

- Generate Current Segment
- Queue Next Segment

## Prefetch Rule

Do not automatically generate the whole book.

Optional future behavior:

After the reader plays segment 1, Lumina may offer to generate segment 2 in the
background. This should be a user-enabled setting:

- Auto-generate next segment while listening

Default should be off for v1.

## Cost Awareness

Voice Studio should make generation count visible enough that the reader understands
it is using their API key.

Simple copy:

> Generates one segment at a time using your Google AI key.

---

# PART TEN - MULTI-SPEAKER FUTURE

## Dialogue Detection

Later, Lumina can analyze dialogue and assign:

- narrator
- speaker A
- speaker B

This should not be v1.

## Character Voices

Future Voice Studio could allow:

- character voice profiles
- narrator voice profile
- dialogue-only generation
- dramatic reading mode

This should be built on top of the same audio artifact system.

## Director Mode

Director Mode can use existing Lumina artifacts:

- Study Guide segment purpose
- semantic map
- emotional arc
- scene blocks
- visual story plan

It can create tone instructions like:

- restrained dread
- rising urgency
- solemn reflection
- quiet wonder
- grief held under control
- sharp argument

The key is to direct performance without rewriting the book.

---

# PART ELEVEN - IMPLEMENTATION PHASES

## Phase 1 - Types and Storage

Add:

- `AudioArtifact` type
- audio status type
- voice preset type
- style preset type

Add storage methods:

- saveAudioArtifact
- loadAudioArtifacts
- deleteAudioArtifact
- saveAudioBlob / file
- loadAudioBlob / file URL

Add IndexedDB stores for PWA.
Add SQLite table for desktop.

## Phase 2 - Audio Store

Create `audioStore.ts`.

Implement:

- mount/unmount
- active segment tracking
- queue tracking
- playback state
- selected voice/style
- progress and errors

## Phase 3 - Audio Director

Create `audioDirector.ts`.

Implement:

- segment text extraction
- prompt builder
- Gemini TTS request
- response parsing
- audio byte normalization

Keep model name configurable.

## Phase 4 - Voice Studio Drawer Module

Add drawer entry:

- icon
- label
- route/view

Build UI states:

- no book
- no guide
- ready with segment list
- generating
- failed
- ready to play

## Phase 5 - Playback

Use browser audio APIs for PWA playback.

Implement:

- play
- pause
- progress
- duration
- speed
- volume

Make sure object URLs are created and revoked safely.

## Phase 6 - Reader Footer Control

Add a small reader-side audio control once audio is available.

Keep it minimal:

- play/pause
- segment label
- progress

## Phase 7 - Queue Next Segment

Allow the reader to queue the next reached segment.

Optional:

- generate next segment after current finishes, if explicitly queued

## Phase 8 - Polish and Safety

Add:

- clear failed status
- retry generation
- prevent duplicate generation while one is active
- detect matching cached artifact by segment, voice, style, and prompt hash
- helpful error messages

---

# PART TWELVE - SUCCESS CRITERIA

Voice Studio v1 is successful when:

- it appears in the Feature Drawer
- it does nothing until the reader opens it
- it can generate audio for one selected Study Guide segment
- it saves that audio locally
- it reuses saved audio after app reload
- it can play, pause, and resume
- it does not move the reader's position unless explicitly asked
- it does not generate the whole book by accident
- it works in the PWA and desktop app storage paths

The feature should feel calm, expensive in quality, and restrained in behavior.

The first target is not "full audiobook platform."

The first target is:

> Lumina can narrate the current meaningful segment beautifully, save it, and keep it
> attached to the book forever unless the reader deletes the book.

That is the foundation.
