// Generates a minimal valid EPUB for highlight testing → public/test-book.epub
import JSZip from "jszip";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "test-book.epub");

const para = (n) =>
  `<p>Paragraph ${n}. The old king stared over the battlefield as a cold wind carried ash across the broken field. Victory had cost him his sons, and the crown upon his brow felt heavier than any blade he had ever lifted. He thought of the river at home, of quiet mornings before the war, and of all the names he could no longer say aloud without his voice breaking.</p>`;

const chapter = (title, count) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${Array.from({ length: count }, (_, i) => para(i + 1)).join("\n")}</body></html>`;

const zip = new JSZip();
// mimetype must be first and stored (uncompressed)
zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
zip.file(
  "META-INF/container.xml",
  `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
);
zip.file(
  "OEBPS/content.opf",
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:lumina-test-0001</dc:identifier>
    <dc:title>Lumina Highlight Test</dc:title>
    <dc:creator>Lumina QA</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`
);
zip.file(
  "OEBPS/nav.xhtml",
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><ol>
  <li><a href="chapter1.xhtml">Chapter One — The Gathering Storm</a></li>
  <li><a href="chapter2.xhtml">Chapter Two — The Old King</a></li>
</ol></nav></body></html>`
);
zip.file("OEBPS/chapter1.xhtml", chapter("Chapter One — The Gathering Storm", 8));
zip.file("OEBPS/chapter2.xhtml", chapter("Chapter Two — The Old King", 8));

const buf = await zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
writeFileSync(out, buf);
console.log("Wrote", out, buf.length, "bytes");
