import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light" | "system";
export type WorkbenchLayoutPreference = "auto" | "horizontal" | "vertical";
export interface SplitPanePreference { direction: WorkbenchLayoutPreference; ratio: number }

interface AppStore {
  activeWorkbench: string;
  themeMode: ThemeMode;
  collapsedNavigation: boolean;
  collapsedExplorer: boolean;
  collapsedExplorerNodes: string[];
  favoriteWorkbenches: string[];
  recentWorkbenches: string[];
  splitPreferences: Record<string, SplitPanePreference>;
  setActiveWorkbench: (id: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleNavigation: () => void;
  toggleExplorer: () => void;
  toggleExplorerNode: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setSplitPreference: (id: string, value: SplitPanePreference) => void;
}

export const useAppStore = create<AppStore>()(persist(
  (set) => ({
    activeWorkbench: "http", themeMode: "dark", collapsedNavigation: false, collapsedExplorer: false, collapsedExplorerNodes: [],
    favoriteWorkbenches: [], recentWorkbenches: ["http"], splitPreferences: {},
    setActiveWorkbench: (activeWorkbench) => set((state) => ({ activeWorkbench, recentWorkbenches: [activeWorkbench, ...state.recentWorkbenches.filter((id) => id !== activeWorkbench)].slice(0, 6) })),
    setThemeMode: (themeMode) => set({ themeMode }),
    toggleNavigation: () => set((state) => ({ collapsedNavigation: !state.collapsedNavigation })),
    toggleExplorer: () => set((state) => ({ collapsedExplorer: !state.collapsedExplorer })),
    toggleExplorerNode: (id) => set((state) => ({ collapsedExplorerNodes: state.collapsedExplorerNodes.includes(id) ? state.collapsedExplorerNodes.filter((item) => item !== id) : [...state.collapsedExplorerNodes, id] })),
    toggleFavorite: (id) => set((state) => ({ favoriteWorkbenches: state.favoriteWorkbenches.includes(id) ? state.favoriteWorkbenches.filter((item) => item !== id) : [...state.favoriteWorkbenches, id] })),
    setSplitPreference: (id, value) => set((state) => ({ splitPreferences: { ...state.splitPreferences, [id]: value } })),
  }),
  { name: "apivoy:ui-state", version: 3, migrate: (persisted) => { const state = persisted as Partial<AppStore>; return { ...state, collapsedExplorerNodes: Array.isArray(state.collapsedExplorerNodes) ? state.collapsedExplorerNodes : [] } as AppStore; } },
));
