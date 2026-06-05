# Lumina — Plan III
## The Visual Director: Depictive Cinematic Companion

---

## North Star

Lumina should feel like a sensitive visual intelligence reading alongside you — one that depicts what happens clearly enough to satisfy the reader's desire to see the story, while still noticing what the moment means emotionally, symbolically, and cinematically. It chooses images with taste. It remembers what it has already shown. It knows when to be grand and when to be quiet. It paces itself against the emotional arc of the story rather than firing off dramatic images at every scene break.

The feature is not "AI-generated images for books."

The feature is:

> A depictive visual companion that stages concrete book moments with cinematic intention, emotional intelligence, visual continuity, and enough symbolic emphasis to make each image feel meaningful rather than generic.

---

## Why The Current Pipeline Falls Short

The current pipeline is:

```
Book text
→ semantic analysis (story shape + inflection points)
→ scene identification (emotional vectors, symbolic motifs)
→ image description (2-4 sentence brief written by Gemini)
→ Imagen 3 or Flux generation
→ displayed at reading position
```

This works, but it has no visual intelligence layer. The problems:

**Lazy depiction drift.** Without a director, Gemini may depict the action in the most obvious way: "a man runs toward an army," "two figures face each other in shadow," "a stormy battlefield at dusk." These are visually coherent but often emotionally flat. The problem is not that they are literal; the problem is that they are undirected. Lumina should depict the scene, but choose the angle, focus, scale, motion, and emotional emphasis with intention.

**Tonal monotony.** Every image becomes maximally dramatic. Dark palette, lone figure, storm atmosphere, sweeping scale. After three images like that, the reader's eye glazes. A book like Red Rising has moments that deserve silence, intimacy, and restraint — not just spectacle.

**Compositional repetition.** Wide shot. Lone figure against scale. Dramatic light. This pattern repeats across every book because nothing in the current pipeline tracks or penalizes repetition.

**No strategic thinking.** The system currently cannot ask: is this moment better served by showing the object rather than the person? Would the aftermath of this betrayal be more powerful than the moment of betrayal? Should I use a bird's-eye view exactly once in this book to show fate? None of these decisions are made.

**Undifferentiated moments.** A cost-of-triumph scene and a sacrifice scene can look completely identical with the current pipeline. The system knows their emotional valences but does not use that knowledge to choose different visual strategies.

**No pacing.** The images should collectively tell a visual story about the book's arc — tightening and loosening emotional intensity, shifting composition and palette as the story changes. The current pipeline treats each image as independent.

---

## The Visual Director Layer

The new module `src/pipeline/visualDirector.ts` sits between semantic analysis and image generation. Its job:

1. Receive an `IdentifiedScene` with its emotional, symbolic, and structural metadata
2. Receive the `SemanticMap` for broader arc context
3. Receive recent `VisualDirectorBrief` objects for diversity checking
4. Receive the selected `StyleSeed` for medium/palette anchoring
5. Receive the reader's `visualInterpretationLevel` (0–100) — the spectrum from pure creative interpretation to close scene depiction
6. Produce a structured `VisualDirectorBrief` — a complete, organized visual specification
7. From that brief, construct the final image prompt

The director does not pick what scene to illustrate. That is the job of semantic analysis. The director decides *how* to illustrate a scene that has already been selected: which instant, which point of view, which subject focus, which scale, which emotional emphasis, and which details from the text must remain legible. The default bias is depictive and scene-faithful, not deliberately ambiguous.

---

## Full Type System

### MomentFunction

The emotional and narrative function of the moment in the larger story. Two scenes can have identical action but completely different functions — the director must know which it is.

```ts
export type MomentFunction =
  // Threshold moments — something changes permanently
  | "threshold"         // a character crosses a point of no return
  | "transformation"    // identity or nature changes
  | "loss_of_innocence" // the world can no longer be seen as it was

  // Relational moments — promises and their consequences
  | "promise_made"      // a commitment, oath, or declaration
  | "promise_delivered" // the fulfillment of a commitment
  | "promise_broken"    // betrayal of a commitment
  | "betrayal"          // trust violated without prior promise

  // Collision moments — forces meet
  | "collision"         // physical, political, or ideological clash
  | "sacrifice"         // voluntary loss for a greater purpose
  | "cost_of_triumph"   // victory paid for at painful price

  // Revelation moments — knowledge changes everything
  | "revelation"        // a hidden truth surfaces
  | "recognition"       // a character sees something or someone truly for the first time
  | "moral_choice"      // a decision between competing values with no clean answer

  // Psychological moments — interior experience
  | "dread"             // slow-building fear of what is coming
  | "temptation"        // desire pulling against principle
  | "grief"             // loss internalized
  | "isolation"         // aloneness that carries meaning

  // Arc moments — large-scale narrative beats
  | "gathering"         // forces assembling before a collision
  | "aftermath"         // the state of things after a significant event
  | "return"            // a character returns changed, or to a changed place
  | "suspense"          // tension held before resolution
  | "opening_world"     // first exposure to the emotional world of the book
```

Each moment function implies a set of visual strategies that tend to serve it well, and others that tend to underserve it. This mapping is part of the director's logic.

---

### VisualStrategy

How the image represents the moment — the fundamental relationship between content and form.

```ts
export type VisualStrategy =
  // Show the action with clarity
  | "literal_iconic"          // clear, legible depiction of the moment's action or figure
  | "ritualized_action"       // stylized or formal rendering of a significant act

  // Shift from action to symbol
  | "symbolic_abstraction"    // emotional content expressed through non-literal forms
  | "object_centered"         // a charged object carries the weight of the scene
  | "threshold_composition"   // a door, gate, line, or boundary as the subject

  // Shift from action to atmosphere
  | "emotional_landscape"     // the environment expresses the feeling rather than the event
  | "environmental_pressure"  // the world bears down on figures or objects from all sides

  // Shift from action to time
  | "aftermath_tableau"       // the scene after the event: what was left behind
  | "anticipation_frame"      // the last moment before: stillness before rupture

  // Compositional strategies
  | "scale_contrast"          // small against massive, individual against systemic
  | "character_silhouette"    // figures reduced to shape and posture
  | "negative_space"          // what is absent speaks as loudly as what is present
  | "rare_aerial"             // bird's-eye geometry — reserved for fate, strategy, scale
```

**Strategy guidance by moment function:**

This table should be read through the corrected premise: Lumina is depictive first. "Avoid" means "do not use as a lazy default," not "never depict the scene." Even when the image is object-centered, atmospheric, or aftermath-focused, it should still feel anchored to the actual book moment through concrete scene details.

| Moment Function | Preferred Strategies | Avoid as lazy default |
|---|---|---|
| threshold | literal_iconic, threshold_composition, character_silhouette | generic emotional_landscape |
| transformation | ritualized_action, literal_iconic, symbolic_abstraction | vague symbolic_abstraction without scene anchors |
| loss_of_innocence | aftermath_tableau, literal_iconic, negative_space | generic darkness/sadness |
| promise_made | object_centered, ritualized_action | emotional_landscape |
| promise_delivered | literal_iconic, object_centered, character_silhouette | vague glow/abstract triumph |
| betrayal | literal_iconic, aftermath_tableau, negative_space, environmental_pressure | melodramatic face closeup |
| collision | literal_iconic, scale_contrast, rare_aerial (once) | pure symbolic_abstraction |
| sacrifice | literal_iconic, scale_contrast, character_silhouette | gore or over-heroic posing |
| cost_of_triumph | aftermath_tableau, literal_iconic, negative_space | simple victory pose |
| revelation | literal_iconic, threshold_composition, symbolic_abstraction | generic mystic light |
| moral_choice | threshold_composition, character_silhouette | emotional_landscape |
| grief | literal_iconic, emotional_landscape, negative_space | generic crying portrait |
| isolation | negative_space, emotional_landscape | scale_contrast |
| dread | literal_iconic, environmental_pressure, emotional_landscape | formless fog/darkness only |
| gathering | scale_contrast, rare_aerial (once), environmental_pressure | object_centered |
| aftermath | aftermath_tableau, literal_iconic, negative_space, emotional_landscape | action pose after action is over |
| opening_world | literal_iconic, emotional_landscape, symbolic_abstraction | spoilers or over-specific later plot |

