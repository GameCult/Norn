import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

export type GraphKey = "architecture" | "dataflow";

export interface EpiphanyCodeRef {
  path: string;
  start_line?: number | null;
  end_line?: number | null;
  symbol?: string | null;
  note?: string | null;
}

export interface NornGraphNode {
  id: string;
  title: string;
  purpose: string;
  mechanism?: string | null;
  metaphor?: string | null;
  status?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface NornGraphEdge {
  source_id: string;
  target_id: string;
  kind: string;
  id?: string | null;
  label?: string | null;
  mechanism?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface NornGraph {
  nodes: NornGraphNode[];
  edges: NornGraphEdge[];
}

export interface NornGraphLink {
  dataflow_node_id: string;
  architecture_node_id: string;
  relationship?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface NornGraphsState {
  architecture: NornGraph;
  dataflow: NornGraph;
  links: NornGraphLink[];
}

export type NornGraphLabels = Partial<Record<GraphKey, string>>;
export type NornGraphDescriptions = Partial<Record<GraphKey, string>>;
export type NornGraphLayoutMode = "layered" | "stress" | "force" | "combined-force";
export type NornGraphLayoutModeConfig =
  | NornGraphLayoutMode
  | Partial<Record<GraphKey, NornGraphLayoutMode>>;
export type NornGraphPerformancePreset = "quality" | "balanced" | "fast";

export interface NornGraphPerformanceOptions {
  preset?: NornGraphPerformancePreset;
  simulationBudgetMs?: number;
  targetFps?: number;
  maxAnimatedNodes?: number;
  edgeRefreshRate?: number;
  maxTimeStepMs?: number;
}

export interface NornGraphMotionOptions {
  enabled?: boolean;
  strength?: number;
  damping?: number;
  flow?: number;
  orbit?: number;
  lift?: number;
  pulse?: number;
  emitNodeEnvelopes?: boolean;
}

export interface EpiphanyValidationIssue {
  scope: string;
  message: string;
}

export type ViewerSelection =
  | {
      kind: "node";
      graphKey: GraphKey;
      nodeId: string;
    }
  | {
      kind: "edge";
      graphKey: GraphKey;
      edgeId: string;
    };

export type NodeEnvelope = {
  id: string;
  x: number;
  y: number;
  radius: number;
  strength: number;
};

export type ViewportTransformEnvelope = {
  graphKey: GraphKey;
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export interface NornViewerProps {
  state: NornGraphsState;
  initialGraph?: GraphKey;
  selection?: ViewerSelection | null;
  style?: CSSProperties;
  className?: string;
  title?: string;
  graphLabels?: NornGraphLabels;
  graphDescriptions?: NornGraphDescriptions;
  layoutMode?: NornGraphLayoutModeConfig;
  motion?: NornGraphMotionOptions | boolean;
  performance?: NornGraphPerformancePreset | NornGraphPerformanceOptions;
  sidebar?: ReactNode;
  sidebarWidth?: CSSProperties["width"];
  showSidebar?: boolean;
  overlayPanels?: boolean;
  viewportBackdrop?: ReactNode;
  viewportBackground?: CSSProperties["background"];
  focusSelection?: boolean;
  selectionFocusMode?: "preview" | "article";
  viewportTarget?: ViewerSelection | null;
  expandedNode?: {
    graphKey: GraphKey;
    nodeId: string;
    content: ReactNode;
    className?: string;
    ariaLabel?: string;
  };
  nodeArticle?: {
    className?: string;
    ariaLabel?: (node: PositionedNode) => string;
    content: (node: PositionedNode) => ReactNode | null;
  };
  onExpandedNodeClick?: MouseEventHandler<HTMLElement>;
  onViewportTargetComplete?: (selection: ViewerSelection) => void;
  onSelectionChange?: (selection: ViewerSelection | null) => void;
  onCodeRefSelect?: (
    codeRef: EpiphanyCodeRef,
    context: {
      graphKey: GraphKey;
      selection: ViewerSelection | null;
    },
  ) => void;
}

export interface PositionedPoint {
  x: number;
  y: number;
}

export interface PositionedNode extends NornGraphNode {
  graphKey: GraphKey;
  x: number;
  y: number;
  width: number;
  height: number;
  degree: number;
  linkCount: number;
  badgeText: string;
  fill: string;
  stroke: string;
}

export interface PositionedEdge extends NornGraphEdge {
  resolvedId: string;
  graphKey: GraphKey;
  points: PositionedPoint[];
  path: string;
  midpoint: PositionedPoint;
}

export interface GraphLayout {
  graphKey: GraphKey;
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: PositionedEdge[];
}
