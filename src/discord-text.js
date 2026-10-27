// Splits a reply into Discord-sized messages, preferring paragraph and line breaks, keeping code blocks closed.
export function splitMessage(text, max = 1900) {
  const parts = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    let part = rest.slice(0, cut);
    rest = rest.slice(cut).trimStart();
    const fence = part.match(/```(\w*)/g);
    if (fence && fence.length % 2 === 1) {
      part += '\n```';
      rest = `${fence.at(-1)}\n${rest}`;
    }
    parts.push(part);
  }
  if (rest) parts.push(rest);
  return parts;
}
