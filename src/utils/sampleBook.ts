/**
 * sampleBook — builds a small, valid multi-chapter EPUB in memory for DEV
 * testing (verifying the reader, pagination, paragraphs, focus mode) without
 * needing a file picker or network. Not shipped in production UI paths.
 */

import JSZip from "jszip";

interface SampleChapter {
  id: string;
  title: string;
  paragraphs: string[];
}

/**
 * Themed atmospheric sentence pools. We assemble extra paragraphs from these so
 * each chapter is long enough (~2,000–2,800 words) to exercise real Study Guide
 * segmentation (multi-segment chapters), while still reading as coherent prose.
 * Hand-written opening and closing paragraphs (below) bookend each chapter.
 */
const ATMOSPHERE: string[][] = [
  [
    "The morning came in grey and unhurried, the way it always did along this stretch of coast.",
    "Somewhere out past the breakwater a bell buoy tolled, slow and patient, marking a channel no one used anymore.",
    "She had learned long ago that the sea kept its own counsel and offered nothing it was not asked for twice.",
    "Salt had worked its way into everything here — the railings, the window frames, the very grain of the wood beneath her hand.",
    "A fisherman raised one hand to her in greeting and she returned it without quite remembering his name.",
    "The tide was going out, dragging its long fingers through the shingle, and the gulls followed it down to the waterline.",
    "There was a rhythm to the place that asked nothing of her, and that, more than anything, was why she had stayed away.",
    "Even the light seemed older here, filtered through cloud and habit until it lay soft and forgiving over the rooftops.",
  ],
  [
    "Memory, she had decided, was less a record than a weather — it arrived without warning and left the ground changed.",
    "She turned the thought over the way she might turn a stone, looking for the dry side, the side that had not touched the dark.",
    "There were things one carried not because they were heavy but because setting them down required a place to set them.",
    "The kettle ticked as it cooled, and the small ordinary sound was almost enough to hold the larger silence at bay.",
    "She thought of her mother's hands, and her father's voice, and the particular hush of a house where no one is angry yet.",
    "Forgiveness, if it came at all, would not arrive as a thunderclap but as a slow thaw, unnoticed until the river moved.",
    "Outside, a dog barked twice and gave it up, and the street returned to the business of being empty.",
    "She had rehearsed a hundred conversations and meant none of them, and now the words sat unused in her like coins.",
  ],
  [
    "The road unspooled ahead of her, pale and certain, threading the green hills toward a horizon she could not yet name.",
    "Mile by mile the country opened, and with it something in her chest she had kept clenched for longer than she knew.",
    "She passed a church, a closed petrol station, a field where two horses stood nose to tail against the wind.",
    "The radio gave her static and then a hymn and then static again, and she let it play to the empty seats behind her.",
    "It was strange how leaving could feel so much like arriving, as if the going itself were the place she had meant to reach.",
    "The hills folded one into the next, patient as sleeping animals, and the morning warmed by degrees against the glass.",
    "She did the sums of her life as she drove — what was owed, what was spent, what could still, with care, be saved.",
    "Ahead, a bridge crossed a river the colour of weak tea, and beyond it the road climbed and was lost in light.",
  ],
];

/** Build `count` atmospheric paragraphs (4–5 sentences each) for chapter `idx`. */
function buildAtmosphere(idx: number, count: number): string[] {
  const pool = ATMOSPHERE[idx % ATMOSPHERE.length];
  const out: string[] = [];
  let cursor = 0;
  for (let p = 0; p < count; p++) {
    const len = 4 + (p % 2); // alternate 4 / 5 sentences
    const sentences: string[] = [];
    for (let s = 0; s < len; s++) {
      sentences.push(pool[cursor % pool.length]);
      cursor++;
    }
    out.push(sentences.join(" "));
  }
  return out;
}

