import { create } from 'zustand';

export interface ReticulumUiState {
  pendingInterfaceEditId: string | null;
  requestInterfaceEdit: (id: string) => void;
  clearPendingInterfaceEdit: () => void;
}

export const useReticulumUiStore = create<ReticulumUiState>((set) => ({
  pendingInterfaceEditId: null,
  requestInterfaceEdit: (id) => {
    set({ pendingInterfaceEditId: id });
  },
  clearPendingInterfaceEdit: () => {
    set({ pendingInterfaceEditId: null });
  },
}));
