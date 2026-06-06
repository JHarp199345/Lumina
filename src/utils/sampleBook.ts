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

  for (const ch of CHAPTERS) {
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
