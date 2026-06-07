# PLANv - Study Guide, Segmentation, Quizzes, and Question Chains

---

## CONTEXT

Lumina is already becoming more than a simple e-reader, but the reader itself must stay
calm. New systems should not interrupt the act of reading, should not run without the
reader asking for them, and should not turn the book into homework by default.

This plan defines the next optional companion layer: **Study Guide**.

Study Guide is not Search. Search remains the magnifying glass in the top bar.
Study Guide is not Open Shelf. Open Shelf remains inside the Library.
Study Guide is not reading progress. Progress is a core reader state, not a drawer
feature.

Study Guide is a deliberate mode opened from the Feature Drawer. It helps the reader
break the book into meaningful stopping points, generate quizzes, and eventually earn
book-specific badges.

The feature must be opt-in. Nothing in this plan runs automatically just because a book
opens.

---

# PART ONE - FEATURE IDENTITY

## Drawer Entry

The Feature Drawer gets one new item:

- Icon: brain
- Label: Study Guide
- Purpose: deliberate study, review, quizzes, and comprehension tools

Use a brain icon rather than a game controller for v1. A game controller implies mini
games or arcade mechanics. Study Guide is not a game yet. It is a comprehension and
retention layer.

If later Lumina gains actual games, those can either live under Study Guide or become a
separate Games feature. For now, brain is the correct symbol.

## Empty State

When the reader opens Study Guide for a book that has no guide yet, show a quiet empty
state:

- Title: No Study Guide Yet
- Short copy: Generate a guide to divide this book into readable study segments.
- Primary action: Generate Guide

Do not show quizzes before the guide exists.
Do not automatically generate the guide.
Do not start segmentation in the background.

The reader must explicitly open Study Guide and click **Generate Guide**.

---

# PART TWO - GENERATE GUIDE

## What Generate Guide Does

Generate Guide creates a book-specific study map. This map divides the book into
meaning-based segments.

Segments are not pages. Segments are not arbitrary word chunks. Segments are readable
sections where a reader can reasonably stop, review, or be quizzed.

A chapter may contain:

- one segment
- several segments
- no quiz-worthy segment, if the chapter is very short or transitional

## Segment Detection

The ideal system is hybrid:

1. Heuristic detection creates a rough map.
2. AI refines the map, names the segments, and identifies what each segment is good for.

The heuristic pass can detect:

- chapter boundaries
- headings
- scene breaks
- paragraph clusters
- approximate length limits
- dialogue-heavy sections
- obvious topic shifts
- repeated character/location names
- large time or setting transitions when visible in text

The AI refinement pass can:

- merge weak segments
- split overly large segments
- give segments readable names
- identify whether a segment is quiz-worthy
- mark dominant concepts: plot, character, theme, lore, conflict, setup, payoff
- write a short summary
- identify spoiler sensitivity
- decide whether the segment is better for recall, comprehension, or synthesis

## Cost Control

The app should do as much as it can locally before using AI. AI should not be used to
discover every paragraph boundary from scratch if the app can cheaply create an initial
candidate map.

For large books, segment generation should happen in chunks and report progress.

Possible progress messages:

- Reading chapter structure
- Finding natural stopping points
- Grouping scenes and topics
- Naming study segments
- Preparing quiz targets
- Saving Study Guide

## Generated Study Artifact

The guide should save as a book-specific artifact. Opening a book mounts that book's
study guide. Closing or switching books dismounts it.

Persist:

- guide id
- book id
- generated at
- guide version
- segment list
- segment summaries
- segment anchors
- segment status
- quiz readiness flags

---

# PART THREE - SEGMENT MODEL

## Segment Fields

Each Study Segment should store:

- id
- bookId
- chapterIndex
- chapterTitle
- title
- start anchor
- end anchor
- approximate word start
- approximate word end
- summary
- purpose
- quizWorthy
- spoilerLevel
- concepts
- characters
- locations
- themes
- setupPayoffLinks

The anchors should be stable. Do not rely only on rendered page number. Use chapter
index plus character or word offsets where possible, similar to the stable structured
highlight approach.

## Segment Naming

Do not expose random machine labels.
Do not expose IDs like `ch3_segment_02`.
Do not generate awkward filenames.

