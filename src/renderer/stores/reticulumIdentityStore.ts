import { create } from 'zustand';

export interface ReticulumIdentityStatus {
  configured: boolean;
  identity_hash: string;
  lxmf_hash: string;
  display_name?: string | null;
}

interface ReticulumIdentityState {
  identity: ReticulumIdentityStatus | null;
  setIdentity: (identity: ReticulumIdentityStatus | null) => void;
}

const DEFAULT_IDENTITY: ReticulumIdentityStatus | null = null;

export const useReticulumIdentityStore = create<ReticulumIdentityState>((set) => ({
  identity: DEFAULT_IDENTITY,
  setIdentity: (identity) => {
    set({ identity });
  },
}));

export function resetReticulumIdentityStoreForTests(): void {
  useReticulumIdentityStore.setState({ identity: DEFAULT_IDENTITY });
}
