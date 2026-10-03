/**
 * Translated copy is stored as plain text, so it can live in the dictionary beside every other
 * string. The few places that highlight a word inside a sentence write it as `**like this**`, and
 * this renders the emphasis without the dictionary holding markup.
 *
 * It is deliberately a plain function with no hooks: it runs on the server first, in the same render
 * that produced the string.
 */
export function RichText({
  text,
  highlightClassName,
}: {
  text: string;
  /** Applied to the `**…**` words; the rest of the sentence inherits the parent's styling. */
  highlightClassName?: string;
}) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className={highlightClassName}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}