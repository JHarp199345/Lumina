/** Project Gutenberg cache filenames: pg43-images-3.epub → 43 */
export function gutenbergIdFromFilename(name: string): number | undefined {
  const base = name.trim().split("/").pop() ?? name;
  const match = base.match(/^pg(\d+)/i);
  if (!match?.[1]) return undefined;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

/** Basename from a download URL path (e.g. cache/epub/1661/pg1661-images-3.epub). */
export function filenameFromUrl(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const base = path.split("/").filter(Boolean).pop() ?? "";
    if (base && /\.epub/i.test(base)) return base;
    if (base) return base;
  } catch {
    const match = url.match(/\/([^/?#]+\.epub[^/?#]*)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return "download.epub";
}

/** Map Project Gutenberg ebook URLs to the cache filename browsers receive after redirect. */
export function gutenbergFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("gutenberg.org")) return null;

    const base = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (/^pg\d+.+\.epub$/i.test(base)) return base;

    const match = parsed.pathname.match(/\/ebooks\/(\d+)\.(.+)$/i);
    if (!match) return null;

    const [, id, variant] = match;
    const v = variant.toLowerCase();
    if (v.includes("epub3.images")) return `pg${id}-images-3.epub`;
    if (v.includes("epub.images")) return `pg${id}-images.epub`;
    if (v.includes("epub3")) return `pg${id}-3.epub`;
    if (v.includes("epub")) return `pg${id}.epub`;
    return null;
  } catch {
    return null;
  }
}

function filenameFromContentDisposition(header: string): string | null {
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return star[1].trim();
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

/** Best-effort filename: follow redirects when possible, else Gutenberg URL rules, else path basename. */
export async function resolveDownloadFilename(url: string): Promise<string> {
  const gutenberg = gutenbergFilenameFromUrl(url);
  if (gutenberg) return gutenberg;

  try {
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
    });
    if (response.url && response.url !== url) {
      const fromRedirect = filenameFromUrl(response.url);
      if (/\.epub/i.test(fromRedirect)) return fromRedirect;
    }
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      const fromHeader = filenameFromContentDisposition(disposition);
      if (fromHeader && /\.epub/i.test(fromHeader)) return fromHeader;
    }
  } catch {
    /* CORS or network — fall through */
  }

  return filenameFromUrl(url);
}