These are tendencies, not rules. The director may override based on context, but must justify the override when the diversity checker asks.

**Strategy availability by interpretation level:**

The strategy guidance table above represents behavior at the midpoint (~50). The reader's `visualInterpretationLevel` setting gates which strategies the director is allowed to choose.

| Level range | Available strategies | Character/scene presence |
|---|---|---|
| 0–20 | symbolic_abstraction, emotional_landscape, negative_space | No figures. Pure mood, form, color, symbol. |
| 20–40 | + object_centered, aftermath_tableau, threshold_composition, environmental_pressure | Objects and environment only. Figures at most as distant blur. |
| 40–60 | + anticipation_frame, character_silhouette, scale_contrast | Figures as silhouette or gestural form. Scene implied more than depicted. |
| 60–80 | + ritualized_action, literal_iconic (reduced intensity) | Figures readable by posture and action. Scene depicted but stylized. |
| 80–100 *(recommended default range)* | All strategies including full literal_iconic | Scene depicted as closely as the style seed medium allows. Figures, action, setting all clear. |

Strategies are still ranked by moment function within the available set — the interpretation level determines *which strategies are reachable*, not which one wins.

**Negative prompt relaxation by level:**

The negative prompt tightens and loosens in sync with the level:

| Level range | Negative prompt additions |
|---|---|
| 0–40 | "no figures, no human forms, no scene action, no identifiable setting elements" |
| 40–60 | "no clear faces, no identifiable portraits, figures only as silhouette or gesture" |
| 60–80 | "no photorealistic faces, no identifiable character portraits" |
| 80–100 | "no photorealism" — the minimum floor, always kept regardless of level |

Even at 100, Lumina never produces photorealistic portraits. The style seed always mediates. "100 = illustrative" means *within the watercolor / dark ink / golden manuscript register the reader chose* — Gustave Doré, not a photograph. Faces remain gestural, figures readable by form and action rather than specific likeness.

---

### VisualPerspective

Where the viewer stands in relation to the subject.

```ts
export type VisualPerspective =
  | "intimate_close"          // within arm's reach — texture, detail, emotion on face or object
  | "medium_human_scale"      // as if standing nearby — normal field of view
  | "wide_establishing"       // distance shows context and environment
  | "solitary_figure_against_scale"  // person small in large environment
  | "low_angle"               // looking up — power, weight, looming
  | "high_angle"              // looking down — vulnerability, map-view, fate
  | "rare_aerial"             // directly overhead — geometry, scale, impersonality
  | "object_perspective"      // camera positioned as if looking at or from an object
  | "over_the_shoulder"       // attached to a character, facing their view
  | "silhouette_from_behind"  // figure seen from behind, facing their world
  | "environment_first"       // environment fills frame, figure is incidental
  | "negative_space_dominant" // space is primary subject, presence is secondary
```

**Perspective rarity rules:**
- `rare_aerial` — maximum once per book, ideally once per collection segment
- `negative_space_dominant` — maximum twice per book
- `intimate_close` — valuable for contrast; avoid using more than 30% of images

**Perspective diversity tracking:**
The director tracks recent perspective choices. If the last two images both used `solitary_figure_against_scale`, the director should actively prefer other options even if the scene might otherwise suggest that choice.

---

### SubjectFocus

What the image is actually about — what the viewer's attention is directed toward.

```ts
export type SubjectFocus =
  | "person"           // a human figure is the primary visual subject
  | "object"           // a charged or symbolic object is the primary subject
  | "place"            // a location carries the meaning
  | "crowd_or_mass"    // collective force is the subject
  | "threshold"        // a boundary, doorway, or crossing point
  | "natural_force"    // weather, fire, water, earth
  | "symbolic_motif"   // a recurring symbol from the book's visual grammar
  | "aftermath"        // what was left behind after an event
  | "absence"          // what is missing, implied, or destroyed
```

"Absence" deserves special attention. Some of the most powerful images in literary illustration show:
- An empty chair where a character sat
- A letter half-burned
- A battle standard lying in mud after the battle is over
- A door that has been broken inward
- A gift that was never opened

These images communicate grief, betrayal, cost, and loss more precisely than showing the moment of rupture itself.

---

### MotionLevel

The energy and movement quality of the image.

```ts
export type MotionLevel =
  | "completely_still"    // nothing moves; quiet contemplation
  | "potential_energy"    // still but charged; the moment before motion
  | "slow_movement"       // drift, descent, settling, dissolution
  | "purposeful_motion"   // deliberate movement with clear direction
  | "rushing"             // fast, driven, barely controlled
  | "violent_collision"   // impact, explosion, breaking
  | "settling_aftermath"  // motion decelerating; things landing in new positions
  | "exhausted_stillness" // stillness that follows great effort or loss
```

Motion level should vary across the book's images to support pacing. A book should not have six consecutive `violent_collision` or `rushing` images any more than a film should have six consecutive action sequences. The director should check the recent motion level distribution before choosing.

---

### CameraDistance

How much is in frame — the image's sense of scope.

```ts
export type CameraDistance =
  | "extreme_close"      // texture, fragment, detail
  | "close"              // face, hands, single object
  | "medium"             // figure from waist up, or object in context
  | "medium_wide"        // full figure in immediate environment
  | "wide"               // figure in broader scene
  | "extreme_wide"       // individual nearly lost in landscape or crowd
```

---

### The Full VisualDirectorBrief

```ts
export interface VisualDirectorBrief {
  // Identity
  sceneId: string;
  bookId: string;
  generatedAt: string;

  // Reader preference at time of generation (0 = interpretive, 100 = illustrative)
  // Stored so regeneration knows what level produced this brief.
  interpretationLevel: number;

  // Director decisions
  momentFunction: MomentFunction;
  visualStrategy: VisualStrategy;
  perspective: VisualPerspective;
  cameraDistance: CameraDistance;
  subjectFocus: SubjectFocus;
  motionLevel: MotionLevel;

  // Emotional and symbolic content
  emotionalTone: string[];          // 2-4 precise emotional descriptors
  dominantEmotion: string;          // the single most important one
  symbolicAnchors: string[];        // abstract symbols (light, dust, weight, fracture)
  concreteAnchors: string[];        // physical objects and environments from the text
  chapterContextWords: string[];    // key words from nearby text to inform atmosphere

  // Visual parameters
  composition: string;              // how the frame is organized (1-2 sentences)
  palette: string[];                // 3-5 colour/tone descriptors
  lighting: string;                 // lighting quality and direction
  texture: string;                  // surface quality (rough, smooth, wet, cracked, worn)

  // Constraints
  restraintRules: string[];         // what to handle with restraint
  avoidExplicitly: string[];        // what to explicitly exclude

  // Diversity reasoning
  diversityNotes: string;           // why this brief avoids recent repetition

  // Output
  finalPrompt: string;              // complete, ready-to-send image prompt
  negativePrompt: string;           // complete negative prompt for this image
}
```

