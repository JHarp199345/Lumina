import { storage } from "@/storage";
import type {
  BookProfile,
  BookProfileArtifactStamp,
  BookProfileArtifactType,
  SemanticMap,
} from "@/types";

function overlapsRange(
  artifact: BookProfileArtifactStamp,
  startPosition?: number,
  endPosition?: number
): boolean {
  if (typeof startPosition !== "number" || typeof endPosition !== "number") return true;
  if (typeof artifact.startPosition !== "number" || typeof artifact.endPosition !== "number") return false;
  return artifact.startPosition <= endPosition && artifact.endPosition >= startPosition;
}

function stampsFromSemanticMap(map: SemanticMap | null): BookProfileArtifactStamp[] {
  return map?.bookProfile?.artifactIndex ?? [];
}

/** Load the durable book profile, falling back to the embedded semantic-map copy. */
export async function loadMountedBookProfile(bookId: string): Promise<BookProfile | null> {
  const direct = await storage.loadBookProfile(bookId).catch(() => null);
  if (direct) return direct;
  const map = await storage.loadSemanticMap(bookId).catch(() => null);
  if (map?.bookProfile) {
    await storage.saveBookProfile(map.bookProfile).catch(() => {});
    return map.bookProfile;
  }
  return null;
}

/** Retrieve stamped artifacts from the profile without loading every heavy object. */
export async function loadProfileArtifacts(
  bookId: string,
  options: {
    types?: BookProfileArtifactType[];
    startPosition?: number;
    endPosition?: number;
    statuses?: BookProfileArtifactStamp["status"][];
  } = {}
): Promise<BookProfileArtifactStamp[]> {
  const profile = await loadMountedBookProfile(bookId);
  const typeSet = options.types ? new Set(options.types) : null;
  const statusSet = options.statuses ? new Set(options.statuses) : null;
  return (profile?.artifactIndex ?? [])
    .filter((artifact) => !typeSet || typeSet.has(artifact.artifactType))
    .filter((artifact) => !statusSet || statusSet.has(artifact.status))
    .filter((artifact) => overlapsRange(artifact, options.startPosition, options.endPosition))
    .sort(
      (a, b) =>
        (a.startPosition ?? 0) - (b.startPosition ?? 0) ||
        a.artifactType.localeCompare(b.artifactType) ||
        a.artifactId.localeCompare(b.artifactId)
    );
}

/** Compatibility helper for older maps that have not been copied into the profile store yet. */
export async function ensureSemanticMapProfileSaved(map: SemanticMap | null): Promise<void> {
  if (!map?.bookProfile) return;
  await storage.saveBookProfile(map.bookProfile);
}

export function artifactsForRangeFromMap(
  map: SemanticMap | null,
  startPosition: number,
  endPosition: number,
  types?: BookProfileArtifactType[]
): BookProfileArtifactStamp[] {
  const typeSet = types ? new Set(types) : null;
  return stampsFromSemanticMap(map)
    .filter((artifact) => !typeSet || typeSet.has(artifact.artifactType))
    .filter((artifact) => overlapsRange(artifact, startPosition, endPosition))
    .sort((a, b) => (a.startPosition ?? 0) - (b.startPosition ?? 0));
}
