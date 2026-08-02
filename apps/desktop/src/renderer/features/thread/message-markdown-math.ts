const FENCE_START = /^\s*(`{3,}|~{3,})/;
const STANDALONE_DISPLAY_MATH = /^(\s*)\$\$([^\n]+?)\$\$(\s*)$/;
const CURRENCY_AMOUNT = /\\?\$(?=\d+(?:[.,]\d+)?(?:\s|[.,;:!?)]|$))/g;
const MATH_OPERATOR = /[\\=+\-*/^_<>]/;

function protectCurrencyAmounts(line: string): string {
  return line.replace(CURRENCY_AMOUNT, (value, offset: number) => {
    if (value.startsWith("\\")) return value;
    const closingDollar = line.indexOf("$", offset + value.length);
    if (closingDollar >= 0 && MATH_OPERATOR.test(line.slice(offset + 1, closingDollar))) return value;
    return `\\${value}`;
  });
}

/** Normalizes common LLM math output without touching fenced code. */
export function normalizeMessageMath(markdown: string): string {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  return markdown.split("\n").map((line) => {
    const match = line.match(FENCE_START);
    if (match) {
      const marker = match[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: match[1].length };
      else if (fence.marker === marker && match[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;

    const display = line.match(STANDALONE_DISPLAY_MATH);
    if (display) return `${display[1]}$$\n${display[2].trim()}\n${display[3]}$$`;
    return protectCurrencyAmounts(line);
  }).join("\n");
}
