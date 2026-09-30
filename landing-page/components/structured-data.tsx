type StructuredDataProps = {
  value: Record<string, unknown>;
};

export function StructuredData({ value }: StructuredDataProps) {
  const serializedValue = JSON.stringify(value).replaceAll('<', '\\u003c');

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializedValue }} />;
}
