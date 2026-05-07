const LEADING_ASIDE_PATTERN =
  /^\s*(?:[（(【\[][^）)\]】]{1,80}[）)\]】]\s*)+/;

export function stripLeadingAsides(text: string): string {
  let result = text.trimStart();

  for (let i = 0; i < 4; i++) {
    const next = result.replace(LEADING_ASIDE_PATTERN, "").trimStart();
    if (next === result) break;
    result = next;
  }

  return result.trim() || text.trim();
}
