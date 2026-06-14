/** Pick Hunspell language codes for Electron session.setSpellCheckerLanguages (Win/Linux). */
export function pickSpellCheckerLanguages(available: string[], locale: string): string[] {
  const picked: string[] = [];
  if (available.includes(locale)) {
    picked.push(locale);
  }
  const region = locale.split(/[-_]/)[0];
  if (region) {
    for (const code of available) {
      if ((code === region || code.startsWith(`${region}-`)) && !picked.includes(code)) {
        picked.push(code);
      }
    }
  }
  if (picked.length === 0 && available.includes('en-US')) {
    picked.push('en-US');
  }
  if (picked.length === 0 && available.length > 0) {
    picked.push(available[0]);
  }
  return picked.slice(0, 3);
}
