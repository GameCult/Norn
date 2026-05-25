import type { NornGraphPerformancePreset } from "./types";

export type SimulationProfilePreset = {
  simulationBudgetMs: number;
  targetFps: number;
  maxAnimatedNodes: number;
  edgeRefreshRate: number;
  maxTimeStepMs: number;
  reduceThreshold: number;
  expandThreshold: number;
  nodeBudgetCutRatio: number;
  nodeBudgetGrowthRatio: number;
  nodeBudgetGrowthAdd: number;
};

export const simulationProfilePresets: Record<NornGraphPerformancePreset, SimulationProfilePreset> = {
  quality: {
    simulationBudgetMs: 8,
    targetFps: 60,
    maxAnimatedNodes: 5000,
    edgeRefreshRate: 1,
    maxTimeStepMs: 34,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
  balanced: {
    simulationBudgetMs: 4,
    targetFps: 40,
    maxAnimatedNodes: 240,
    edgeRefreshRate: 2,
    maxTimeStepMs: 28,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
  fast: {
    simulationBudgetMs: 2.5,
    targetFps: 24,
    maxAnimatedNodes: 90,
    edgeRefreshRate: 3,
    maxTimeStepMs: 24,
    reduceThreshold: 1.08,
    expandThreshold: 0.55,
    nodeBudgetCutRatio: 0.92,
    nodeBudgetGrowthRatio: 1.16,
    nodeBudgetGrowthAdd: 2,
  },
};