const CHAPTERS: SampleChapter[] = [
  {
    id: "ch1",
    title: "Chapter One: The Quiet Harbor",
    paragraphs: [
      "The harbor lay still under a sky the colour of worn pewter, and the boats nodded at their moorings as though half-asleep. Mara walked the length of the pier with her collar turned up, counting the gulls that wheeled and complained above the empty fish stalls.",
      "She had not meant to come back. The town had a way of holding people the way a tide holds a stranded thing — gently, and then not gently at all. Every plank of the boardwalk knew her name, and she resented each one for remembering.",
      "At the far end, where the lamps gave out and the dark water began, a single light burned in the window of the old chandlery. Someone was awake. Someone was waiting, perhaps, though she could not say for whom, or why the thought made her walk faster.",
      "The wind carried salt and the green smell of rope and tar. She breathed it in despite herself, and for one treacherous moment she was twelve years old again, running these same boards with her shoes in her hand and the whole bright summer ahead of her.",
    ],
  },
  {
    id: "ch2",
    title: "Chapter Two: A Letter Unopened",
    paragraphs: [
      "The envelope had been waiting on the kitchen table for three days, propped against the sugar tin where she could not pretend not to see it. Her own name stared back in handwriting she had spent years learning to forget.",
      "Twice she had picked it up. Twice she had set it down again, as if it were warmer than paper had any right to be. Now, in the grey hour before dawn, she sat across from it with a cup of tea gone cold and made her decision.",
      "Whatever it said, it could not unmake what had already happened. That was the small, hard comfort she clung to. The past was a country with no roads back; you could only stand at its border and read the signs.",
      "She slid her thumb beneath the flap. The seal gave with a sound like a held breath finally let go.",
    ],
  },
  {
    id: "ch3",
    title: "Chapter Three: The Long Way Home",
    paragraphs: [
      "By the time the sun cleared the headland, Mara was already on the coast road, the letter folded small in her coat pocket and a decision folded smaller still in her chest. The fields ran gold to either side, heavy with a harvest no one had come to claim.",
      "She thought about forgiveness, and how it was less a single act than a long, patient labour — the daily choosing of one road over another until the choosing wore a groove and became, at last, a kind of peace.",
      "The town fell away behind her, smaller and smaller in the wing mirror, until it was only a smudge of rooftops and a single thread of smoke. She did not look back again. There was, she found, nothing left there that she needed.",
      "Ahead, the road bent toward the hills and the wide uncertain morning. She drove into it with the windows down, and the wind took the last of the harbor smell from her hair, and she let it go.",
    ],
  },
];

function chapterXhtml(ch: SampleChapter): string {
  const body = [`<h1>${escapeXml(ch.title)}</h1>`, ...ch.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`)].join(
    "\n    "
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${escapeXml(ch.title)}</title></head>
  <body>
    ${body}
  </body>
</html>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function buildSampleEpubFile(): Promise<File> {
  const zip = new JSZip();
  const title = "The Long Way Home";
  const author = "Lumina Sample";

  zip.file("mimetype", "application/epub+zip");

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // Compose full chapters: hand-written opening, themed atmospheric middle,
  // hand-written close. Big enough (~2,400 words each) that Study Guide
  // segmentation splits each chapter into multiple study segments.
  const fullChapters: SampleChapter[] = CHAPTERS.map((ch, i) => {
    const [open1, open2, close1, close2] = ch.paragraphs;
    return {
      ...ch,
      paragraphs: [open1, open2, ...buildAtmosphere(i, 30), close1, close2],
    };
  });

  for (const ch of fullChapters) {
    zip.file(`OEBPS/${ch.id}.xhtml`, chapterXhtml(ch));
  }

  const manifestItems = CHAPTERS.map(
    (ch) => `<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`
  ).join("\n    ");
  const spineItems = CHAPTERS.map((ch) => `<itemref idref="${ch.id}"/>`).join("\n    ");

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:identifier id="bookid">urn:uuid:lumina-sample-0001</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`
  );

  const navPoints = CHAPTERS.map(
    (ch, i) => `<navPoint id="nav-${ch.id}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="${ch.id}.xhtml"/>
    </navPoint>`
  ).join("\n    ");

  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:lumina-sample-0001"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`
  );

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  return new File([blob], "lumina-sample.epub", { type: "application/epub+zip" });
}
