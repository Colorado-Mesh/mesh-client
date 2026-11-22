/**
 * After the first-run picker or tour bar closes, its focused control is gone and focus would
 * fall to the page body. Put it on the selected section tab instead, so keyboard users keep
 * their place. Runs after the next paint (the closing element must be gone first) and never
 * moves focus that already landed on a real control.
 */
export function focusSelectedSectionTabSoon(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document
      .querySelector<HTMLElement>('[role="tablist"] [role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });
  });
}
