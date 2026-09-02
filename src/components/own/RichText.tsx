import { parseRichText, type RichSegment } from "@/lib/richText";

/**
 * Renders an OWN case description the way its author laid it out — paragraphs
 * with air between them, real bullets, aligned columns, working links.
 *
 * The input is public relay text written by someone else, so it is rendered as
 * React elements built from a parsed structure. No HTML is ever constructed
 * from it, which is what makes that safe.
 */

function Segments({ parts }: { parts: RichSegment[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'link' ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:text-primary break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

export default function RichText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseRichText(text);
  if (!blocks.length) return null;

  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        if (block.kind === 'list') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1.5 marker:text-muted-foreground">
              {block.items.map((item, j) => (
                <li key={j} className="break-words"><Segments parts={item} /></li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'table') {
          return (
            // Columns can scroll sideways; the page itself must never have to.
            <div key={i} className="overflow-x-auto -mx-1 px-1">
              <table className="w-full border-collapse">
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j} className="border-b border-border/40 last:border-0">
                      {row.map((cell, k) => (
                        <td key={k} className="py-1 pr-4 align-top whitespace-nowrap">
                          <Segments parts={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i} className="break-words">
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Segments parts={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
