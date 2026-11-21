import type { SnippetSegment } from "@/server/modules/brain/service";

/** A search excerpt; matched words are highlighted. Rendered as text, never as HTML. */
export function Snippet({ segments }: { segments: SnippetSegment[] }) {
  return (
    <p className="text-sm">
      {segments.map((s, i) => (s.match ? <mark key={i} className="rounded-sm bg-warning/25 px-0.5 text-foreground">{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </p>
  );
}