Use readable names that include the chapter context.

Examples:

- Chapter 3: The Mine
- Chapter 3: The First Betrayal
- Chapter 4: The Cost of the Promise
- Chapter 4: The Escape Plan
- Chapter 7: The Argument Turns
- Chapter 9: The Debt Comes Due

If a chapter has multiple segments, keep the same chapter label and vary the segment
title.

## Segment List UI

After Generate Guide completes, Study Guide should show a clean list.

Each row:

- segment title
- short summary or purpose
- status
- quiz status

Possible statuses:

- Ready
- Quiz generated
- Passed
- Review
- Locked by reading position

Do not lead with chapter ranges. The segment title already carries chapter context.

---

# PART FOUR - QUIZ UNLOCKING

## Unlock Rule

Quizzes unlock only after a Study Guide exists.

Before guide generation:

- no quiz selector
- no quiz buttons
- no badges

After guide generation:

- show quiz selector
- show segment readiness
- allow quiz generation

## Spoiler Rule

By default, quiz generation should only use material the reader has reached.

Whole-book quizzes can stay locked until the book is complete, or they can show a clear
spoiler warning. The safer v1 behavior is:

- Segment quiz: available if reader has reached the segment
- Chapter quiz: available if reader has reached the end of selected chapter(s)
- Whole-book quiz: available after book completion, or behind a spoiler confirmation

---

# PART FIVE - QUIZ SELECTOR

## Selector Modes

The quiz modal should be simple and should not feel like a spreadsheet.

Modes:

- Segment Quiz
- Chapter Quiz
- Whole Book Quiz

## Segment Quiz

Reader selects one segment.

Default length:

- 3-5 questions

Focus:

- what happened
- why it mattered
- what changed
- what the reader should understand before moving on

Segment quizzes are short because segments are smaller than chapters.

## Chapter Quiz

Reader selects one or more chapters.

Default length:

- 5-10 questions

Chapter quizzes can pull from multiple segments inside the selected chapters.

Use this for:

- chapter review
- chapter cluster review
- before returning to a book after a break

## Whole Book Quiz

Reader selects Whole Book.

Default length:

- 8-12 questions

Whole-book quizzes should not be trivia dumps. They should focus on high-level
comprehension:

- causation
- consequences
- character decisions
- theme development
- setup and payoff
- conflict resolution
- callbacks
- how earlier events enabled later outcomes

They can include recall, but recall should serve understanding.

---

# PART SIX - QUESTION CHAINS

## Core Idea

Whole-book quizzes should not be a pile of unrelated questions. They should use
grouped question chains.

A question chain is a set of 2-4 questions where each question prepares the reader for
the next one. The chain moves from simpler recognition toward deeper understanding.

This is not ordinary quiz generation. This is scaffolded comprehension.

## Chain Shape

A chain usually moves through four levels:

1. Recall or recognition
2. Relationship or conflict
3. Interpretation
4. Synthesis

Not every chain needs all four levels. Some chains can be two or three questions long.

## Example

Topic: Trazyn and the Diviner

Question 1:

- What is the basic relationship between Trazyn and the Diviner?

Purpose:

- Establish the surface conflict.

Question 2:

- How does the story depict their conflict through what each character values?

Purpose:

- Move from enemy status into motivation.

Question 3:

- How do Trazyn and the Diviner contrast as figures of past and future?

Purpose:

- Connect character design to theme.

Question 4:

- What does their conflict suggest about the danger of living only in memory or only
  in prophecy?

Purpose:

- Ask the reader to synthesize a larger idea from the book.

## Whole-Book Quiz Structure

Instead of 12 random questions, a whole-book quiz should often be:

- 3 question chains
- 3-4 questions each
- total 9-12 questions

Each chain should focus on one major thread:

- a central relationship
- a character transformation
- a recurring symbol
- a theme
- a cause-and-effect arc
- a setup/payoff sequence
- a philosophical conflict

## Chapter Quiz Structure

Chapter quizzes can use:

- one question chain
- plus a few direct questions

or:

- two short chains if the chapter is dense

## Segment Quiz Structure

Segment quizzes should be simpler:

- one mini-chain
- or 3-5 direct but meaningful questions