---

### DiversityMemory

The data structure that tracks recent visual choices and drives the anti-repetition system.

```ts
export interface DiversityMemory {
  bookId: string;

  // Rolling window of recent choices (last N images)
  recentMomentFunctions: MomentFunction[];
  recentVisualStrategies: VisualStrategy[];
  recentPerspectives: VisualPerspective[];
  recentSubjectFoci: SubjectFocus[];
  recentMotionLevels: MotionLevel[];
  recentCameraDistances: CameraDistance[];
  recentDominantEmotions: string[];
  recentPaletteTerms: string[];

  // One-per-book limits
  aerialViewUsed: boolean;
  aerialViewSceneId: string | null;

  // Usage counts (full book)
  strategyUsageCounts: Partial<Record<VisualStrategy, number>>;
  perspectiveUsageCounts: Partial<Record<VisualPerspective, number>>;
  subjectFocusUsageCounts: Partial<Record<SubjectFocus, number>>;
  motionLevelUsageCounts: Partial<Record<MotionLevel, number>>;
}
```

The rolling window should be the last 3-4 images. Beyond 4, the memory becomes less relevant — a viewer does not hold the sixth-ago image in mind when seeing the current one. But within 3, repetition is very noticeable.

---

## Reader Interpretation Level

### What It Is

`visualInterpretationLevel` is a global reader preference stored in `settingsStore` alongside `fontSize` and `theme`. It controls where on the spectrum from creative interpretation to close scene depiction Lumina's images land.

It is **not** per-book. It is **not** tied to genre or story type. It is purely: what quality of image does *this reader* find most compelling?

Some readers want pure mood — they want Lumina to evoke the feeling of a moment through colour, light, and symbol, letting their imagination supply the rest. Other readers want to see the scene — they want a visual record of what happened, filtered through the style seed's artistic medium. Both are valid. However, Lumina's product default should favor the second group: readers who want the book brought visibly to life. The slider lets the reader move away from that default if they personally prefer a more interpretive mode.

### Setting Type

```ts
// In src/types/index.ts — add to UserSettings:
export interface UserSettings {
  // ... existing fields ...

  /**
   * Visual interpretation level: 0 = fully interpretive/symbolic,
   * 100 = close scene depiction. Default 80.
   *
   * Controls which visual strategies the director may choose and how
   * literally the final image prompt describes the scene.
   * Stored globally — applies to all books.
   */
  visualInterpretationLevel: number;
}
```

### Settings Store

```ts
// In src/store/settingsStore.ts — add to defaults:
visualInterpretationLevel: 80,

// Add action:
setVisualInterpretationLevel: (level: number) =>
  set({ visualInterpretationLevel: Math.max(0, Math.min(100, level)) }),
```

Default is **80** — the depictive sweet spot where figures, action, setting, and important objects are legible, while the director still applies taste, pacing, camera logic, emotional emphasis, and anti-repetition rules. This is where Lumina should normally live: the reader can see the scene, but the image still feels composed rather than mechanically illustrated.

### Semantic Anchors

| Value | Label | What images look like |
|---|---|---|
| 0 | Pure interpretation | No figures, no action, no recognizable setting. Colour, form, texture, and abstract symbol only. The emotional world of the moment as pure painting. |
| 25 | Atmospheric | Objects, environments, and thresholds carry the scene. Figures implied by their absence or reduced to trace. |
| 50 | Balanced | Figures present as silhouette and gesture. Scene implied through composition and symbol. The moment's emotional meaning is the subject. |
| 75 | Illustrative | Figures and action readable. Scene depicted but filtered through the style seed medium. |
| 80 *(default)* | Depictive cinematic | Concrete scene content is clear. The director chooses the most meaningful angle, focus, and composition. |
| 100 | Scene depiction | As close to the actual scene as the style seed allows. Action, figures, and setting all legible. Always mediated by the artistic medium — never photorealistic. |

### UI: The Slider

Located in the Settings Panel, under a "Visual Style" section:

```
Visual Style

Interpretive ●──────────────────○ Illustrative
             0        50        100

Interpretive: pure mood, symbol, atmosphere
Illustrative: scene depiction through your chosen art style

Currently: Balanced  (or "Interpretive" / "Illustrative" / "Scene Depiction" depending on range)
```

The slider snaps to clean increments (0, 10, 20… or freeform). No decimal precision needed.

The label updates dynamically based on value:
- 0–20: "Interpretive"
- 20–45: "Atmospheric"
- 45–55: "Balanced"
- 55–75: "Illustrative"
- 75–100: "Scene Depiction"

A brief one-line description under the slider explains what images will look like at the current setting. This helps readers understand what they're choosing without needing to think in percentages.

### Interaction With Briefs

The `interpretationLevel` is recorded in every `VisualDirectorBrief`. This matters for:

1. **Regeneration context** — if a user regenerates an image, the system knows what level produced the original brief and can regenerate at the same level or a different one if the user requests it.

2. **If the reader changes the level** — existing images are not automatically regenerated (they were generated at a specific level and that is valid). The new level applies to the next image generation. If the reader wants all images at the new level, they use "Regenerate all images" from settings.

3. **Opening image** — always generated at the reader's current level, but with the constraint that `opening_world` moment function leans toward the atmospheric regardless of level (no spoilers, even at 100).

---

## The Visual Director Module

**`src/pipeline/visualDirector.ts`**

### Public API

```ts
export async function createVisualDirectorBrief(params: {
  scene: IdentifiedScene;
  semanticMap: SemanticMap;
  structure: BookStructure;
  styleSeed: StyleSeed;
  diversityMemory: DiversityMemory;
  nearbyText: string;           // raw text from the surrounding chapters
  interpretationLevel: number;  // 0–100 from settingsStore.visualInterpretationLevel
  apiKey: string;
  onProgress?: (msg: string) => void;
}): Promise<VisualDirectorBrief>

export function buildDiversityMemory(
  existingBriefs: VisualDirectorBrief[]
): DiversityMemory

export function updateDiversityMemory(
  memory: DiversityMemory,
  newBrief: VisualDirectorBrief
): DiversityMemory

export function detectRepetitionPressure(
  memory: DiversityMemory
): RepetitionPressure

export function buildFinalImagePrompt(
  brief: VisualDirectorBrief,
  styleSeed: StyleSeed
): string
```

---

### RepetitionPressure

Before asking Gemini to write the brief, we analyze the diversity memory and produce a `RepetitionPressure` structure. This feeds directly into the Gemini prompt as a constraint.

```ts
export interface RepetitionPressure {
  overusedStrategies: VisualStrategy[];
  overusedPerspectives: VisualPerspective[];
  overusedSubjectFoci: SubjectFocus[];
  overusedMotionLevels: MotionLevel[];
  aerialViewBlocked: boolean;
  tonePatternNote: string;      // e.g. "Recent images have all used dread/suspense. Vary."
  diversityInstructions: string; // pre-formatted string to inject into Gemini prompt
}
```

**Repetition pressure detection rules:**

A strategy, perspective, or focus is "overused" if it appears in 2 of the last 3 images. The instructions generated from this become hard constraints in the Gemini prompt:

```
The recent images have used: lone figure, wide shot, dread/suspense.
For this brief, DO NOT use:
- solitary_figure_against_scale perspective
- emotional_landscape strategy
- dread or suspense as the dominant emotion
Actively vary the composition, perspective, and emotional register.
```

---

### Gemini Prompt Structure for Visual Director

