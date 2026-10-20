// Discord rejects webhook content longer than 2000 characters (HTTP 400).
// Keep headroom for the "(ต่อ n/N)" prefix added to continuation messages.
export const DISCORD_CONTENT_LIMIT = 1900;

const hardSplit = (line, limit) => {
  const parts = [];
  const chars = Array.from(line);
  for (let i = 0; i < chars.length; i += limit) {
    parts.push(chars.slice(i, i + limit).join(''));
  }
  return parts;
};

// Split on line boundaries so an item line is never cut in half; a single line
// longer than the limit is hard-split as a last resort.
export const splitDiscordContent = (text, limit = DISCORD_CONTENT_LIMIT) => {
  const value = String(text || '');
  if (Array.from(value).length <= limit) return value ? [value] : [];

  const chunks = [];
  let current = '';
  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const line of value.split('\n')) {
    const pieces = Array.from(line).length > limit ? hardSplit(line, limit) : [line];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n${piece}` : piece;
      if (Array.from(candidate).length > limit) {
        flush();
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  flush();

  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, index) =>
    index === 0 ? chunk : `(ต่อ ${index + 1}/${chunks.length})\n${chunk}`
  );
};