Segments are too small for heavy synthesis unless the segment itself is a major scene.

## AI Prompting Rule

The quiz generator must not ask for generic quiz questions.

It should ask for:

> grouped question chains where each question prepares the reader for the next,
> moving from recall to relationship to interpretation to synthesis.

The generator should also ask for each question's purpose. The purpose does not need to
be shown to the reader, but it helps Lumina evaluate and organize the quiz.

---

# PART SEVEN - QUESTION DISPLAY

## Question Naming

Questions should display inside the quiz as normal numbered questions.

Example:

- Chapter 3: The First Betrayal
- Question 1 of 4

Do not display:

- raw segment ids
- generated filenames
- internal chapter ranges
- `Ch3_TheFirstBetrayal_Q1`

If the quiz changes to a different segment or chain, the question count continues
inside that quiz unless the UI intentionally labels a new section.

## Chain Labels

For whole-book quizzes, it may be useful to show a subtle chain title.

Example:

- Memory and Prophecy
- Question 1 of 4

But keep it understated. The reader should feel guided, not like they are looking at a
test blueprint.

## Answer Types

Start with simple answer types:

- multiple choice
- short answer

Multiple choice is easier to score. Short answer is more interesting but requires AI
evaluation.

V1 should likely support multiple choice first, with a future path to short-answer
evaluation.

## Review Mode

After a quiz attempt, show:

- score
- passed or review
- missed questions
- brief explanations
- option to retake

Do not shame the reader. Use calm language.

---

# PART EIGHT - REWARDS

## Badges Before Currency

Do not surface coins or tokens in v1 unless they have a real use.

Use badges first.

Possible badges:

- Segment Cleared
- Chapter Mastered
- Perfect Pass
- Deep Reader
- Thread Finder
- Lore Keeper
- Whole Book Mastery

## Internal Points

It is acceptable to store internal points or token values for future systems, but do
not make them a visible economy until Lumina knows what they can be used for.

## Badge Anchoring

A badge should know what it came from:

- book id
- segment id, chapter id, or whole-book quiz id
- quiz attempt id
- score
- awarded at

Badges should be book-specific artifacts.

---

# PART NINE - PERSISTENCE

Study Guide artifacts must survive:

- browser reload
- PWA close/reopen
- offline use after generation
- book switching

Persist these entities:

- StudyGuide
- StudySegment
- Quiz
- QuizQuestion
- QuestionChain
- QuizAttempt
- BadgeAward

All are scoped to a book.

Opening a book mounts that book's study artifacts.
Closing or switching books dismounts them.

---

# PART TEN - BUILD ORDER

## Phase 1 - Study Guide Shell

- Add Study Guide to Feature Drawer with brain icon.
- Add empty state.
- Add Generate Guide button.
- Add placeholder state for generated guide.
- No automatic processing.

## Phase 2 - Segment Map

- Build heuristic segment detection.
- Store study segment artifacts.
- Display generated segments.
- Add progress UI during guide generation.
- Add stable anchors for segment start/end.

## Phase 3 - AI Segment Refinement

- Send heuristic map to AI.
- Ask AI to merge/split/name segments.
- Ask AI to assign summaries and quiz readiness.
- Save refined guide.

## Phase 4 - Quiz Selector

- Add Segment / Chapter / Whole Book selector.
- Lock quiz generation until guide exists.
- Respect reader progress and spoiler safety.

## Phase 5 - Segment Quizzes

- Generate 3-5 question segment quizzes.
- Save quiz.
- Allow attempt.
- Save score and attempt history.

## Phase 6 - Chapter Quizzes

- Generate 5-10 question chapter quizzes.
- Allow one or multiple chapters.
- Pull from the relevant segments.

## Phase 7 - Whole Book Question Chains

- Generate 3 question chains of 3-4 questions each.
- Focus on synthesis and causation.
- Add chain-aware review display.

## Phase 8 - Badges

- Award badges based on quiz completion.
- Store badge awards.
- Display badge collection inside Study Guide.

---

# PRODUCT RULE

Study Guide should feel like:

> I want to understand this book better.

It should not feel like:

> The app is testing me now.

The reader asks for the guide. The reader asks for the quiz. Lumina responds.