The Visual Director calls Gemini Flash with a carefully structured prompt. It should return JSON, not prose.

**System context:**

```
You are Lumina's Visual Director. Your job is to create a precise, structured visual brief
for a painting that will accompany a reader at a specific emotional moment in a book.

The reader has set an interpretation level that tells you how literally or interpretively
to render this scene. You must respect this setting — it is the reader's preference,
not a suggestion.

Guidelines:
- Choose a visual strategy appropriate for both the moment function AND the interpretation level.
- Think about what should be shown vs. what should be implied, filtered through the level.
- Vary composition, perspective, and emotional register based on what has come before.
- Output valid JSON matching the VisualDirectorBrief schema.
```

**Input to the model:**

```
BOOK: {title} by {author}
OVERALL ARC: {arcShape}
DOMINANT THEMES: {centralThemes}
DOMINANT EMOTIONS: {dominantEmotions}

THIS MOMENT:
Chapter context: {nearbyTextExcerpt}
Emotional vectors: {scene.emotionalVector}
Symbolic motifs identified: {scene.symbolicMotifs}
Atmospheric qualities: {scene.atmosphericQualities}
Narrative weight: {scene.narrativeWeight}
Arc position: chapter {approximateChapterIndex} of {totalChapters}

RECENT IMAGE HISTORY (last 3):
Brief 1: {strategy}, {perspective}, {dominantEmotion}, {subjectFocus}
Brief 2: {strategy}, {perspective}, {dominantEmotion}, {subjectFocus}
Brief 3: {strategy}, {perspective}, {dominantEmotion}, {subjectFocus}

DIVERSITY CONSTRAINTS:
{repetitionPressure.diversityInstructions}

AERIAL VIEW AVAILABLE: {!memory.aerialViewUsed}
(Note: aerial view may only be used once per book. Reserve it for a moment of fate, scale, or strategic significance.)

READER INTERPRETATION LEVEL: {interpretationLevel}/100
{interpretationLevelInstruction}

(The interpretationLevelInstruction is generated by the code before sending to Gemini.
 It translates the numeric value into plain English constraints. Examples:

 Level 10:
 "The reader prefers pure creative interpretation. No figures, no scene action, no literal
 depiction. Use only symbolic_abstraction or emotional_landscape strategies. Communicate the
 emotional world of this moment through colour, texture, and abstract form. No human forms,
 no recognizable scene elements."

 Level 50:
 "The reader prefers a balanced interpretation. Figures may appear as silhouette or gestural
 form. The scene should be implied rather than depicted. Choose from the full strategy palette
 except literal_iconic. Faces must remain abstracted."

 Level 80:
 "The reader prefers depictive cinematic illustration. Depict the actual scene content with
 readable figures, action, setting, and important objects, while choosing the camera angle,
 composition, and emotional emphasis with taste. Faces remain gestural rather than portrait-like.
 The image should feel scene-faithful, not vague."

 Level 90:
 "The reader prefers close scene depiction. Illustrate the actual scene action as clearly as
 the style seed's artistic medium allows. Figures, action, and setting should all be
 legible and readable. Faces remain gestural rather than portrait-like. The style seed
 medium always mediates — this is illustration, not photography.")

STYLE SEED: {styleSeed.name}
Medium/technique: {styleSeed.promptFragment}
Palette foundation: {styleSeed.paletteKeywords}

OUTPUT FORMAT:
Return a valid JSON object matching this schema:
{
  "momentFunction": one of [threshold, transformation, loss_of_innocence, promise_made,
    promise_delivered, betrayal, collision, sacrifice, cost_of_triumph, revelation,
    recognition, moral_choice, dread, temptation, grief, isolation, gathering,
    aftermath, return, suspense, opening_world],
  "visualStrategy": one of [literal_iconic, ritualized_action, symbolic_abstraction,
    object_centered, threshold_composition, emotional_landscape, environmental_pressure,
    aftermath_tableau, anticipation_frame, scale_contrast, character_silhouette,
    negative_space, rare_aerial],
  "perspective": one of [intimate_close, medium_human_scale, wide_establishing,
    solitary_figure_against_scale, low_angle, high_angle, rare_aerial,
    object_perspective, over_the_shoulder, silhouette_from_behind,
    environment_first, negative_space_dominant],
  "cameraDistance": one of [extreme_close, close, medium, medium_wide, wide, extreme_wide],
  "subjectFocus": one of [person, object, place, crowd_or_mass, threshold, natural_force,
    symbolic_motif, aftermath, absence],
  "motionLevel": one of [completely_still, potential_energy, slow_movement,
    purposeful_motion, rushing, violent_collision, settling_aftermath, exhausted_stillness],
  "emotionalTone": ["...", "...", "..."],
  "dominantEmotion": "...",
  "symbolicAnchors": ["...", "...", "..."],
  "concreteAnchors": ["...", "...", "..."],
  "composition": "...",
  "palette": ["...", "...", "..."],
  "lighting": "...",
  "texture": "...",
  "restraintRules": ["...", "..."],
  "avoidExplicitly": ["...", "..."],
  "diversityNotes": "...",
  "finalPrompt": "...",
  "negativePrompt": "..."
}
```

---

### Prompt Construction from Brief

The `buildFinalImagePrompt(brief, styleSeed)` function assembles the final image prompt from the brief's structured fields. It does not rely on Gemini's `finalPrompt` field alone — it validates and supplements it.

**Layer structure:**

```
[1] Core composition declaration
    → brief.composition

[2] Subject and focus statement
    → "{brief.subjectFocus} carries the weight of the scene"
    → Reference brief.concreteAnchors for specificity

[3] Perspective and distance
    → brief.perspective in natural language
    → brief.cameraDistance

[4] Motion and energy
    → brief.motionLevel in natural language

[5] Emotional atmosphere
    → brief.dominantEmotion + brief.emotionalTone

[6] Symbolic content
    → brief.symbolicAnchors (abstract symbols)
    → brief.concreteAnchors (physical objects)

[7] Visual parameters
    → Palette: brief.palette
    → Lighting: brief.lighting
    → Texture: brief.texture

[8] Style seed injection
    → styleSeed.promptFragment
    → styleSeed.paletteKeywords

[9] Quality, restraint, and interpretation register
    → Fine art quality declaration
    → Interpretation register from level:
      - 0–40: "Symbolic rather than literal. No figures or scene action."
      - 40–60: "Impressionistic. Scene implied through form and atmosphere."
      - 60–80: "Illustrative. Scene and figures rendered through the style seed medium."
      - 80–100: "Scene depiction. Illustrate the action as closely as the medium allows."
    → brief.restraintRules

[10] Negative constraints
    → brief.avoidExplicitly (scene-specific)
    → Level-gated figure/action restrictions (from the table in Strategy Availability)
    → Floor: not photorealistic, no watermarks, no readable text (always present)
```

**Example assembled prompt:**

```
An aftermath tableau of uneasy victory, organized around the remains of a broken battle 
standard in the foreground. The camera sits low and near to the ground, with the torn 
golden thread catching cold dawn light while defeated shapes fade into blue-grey shadow 
in the distance. The composition stays horizontal and still, with settling-aftermath 
energy — things have stopped moving, but the silence is uneasy rather than peaceful. 

Dominant emotions: grief and exhaustion, with the unsettled quality of a victory that 
cost more than it was worth. Symbolic anchors: the gold thread half-buried in dust, 
a guttered torch, the weight of abandoned tools. Concrete anchors: battlefield, 
shattered standard, armor fragments, red earth.

Palette: cold sky-blue shadow, muted iron grey, one ember-warm accent of faded gold. 
Lighting: cold horizontal dawn light — hard shadows, little warmth. Texture: rough, 
worn, scored, torn cloth and bent metal.

Painterly execution with dry-brush techniques. Highly detailed in the foreground, 
impressionistic in the distance. Fine art quality, symbolic rather than literal.

No gore or injury. No readable text. No human faces. No clear character depiction. 
No living figures in direct view. No photorealism. No digital art style.
```

