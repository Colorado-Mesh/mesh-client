import type { NavSection, NavSectionId } from './navSections';

/**
 * Phones and very narrow windows (a future iOS / Android build): the rail becomes a bottom bar.
 * Same breakpoint as the one-pane conversation layout (`CONVERSATION_COMPACT_QUERY`).
 */
export const SHELL_COMPACT_QUERY = '(max-width: 767px)';

/**
 * Sections with their own bottom bar button, in order. Incident is always one of them when the
 * protocol has it (EMCOMM S9: never hidden behind More). Everything else opens from More.
 */
export const BOTTOM_NAV_SECTION_IDS: readonly NavSectionId[] = [
  'chat',
  'network',
  'map',
  'incident',
];

export interface BottomNavSplit {
  /** Sections shown as bottom bar buttons, in `BOTTOM_NAV_SECTION_IDS` order. */
  primary: NavSection[];
  /** Sections reached through More (the launcher). */
  overflow: NavSection[];
}

export function splitBottomNavSections(sections: readonly NavSection[]): BottomNavSplit {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const primary = BOTTOM_NAV_SECTION_IDS.flatMap((id) => {
    const section = byId.get(id);
    return section ? [section] : [];
  });
  const overflow = sections.filter((section) => !BOTTOM_NAV_SECTION_IDS.includes(section.id));
  return { primary, overflow };
}
