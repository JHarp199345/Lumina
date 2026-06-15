/**
 * Runnable test for the pure recall engine (no DOM/storage deps).
 * Run: `npm run test:recall`  (bundles with esbuild, executes on node).
 *
 * Covers: tokenization, cosine, tag-gate exclusion, ranking, intent bias,
 * row grouping, and the RecallScheduler (preempt/sticky/coalesce + the
 * cross-project isolation guard).
 */
import {
  recallRank, runRecall, RecallScheduler, tokenize, cosine,
} from "./projectRecall";
import type { ProjectArtifact, ProjectArtifactType } from "@/types";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  ok:", name); }
  else { fail++; console.log("  FAIL:", name); }
}

const art = (
  id: string, type: ProjectArtifactType, title: string, descriptor: string,
  summary: string, tags: string[], weight = 0.6
): ProjectArtifact => ({
  id, projectId: "p1", sourceBookId: "b1", type, title, descriptor, summary,
  visibleTags: tags, hiddenTags: tags, weight,
});

const artifacts: ProjectArtifact[] = [
  art("a1", "theme", "Discipline and restraint", "theme · Discipline · discipline, restraint, leadership", "Leaders who hold power show restraint.", ["discipline", "restraint", "leadership"], 0.8),
  art("a2", "passage", "The locket in the drawer", "passage · The locket · locket, secrecy, drawer", "A hand draws a locket from a drawer.", ["locket", "secrecy", "drawer"], 0.7),
  art("a3", "character", "Washington", "character · Washington · washington, general, restraint", "A general who relinquished power.", ["washington", "general", "restraint"], 0.9),
  art("a4", "concept", "Photosynthesis", "concept · Photosynthesis · photosynthesis, biology, plants", "Plants convert light to energy.", ["photosynthesis", "biology", "plants"], 0.4),
];

console.log("tokenize/cosine:");
check("tokenize drops stopwords", !tokenize("the leadership of restraint").includes("the"));
check("cosine identical = 1", Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
check("cosine orthogonal = 0", Math.abs(cosine([1, 0], [0, 1])) < 1e-9);

console.log("recallRank (tag gate + scoring):");
const r1 = recallRank(artifacts, { projectId: "p1", text: "Washington showed restraint and discipline as a leader" });
check("relevant artifacts surface", r1.length >= 2);
check("photosynthesis GATED OUT (off-topic)", !r1.some((x) => x.artifact.id === "a4"));
check("restraint/leadership ranks at top", ["a1", "a3"].includes(r1[0].artifact.id));

const r2 = recallRank(artifacts, { projectId: "p1", text: "a secret locket hidden in a drawer" });
check("locket passage surfaces for its query", r2.some((x) => x.artifact.id === "a2"));
check("unrelated theme gated out for locket query", !r2.some((x) => x.artifact.id === "a4"));

console.log("intent bias:");
const r3 = recallRank(artifacts, { projectId: "p1", text: "leadership", intent: { thesis: "restraint defines true leadership" } });
check("intent-aligned artifact ranks first", ["a1", "a3"].includes(r3[0].artifact.id));

console.log("rows grouping:");
const rows = runRecall(artifacts, { projectId: "p1", text: "Washington restraint discipline" });
check("rows grouped by type", rows.length >= 1 && rows.every((row) => row.items.length > 0));

console.log("scheduler (async):");
(async () => {
  const results: { priority: string; projectId: string }[] = [];
  const sched = new RecallScheduler({
    projectId: "p1",
    getArtifacts: () => artifacts,
    onResult: (r) => results.push(r),
    ambientDebounceMs: 30,
    explicitStickyMs: 200,
  });

  sched.requestAmbient(() => ({ projectId: "p1", text: "locket drawer" }));
  sched.requestExplicit({ projectId: "p1", text: "Washington restraint" });
  await new Promise((r) => setTimeout(r, 80));
  check("explicit delivered", results.some((r) => r.priority === "explicit"));

  const before = results.length;
  sched.requestAmbient(() => ({ projectId: "p1", text: "photosynthesis" }));
  await new Promise((r) => setTimeout(r, 80));
  check("ambient suppressed during explicit sticky window", results.length === before);

  await new Promise((r) => setTimeout(r, 160));
  sched.requestAmbient(() => ({ projectId: "p1", text: "locket drawer" }));
  await new Promise((r) => setTimeout(r, 80));
  check("ambient resumes after sticky window", results[results.length - 1]?.priority === "ambient");

  const n0 = results.length;
  sched.requestAmbient(() => ({ projectId: "p1", text: "leadership" }));
  sched.requestAmbient(() => ({ projectId: "p1", text: "Washington" }));
  sched.requestAmbient(() => ({ projectId: "p1", text: "restraint discipline" }));
  await new Promise((r) => setTimeout(r, 120));
  check("rapid ambient coalesced into one result", results.length - n0 === 1);

  // Cross-project isolation: a query for another project must NEVER be delivered.
  const n1 = results.length;
  sched.requestExplicit({ projectId: "OTHER", text: "Washington restraint" });
  await new Promise((r) => setTimeout(r, 80));
  check("cross-project query dropped (isolation guard)", results.length === n1);
  check("all delivered results belong to p1", results.every((r) => r.projectId === "p1"));

  sched.dispose();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