---

## Scene Selection Scoring

The visual director also enriches the existing scene selection process. Currently, scenes are chosen based on inflection point significance. The new system adds a second-pass scoring layer.

**`src/pipeline/sceneSelectorScoring.ts`**

```ts
export interface SceneScore {
  sceneId: string;
  
  // Base scores (0.0 - 1.0)
  emotionalSignificance: number;     // from narrative weight
  visualLegibility: number;          // can this become a clear, compelling image?
  symbolicRichness: number;          // does the scene have strong symbolic anchors?
  narrativeTurningPoint: number;     // does something change permanently?
  objectPresence: number;            // is there a charged object that can carry the scene?
  thresholdPresence: number;         // is there a physical or metaphorical threshold?
  
  // Context scores
  pacingContribution: number;        // does this contribute visual pacing variety?
  distanceFromLast: number;          // word distance from previous image (normalized)
  diversityContribution: number;     // would this image add visual variety?
  
  // Penalties
  dialoguePenalty: number;           // scenes that are mostly dialogue get penalized
  characterLikenessPenalty: number;  // scenes requiring specific character depiction
  similarToRecentPenalty: number;    // similarity to already-scheduled scenes
  
  // Composite
  finalScore: number;
  selectionRationale: string;
}
```

**Scoring algorithm:**

The final score is a weighted sum:

```ts
finalScore = (
  emotionalSignificance * 0.25 +
  symbolicRichness * 0.15 +
  narrativeTurningPoint * 0.20 +
  pacingContribution * 0.15 +
  distanceFromLast * 0.10 +
  visualLegibility * 0.10
) - (
  dialoguePenalty * 0.20 +
  characterLikenessPenalty * 0.15 +
  similarToRecentPenalty * 0.20
)
```

High-scoring scenes (> 0.65) are strongly recommended. Scenes scoring below 0.40 should be dropped even if they were identified as inflection points, as their visual legibility is too low to justify an image.

---

## Opening Image Protocol

The opening image is different from all other images. It is not tied to an inflection point. Its job is to establish the book's emotional world before the reader has read anything significant.

**Opening image brief construction** differs:

1. The moment function is always `opening_world`
2. The visual strategy should remain scene-faithful while avoiding spoilers
3. The subject focus may be `person`, `place`, `object`, or `natural_force`, but it must establish the book's opening world without over-explaining later plot
4. The palette should reflect the book's dominant emotional tone from the arc analysis
5. The image should contain NO spoilers — no battles, deaths, betrayals, or plot-specific objects if possible
6. It should be the most ambient, atmospheric image in the book

**For Red Rising specifically:**
The arc is `rise-fall-rise`. The dominant world is Martian industrial underclass — red earth, low ceilings, deep shafts, ember warmth against pressure and darkness. The opening image should feel like:
- The weight of the underground before the story breaks upward
- Red dust, the smell of geothermal heat, the narrow shaft of a life not yet expanded
- Not Darrow. Not gold. Not the society. Just the world as it presses down.

**Opening image trigger:**
- When a book is opened and `activeSemanticMap` exists but no images are cached: generate opening image immediately, before any other generation
- When a new book is imported: after analysis completes, generate opening image before queuing others
- The opening image displays from first page until the first scene-specific image is reached

---

## Pre-Generation Scheduling

The revised scheduling algorithm:

```
Phase 1: Book opens
├── Load semantic map and existing briefs from storage
├── Load cached images
├── Set current display image based on reading position
└── If opening image missing → generate it (PRIORITY ZERO)

Phase 2: Ongoing
├── Every 2 seconds: update word position
├── Check: is the NEXT scheduled image generated?
│   ├── Yes → show "next scene forming" indicator under current image
│   └── No → queue brief creation + generation for next scene
├── When an image generates:
│   ├── Save to storage
│   ├── If reader has passed its scene position → display immediately
│   └── Otherwise → hold in cache for when reader arrives
└── When reader reaches scene position → smooth transition

Phase 3: Visual panel states
├── No book open → ambient layer (empty phase)
├── Book open, no API key → ambient layer (needs_key phase) + settings CTA
├── Book open, API key, no semantic map → ambient layer (needs_analysis phase) + analyze CTA
├── Analysis running → ambient layer (analyzing phase) with live progress
├── Analysis done, generating opening image → ambient layer (generating phase)
├── Opening image done → display it + "next scene forming" if generating
├── At a scene position, image ready → display scene image
├── Between scenes, images generated → hold last image
└── Image failed → ambient failure state + retry CTA
```

The visual panel should **never** be black and inactive while a book is open. Every state has a designed behavior.

---

## Visual Brief Storage

**Schema addition:**

The `IdentifiedScene` type gains an optional `directorBrief` field:

```ts
export interface IdentifiedScene {
  // ... existing fields ...
  directorBrief?: VisualDirectorBrief;
}
```

When the visual director produces a brief, it is attached to the scene and saved with the semantic map. This means:

1. Visual briefs persist with the semantic map
2. Re-opening a book reloads briefs without re-running the director
3. The diversity memory can be reconstructed from saved briefs
4. Future UI (regeneration, "more symbolic," etc.) has the brief to work from
5. Briefs are inspectable for debugging and quality improvement

**If the semantic map changes** (reanalysis), briefs are cleared and regenerated with the new scenes.

**If only images are regenerated** (user-requested), briefs are preserved and the existing brief's `finalPrompt` is used unless the user specifically requests a different strategy.

---

## Integration With Existing Pipeline

### Changes to `src/pipeline/semanticAnalyzer.ts`

Current pass structure:
```
Pass 1: analyzeStoryShape() → arc + inflection points
Pass 2: identifyScenes() → scene anchors + emotional data
Pass 3: generateImageDescriptions() → 2-4 sentence descriptions
```

New pass structure:
```
Pass 1: analyzeStoryShape() → arc + inflection points
Pass 2: identifyScenes() → scene anchors + emotional data
Pass 3: createVisualDirectorBriefs() → full structured briefs (replaces Pass 3)
```

Pass 3 is now handled by the visual director, not by a simple "generate description" call. The brief's `finalPrompt` field replaces `scene.imageDescription`.

The `imageDescription` field on `IdentifiedScene` is kept for backward compatibility but is no longer the primary prompt source. The image generator uses `scene.directorBrief?.finalPrompt ?? scene.imageDescription` as the prompt.

---

### Changes to `src/pipeline/imageGenerator.ts`

The prompt selection priority:

```ts
const prompt =
  scene.directorBrief?.finalPrompt   // preferred: director's structured prompt
  ?? buildImagePrompt(scene, styleSeed, priorPaletteContext)  // fallback: existing builder
```

The negative prompt:

```ts
const negativePrompt =
  scene.directorBrief?.negativePrompt  // preferred: scene-specific negative
  ?? NEGATIVE_PROMPT                   // fallback: standard negative
```

---

### Changes to `src/hooks/useBookOrchestration.ts`

The `_runAnalysis` function runs Pass 3 (visual director). After `analyzeBook()` returns the semantic map, run the director:

