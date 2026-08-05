export function skillIconText(name: string): string {
  const firstCharacter = name.trim()[0];
  if (!firstCharacter) return "?";
  return /[一-龥]/.test(firstCharacter) ? firstCharacter : firstCharacter.toUpperCase();
}
