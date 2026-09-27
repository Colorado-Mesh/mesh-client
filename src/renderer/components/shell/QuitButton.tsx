import { LogOut } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { quitMeshClient } from '@/renderer/lib/quitMeshClient';
import { selectAnyLinkUp, useConnectionStore } from '@/renderer/stores/connectionStore';

/**
 * Header Disconnect & Quit, so leaving the app does not mean a trip to Device > Connection. One
 * click, like the Connection panel's quit row; red and last in the header at the maintainer's
 * request.
 */
export function QuitButton() {
  const { t } = useTranslation();
  const linkUp = useConnectionStore(selectAnyLinkUp);
  const label = t(linkUp ? 'connectionPanel.disconnectAndQuit' : 'connectionPanel.quit');

  return (
    <button
      type="button"
      onClick={() => {
        void quitMeshClient(linkUp);
      }}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-950/40 hover:text-red-300"
    >
      <LogOut aria-hidden className={ICON_MD} size={16} />
    </button>
  );
}