```ts
// After analyzeBook():
const semanticMap = await analyzeBook(structure, googleKey, onProgress);

// New: run visual director on all scenes
// Pull interpretation level from settings at the time of analysis
const { visualInterpretationLevel } = useSettingsStore.getState();

const enrichedScenes = await createVisualDirectorBriefs({
  scenes: semanticMap.scenes,
  semanticMap,
  structure,
  styleSeed,
  interpretationLevel: visualInterpretationLevel,
  apiKey: googleKey,
  onProgress: (msg) => setAnalysisProgress(msg),
});

const finalMap: SemanticMap = {
  ...semanticMap,
  scenes: enrichedScenes,
};

await storage.saveSemanticMap(finalMap);
```

---

### New Progress Messages

The analysis progress stream should be extended:

```
"Scoring emotional trajectory…"           ← Pass 1 (existing)
"Identifying key moments…"                ← Pass 2 (existing)
"Building visual interpretations…"        ← Pass 3 new label
"Visual interpretation 1 of 8…"
"Visual interpretation 2 of 8…"
"Writing visual brief 3 of 8…"
"Composing visual language for chapter 14…"
"Visual direction complete — generating first scene…"
```

---

## Diversity Memory Lifecycle

**Construction:**
When analysis completes for a book, `diversityMemory` is empty. It is built progressively as briefs are created.

Within the director run for a single book, briefs are created sequentially (not in parallel), and each brief is fed back into the memory before the next brief is created. This ensures in-session diversity even during the first run.

**Persistence:**
The `DiversityMemory` is not stored separately. It is reconstructed from the saved briefs whenever needed:

```ts
const memory = buildDiversityMemory(semanticMap.scenes
  .filter(s => s.directorBrief)
  .map(s => s.directorBrief!));
```

**On regeneration:**
If a user regenerates a single image, the diversity memory at that position in the sequence is reconstructed from the scenes that come before it. The regenerated brief must respect diversity pressure from its predecessors, even if they were generated earlier.

---

## Repetition Detection Algorithm

**`detectRepetitionPressure(memory: DiversityMemory): RepetitionPressure`**

```ts
function detectRepetitionPressure(memory: DiversityMemory): RepetitionPressure {
  const window = 3; // look at last 3 images

  const overusedStrategies = findOverused(
    memory.recentVisualStrategies.slice(-window),
    window
  );

  const overusedPerspectives = findOverused(
    memory.recentPerspectives.slice(-window),
    window,
    ['rare_aerial'] // perspectives that should be flagged if used at all recently
  );

  const overusedSubjectFoci = findOverused(
    memory.recentSubjectFoci.slice(-window),
    window
  );

  const overusedMotionLevels = findOverused(
    memory.recentMotionLevels.slice(-window),
    window
  );

  const aerialViewBlocked = memory.aerialViewUsed;

  // Build natural language instructions
  const instructions: string[] = [];

  if (overusedStrategies.length > 0) {
    instructions.push(
      `Do not use these visual strategies (recently overused): ${overusedStrategies.join(', ')}`
    );
  }

  if (overusedPerspectives.length > 0) {
    instructions.push(
      `Do not use these perspectives (recently overused): ${overusedPerspectives.join(', ')}`
    );
  }

  if (aerialViewBlocked) {
    instructions.push(
      `Aerial view (rare_aerial) has already been used in this book. Do not use it again.`
    );
  }

  if (overusedMotionLevels.length > 0) {
    instructions.push(
      `Vary the energy level. Recent images have used: ${overusedMotionLevels.join(', ')}. Choose a different motion level.`
    );
  }

  // Tone pattern analysis
  const recentTones = memory.recentDominantEmotions.slice(-3);
  const tonePattern = detectToneCluster(recentTones);
  if (tonePattern) {
    instructions.push(
      `Recent images have clustered around ${tonePattern}. Introduce contrast — choose a different emotional register.`
    );
  }

  return {
    overusedStrategies,
    overusedPerspectives,
    overusedSubjectFoci,
    overusedMotionLevels,
    aerialViewBlocked,
    tonePatternNote: tonePattern ?? "",
    diversityInstructions: instructions.join('\n'),
  };
}

// A value is "overused" if it appears 2+ times in the window
function findOverused<T>(
  recent: T[],
  threshold: number,
  alwaysFlagIfPresent: T[] = []
): T[] {
  const counts = new Map<T, number>();
  for (const v of recent) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const overused: T[] = [];
  for (const [value, count] of counts) {
    if (count >= 2 || alwaysFlagIfPresent.includes(value)) {
      overused.push(value);
    }
  }
  return overused;
}

function detectToneCluster(tones: string[]): string | null {
  const darkTones = ['dread', 'grief', 'despair', 'isolation', 'loss', 'fear', 'darkness'];
  const triumphTones = ['triumph', 'victory', 'hope', 'elation', 'joy', 'resolution'];
  const tensionTones = ['suspense', 'tension', 'anticipation', 'pressure', 'conflict'];

  const darkCount = tones.filter(t => darkTones.some(d => t.includes(d))).length;
  const triumphCount = tones.filter(t => triumphTones.some(d => t.includes(d))).length;
  const tensionCount = tones.filter(t => tensionTones.some(d => t.includes(d))).length;

  if (darkCount >= 2) return "darkness/grief/isolation";
  if (triumphCount >= 2) return "triumph/victory/hope";
  if (tensionCount >= 2) return "suspense/tension/pressure";
  return null;
}
```

---

## Worked Example: Red Rising Army Scene

**Input:**
- Scene: Darrow runs alone toward the army of the opposing house
- Moment function (from analysis): `sacrifice` or `threshold`
- Nearby text keywords: charge, alone, faster, impossible, army, chosen
- Arc position: early climax of `rise-fall-rise`

**Diversity memory entering this brief:**
- Last 3 images: wide establishing shots, dread/suspense tone, environmental_pressure strategy
- Aerial view: not yet used

**Repetition pressure output:**
```
Do not use environmental_pressure strategy (recently overused).
Do not use wide_establishing perspective (recently overused).
Vary the emotional register — recent images have clustered around dread/suspense.
Introduce contrast — chose a different emotional register (resolve, sacrifice, cost).
Aerial view is available but should be reserved for a more strategic moment.
```

**Director brief (generated by Gemini with the above constraints):**

```json
{
  "momentFunction": "sacrifice",
  "visualStrategy": "scale_contrast",
  "perspective": "silhouette_from_behind",
  "cameraDistance": "medium_wide",
  "subjectFocus": "person",
  "motionLevel": "purposeful_motion",
  "emotionalTone": ["resolve", "cost", "impossible clarity"],
  "dominantEmotion": "resolve",
  "symbolicAnchors": ["single ember forward", "iron weight behind", "the gap between"],
  "concreteAnchors": ["running figure", "mass of armored shapes", "dust", "field"],
  "composition": "The figure occupies the left third of the frame, seen from behind at medium height. The army fills the right two-thirds as a dark mass rather than individual soldiers. The gap between them is the emotional subject.",
  "palette": ["red-orange dust", "cold iron shadow", "faint amber backlight"],
  "lighting": "Backlight from behind the army creates silhouette on the figure; dust diffuses both into near-equal haziness at the boundary.",
  "texture": "rough, gritty, dry — dust-abraded surfaces",
  "restraintRules": [
    "No clear faces on either side",
    "Army should not be readable as individuals",
    "Do not show the collision — show the moment before"
  ],
  "avoidExplicitly": [
    "literal battle action",
    "gore",
    "readable text or insignia",
    "portraits or identifiable features"
  ],
  "diversityNotes": "Used scale_contrast and silhouette_from_behind to break the recent pattern of wide environmental shots. Shifted from dread to resolve.",
  "finalPrompt": "A single figure breaks into motion from behind, seen at medium height, moving left to right across a field of red-orange dust toward a distant mass that reads more as dark iron shadow than individual soldiers. The army fills two-thirds of the frame but its details dissolve into cold haze; only the figure has motion, intention, and a thin amber backlight catching the dust around his shoulders. The gap between figure and mass is the emotional subject — the space between decision and consequence. Painterly, symbolic, gritty texture throughout, resolve rather than fear, no readable faces or text, not photorealistic.",
  "negativePrompt": "photorealistic, photograph, comic book, anime, cartoon, manga, text, words, letters, watermarks, visible faces, portraits, gore, injury, detailed armor, individual soldiers, crowd detail, CGI, 3d render"
}
```

