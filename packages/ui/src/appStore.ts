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
  splitDirection: Exclude<WorkbenchLayoutPreference, "auto">;
  splitPreferences: Record<string, SplitPanePreference>;
  setActiveWorkbench: (id: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleNavigation: () => void;
  toggleExplorer: () => void;
  toggleExplorerNode: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setSplitDirection: (direction: Exclude<WorkbenchLayoutPreference, "auto">) => void;
  setSplitPreference: (id: string, value: SplitPanePreference) => void;
}

export const useAppStore = create<AppStore>()(persist(
  (set) => ({
    activeWorkbench: "", themeMode: "dark", collapsedNavigation: false, collapsedExplorer: false, collapsedExplorerNodes: [],
    favoriteWorkbenches: [], recentWorkbenches: ["http"], splitDirection: "vertical", splitPreferences: {},
    setActiveWorkbench: (activeWorkbench) => set((state) => ({
      activeWorkbench,
      recentWorkbenches: !activeWorkbench || activeWorkbench.startsWith("__")
        ? state.recentWorkbenches
        : [activeWorkbench, ...state.recentWorkbenches.filter((id) => id !== activeWorkbench)].slice(0, 6),
    })),
    setThemeMode: (themeMode) => set({ themeMode }),
    toggleNavigation: () => set((state) => ({ collapsedNavigation: !state.collapsedNavigation })),
    toggleExplorer: () => set((state) => ({ collapsedExplorer: !state.collapsedExplorer })),
    toggleExplorerNode: (id) => set((state) => ({ collapsedExplorerNodes: state.collapsedExplorerNodes.includes(id) ? state.collapsedExplorerNodes.filter((item) => item !== id) : [...state.collapsedExplorerNodes, id] })),
    toggleFavorite: (id) => set((state) => ({ favoriteWorkbenches: state.favoriteWorkbenches.includes(id) ? state.favoriteWorkbenches.filter((item) => item !== id) : [...state.favoriteWorkbenches, id] })),
    setSplitDirection: (splitDirection) => set({ splitDirection }),
    setSplitPreference: (id, value) => set((state) => ({ splitPreferences: { ...state.splitPreferences, [id]: value } })),
  }),
  { name: "apivoy:ui-state", version: 4, migrate: (persisted) => {
    const state = persisted as Partial<AppStore>;
    const legacyDirection = state.splitPreferences?.["http-workbench"]?.direction
      ?? Object.values(state.splitPreferences ?? {}).find((preference) => preference?.direction)?.direction;
    return {
      ...state,
      collapsedExplorerNodes: Array.isArray(state.collapsedExplorerNodes) ? state.collapsedExplorerNodes : [],
      splitDirection: state.splitDirection ?? (legacyDirection === "horizontal" ? "horizontal" : "vertical"),
    } as AppStore;
  } },
));
