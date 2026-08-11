import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppStore {
  activeWorkbench: string;
  setActiveWorkbench: (id: string) => void;
}

export const useAppStore = create<AppStore>()(persist(
  (set) => ({ activeWorkbench: "http", setActiveWorkbench: (activeWorkbench) => set({ activeWorkbench }) }),
  { name: "apivoy:ui-state" },
));