**Alternative brief for the same scene with different director choice:**

The director might alternatively classify this as `threshold` and use `object_centered`:

```json
{
  "momentFunction": "threshold",
  "visualStrategy": "object_centered",
  "perspective": "intimate_close",
  "cameraDistance": "close",
  "subjectFocus": "object",
  "motionLevel": "potential_energy",
  "emotionalTone": ["decision crystallized", "weight of commitment", "cold clarity"],
  "dominantEmotion": "commitment",
  "symbolicAnchors": ["the edge of a threshold", "one step forward", "point of no return"],
  "concreteAnchors": ["boot or foot at a line in the dust", "the line itself as a demarcation"],
  "composition": "Extreme low angle, close to ground. A single boot or foot suspended at the edge of a shadow line in red dust. The army behind is out of focus, implied by dark mass. The decision is in the foot.",
  "palette": ["warm red dust in foreground", "cold iron grey in background", "amber specular on the line"],
  ...
}
```

Both are valid. The diversity memory and the moment's position in the arc determine which strategy is preferred. If the previous image was already a figure-scale image, the object-centered approach brings welcome contrast.

**Same scene at interpretation level 15 (pure interpretation):**

```json
{
  "momentFunction": "threshold",
  "visualStrategy": "symbolic_abstraction",
  "perspective": "environment_first",
  "cameraDistance": "extreme_wide",
  "subjectFocus": "natural_force",
  "motionLevel": "potential_energy",
  "emotionalTone": ["impossible weight", "compressed fire", "the held breath before everything changes"],
  "dominantEmotion": "resolve before rupture",
  "symbolicAnchors": ["a single ember in darkness", "iron pressing down", "the hairline crack before breaking"],
  "concreteAnchors": ["red dust", "vast shadow", "one point of amber warmth"],
  "composition": "A field of iron shadow occupies almost the entire frame. At the lower-left edge, a single point of warm amber light — small, still, barely there — faces an undifferentiated mass of cold. No figures. No action. The image is the gap between.",
  "finalPrompt": "An abstract composition in iron shadow and ember warmth. A vast cold darkness occupies almost all of the frame; a single point of amber light persists at one edge, neither advancing nor retreating — only being. The space between them is the subject. No figures, no scene, no action. Pure emotional weight rendered in tone and field. Painterly, atmospheric, non-representational.",
  "negativePrompt": "photorealistic, any human figure, scene action, identifiable setting, literal depiction, comic book, manga, CGI, digital art, 3d render, text, watermarks"
}
```

**Same scene at interpretation level 90 (scene depiction):**

```json
{
  "momentFunction": "sacrifice",
  "visualStrategy": "literal_iconic",
  "perspective": "low_angle",
  "cameraDistance": "medium_wide",
  "subjectFocus": "person",
  "motionLevel": "rushing",
  "emotionalTone": ["reckless courage", "the body ahead of the mind", "no going back"],
  "dominantEmotion": "committed motion",
  "symbolicAnchors": ["dust rising at the heels", "the distance shrinking"],
  "concreteAnchors": ["armored figure mid-stride", "opposing army wall", "red earth field"],
  "composition": "Low-angle view slightly behind and below the charging figure. His full form is visible — armor, stride, intention. The opposing army is a wall of shapes ahead, compressed by distance into something massive and indistinct. The low angle amplifies both his motion and the scale of what he runs toward.",
  "finalPrompt": "Low-angle view of an armored figure mid-stride across red earth, seen from slightly behind and below. His posture and motion are clear and intentional — running into something impossible. The opposing army ahead compresses into a dark mass at middle distance. Red dust rises at his heels. The image is scene depiction filtered through painterly technique — figures and action readable, faces gestural rather than portrait-like, rendered in the style of detailed fantasy illustration with atmospheric depth.",
  "negativePrompt": "photorealistic, portrait photography, identifiable faces, gore, readable text, watermarks, CGI, 3d render, digital illustration style"
}
```

The diversity memory, moment function, and pacing logic work identically at all three levels. Only the strategy palette and prompt register change.

---

## Future: Regeneration UI

Once the Visual Director layer is built, user-directed regeneration becomes meaningful. Instead of "try again with the same prompt," the user can regenerate with a specific director instruction:

**Regeneration options presented in the UI:**

```
Regenerate this image as:
  → More interpretive      (drops interpretation level by 25 for this image only)
  → More illustrative      (raises interpretation level by 25 for this image only)
  → More symbolic          (forces symbolic_abstraction or object_centered)
  → More intimate          (forces intimate_close or close camera distance)
  → Wider / more epic      (forces wide_establishing or rare_aerial if available)
  → Quieter                (forces completely_still or potential_energy motion level)
  → Different emotional register (forces tone contrast from current brief)
  → Focus on the object    (forces object_centered, subjectFocus: "object")
  → Show the aftermath     (forces aftermath_tableau, subjectFocus: "aftermath")
  → Regenerate differently (full re-brief with diversity pressure applied)
```

"More interpretive" and "More illustrative" are single-image overrides — they do not change the global `visualInterpretationLevel` setting. They let the reader fine-tune one specific image without shifting the entire book's visual register.

These are director-level instructions, not prompt-level edits. The user does not edit prompts; they redirect the director, and the director rewrites the prompt accordingly.

Implementation: each regeneration option maps to a set of `DirectorConstraintOverrides` passed to `createVisualDirectorBrief()`, which uses them to constrain Gemini's output.

---

## Implementation Order

### Step 1 — Types and Settings
Create `src/pipeline/visualDirectorTypes.ts` with all types:
`MomentFunction`, `VisualStrategy`, `VisualPerspective`, `SubjectFocus`, `MotionLevel`, `CameraDistance`, `VisualDirectorBrief`, `DiversityMemory`, `RepetitionPressure`

Update `src/types/index.ts`:
- Add `directorBrief?: VisualDirectorBrief` to `IdentifiedScene`
- Add `visualInterpretationLevel: number` to `UserSettings`

Update `src/store/settingsStore.ts`:
- Add `visualInterpretationLevel: 80` to defaults
- Add `setVisualInterpretationLevel: (level: number) => void` action

### Step 2 — Visual Director Core
Create `src/pipeline/visualDirector.ts`:
- `createVisualDirectorBrief()`
- `buildDiversityMemory()`
- `updateDiversityMemory()`
- `detectRepetitionPressure()`
- `buildFinalImagePrompt()`
- Gemini prompt templates and JSON parsing
- Error handling with graceful fallback to existing description

### Step 3 — Scene Scoring
Create `src/pipeline/sceneSelectorScoring.ts`:
- `scoreScene()` function
- `selectFinalScenes()` override for existing scorer

### Step 4 — Semantic Analyzer Integration
Modify `src/pipeline/semanticAnalyzer.ts`:
- Replace `generateImageDescriptions()` with `createVisualDirectorBriefs()`
- Pass diversity memory through the scene sequence
- Update progress messages
- Fallback: if director fails for a scene, use existing description builder

### Step 5 — Image Generator Integration
Modify `src/pipeline/imageGenerator.ts`:
- Use `scene.directorBrief?.finalPrompt` as primary prompt
- Use `scene.directorBrief?.negativePrompt` as primary negative
- Fallback to existing `buildImagePrompt()` if no brief

### Step 6 — Storage
Update `src/storage/StorageAdapter.ts`:
- No changes needed (briefs stored inside SemanticMap.scenes)

Update `src/storage/TauriStorageAdapter.ts` and `WebStorageAdapter.ts`:
- No changes needed (existing `saveSemanticMap` saves scenes with briefs)

### Step 7 — Orchestration
Update `src/hooks/useBookOrchestration.ts`:
- Run visual director after `analyzeBook()` returns
- Pass director briefs to saving step
- Add director-specific progress messages

### Step 8 — Opening Image Protocol
Update `src/hooks/useBookOrchestration.ts`:
- Ensure opening image always generates first after analysis
- Use `opening_world` moment function for scene 0

Update `src/hooks/useEpubImport.ts` / `openBook`:
- Ensure opening image displays immediately on re-open

### Step 9 — Visual Panel States
Update `src/components/visual/AmbientSceneLayer.tsx`:
- Add `director_briefing` phase
- Update phase messages to reflect new pipeline language

### Step 10 — Settings Slider UI
Update `src/components/common/SettingsPanel.tsx`:
- Add "Visual Style" section with interpretation level slider
- Slider: 0–100 range, labeled "Interpretive ←→ Illustrative"
- Dynamic label: "Interpretive" / "Atmospheric" / "Balanced" / "Illustrative" / "Scene Depiction"
- One-line description under slider explaining what images look like at current value
- On change: call `setVisualInterpretationLevel(value)` — updates immediately
- Note: changing the level does not regenerate existing images; applies to next generation

### Step 12 — Diagnostics
Add optional verbose logging throughout the director pipeline:
```
[Director] Scene 3/8: sacrifice at chapter 14
[Director] Repetition pressure: avoid environmental_pressure, wide_establishing
[Director] Brief: scale_contrast, silhouette_from_behind, resolve, purposeful_motion
[Director] Prompt length: 847 chars
[Director] Diversity: breaking recent pattern of dread/wide/environmental
```

---

## File Summary

| File | Status | Purpose |
|---|---|---|
| `src/pipeline/visualDirectorTypes.ts` | New | All Visual Director type definitions |
| `src/pipeline/visualDirector.ts` | New | Core director logic and Gemini integration |
| `src/pipeline/sceneSelectorScoring.ts` | New | Scene selection scoring system |
| `src/pipeline/semanticAnalyzer.ts` | Modify | Replace Pass 3 with visual director |
| `src/pipeline/imageGenerator.ts` | Modify | Use director brief as primary prompt source |
| `src/hooks/useBookOrchestration.ts` | Modify | Run director, pass interpretation level, wire opening image protocol |
| `src/types/index.ts` | Modify | Add `directorBrief` to `IdentifiedScene`, add `visualInterpretationLevel` to `UserSettings` |
| `src/store/settingsStore.ts` | Modify | Add `visualInterpretationLevel` default (80) and action |
| `src/components/common/SettingsPanel.tsx` | Modify | Add Visual Style slider (Interpretive ↔ Illustrative) |
| `src/components/visual/AmbientSceneLayer.tsx` | Modify | New phase states |

---

## Remaining Work / Corrections

These are product corrections discovered during live testing and discussion. They should guide the next implementation pass.

### Gallery Orientation

The generated-image gallery should not be locked to one orientation.

It should support:

- **Horizontal gallery** for desktop/tablet landscape, where images read like a visual strip or panorama.
- **Vertical gallery** for portrait/tablet/mobile, where images stack naturally and can be scanned like a visual chapter list.
- A responsive default chosen by viewport and panel layout.
- Future optional toggle if needed: horizontal / vertical.

The current horizontal gallery is a first attempt and needs repair/polish. If it does not open, scroll, or show images reliably, fixing the gallery is a priority.

### Plan The Whole Visual Story, Generate Sparingly

Lumina should distinguish between **planning** images and **generating** images.

Planning should be broad:

```
Book text
→ emotional arc
→ full visual pathway
→ candidate beats from beginning to end
→ scene blocks for important future moments
→ director briefs / planned visual intentions
```

Generation should remain sparse and budget-aware:

```
Only selected default-range beats are generated automatically.
Images generate one at a time.
The next image can use previous generated images, prior briefs, book context,
and the full storyboard pathway to stay coherent.
```

The system should be allowed to understand the whole book visually without trying to render every possible image. The planned-but-not-generated beats become the visual roadmap; generated images are the selected artifacts that actually cost money.

### Future-Context-Aware Planning

The storyboard should account for the whole piece, not just the current scene in isolation.

Each planned beat should know:

- What came before
- What it is setting up
- Whether it is suspense, mystery, promise, payoff, cost, aftermath, or closing
- Which earlier visual elements it echoes
- Which later visual elements it should prepare
- Whether it deserves generation by default or should remain planned only

This lets Lumina tell a coherent picture-story without generating too many images.

### Generated vs Planned Images

The gallery should eventually distinguish:

- **Generated images**: visible thumbnails the reader can open or revisit.
- **Planned images**: storyboard beats that exist as future visual intentions but have not been generated.
- **Reader-requested images**: images created from highlighted passages and inserted into the visual story.

This does not need to feel technical. It can be presented as a simple visual story timeline where generated images appear fully and planned beats appear as quiet placeholders.

### Regeneration Replacement

Regeneration must replace the old image for the same scene.

Rules:

- Keep the same `sceneId`.
- Keep the same scene anchor.
- Keep the same storyboard beat.
- Replace the displayed image and cached image metadata.
- Do not create a duplicate scene unless the reader explicitly requested a new inserted image from selected text.

### Highlighted Passage Images

Reader-selected images should:

- Be created from highlighted/selected text.
- Become custom scenes.
- Be inserted between the generated/planned image before and after the selected passage.
- Persist with the book's semantic map/storyboard.
- Be marked as reader-requested so they are not confused with default sparse planned images.

---

## The Goal Restated

Every image Lumina generates should be able to answer four questions:

```
1. Why this moment?
   → Because it is emotionally significant in this specific way.

2. Why this visual strategy?
   → Because this strategy serves this type of moment, is available
     at the reader's interpretation level, and the recent images have
     not used it — so it adds visual variety.

3. Why this composition, palette, and perspective?
   → Because these choices carry the specific emotional tone of this
     moment, anchor to its symbolic content, and maintain the visual
     grammar of this book's style seed.

4. Why this degree of literal or interpretive rendering?
   → Because the reader prefers it. The image should feel exactly as
     close to or as far from the scene as the reader finds most compelling.
     The intelligence of the system — moment function, diversity, pacing —
     operates at every level of the spectrum.
```

If any of those three questions cannot be answered by the brief, the brief is incomplete and should be regenerated.

The brief is not a means to an end. The brief is the intelligence of the system, made visible. When the system is working well, reading a book's sequence of briefs should feel like reading a thoughtful director's notes — a complete account of why this visual story was told the way it was told.
