import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

export type GraphKey = "architecture" | "dataflow";

export interface EpiphanyCodeRef {
  path: string;
  start_line?: number | null;
  end_line?: number | null;
  symbol?: string | null;
  note?: string | null;
}

export interface EpiphanyGraphNode {
  id: string;
  title: string;
  purpose: string;
  mechanism?: string | null;
  metaphor?: string | null;
  status?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface EpiphanyGraphEdge {
  source_id: string;
  target_id: string;
  kind: string;
  id?: string | null;
  label?: string | null;
  mechanism?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface EpiphanyGraph {
  nodes: EpiphanyGraphNode[];
  edges: EpiphanyGraphEdge[];
}

export interface EpiphanyGraphLink {
  dataflow_node_id: string;
  architecture_node_id: string;
  relationship?: string | null;
  code_refs?: EpiphanyCodeRef[];
}

export interface EpiphanyGraphsState {
  architecture: EpiphanyGraph;
  dataflow: EpiphanyGraph;
  links: EpiphanyGraphLink[];
}

export type EpiphanyGraphLabels = Partial<Record<GraphKey, string>>;
export type EpiphanyGraphDescriptions = Partial<Record<GraphKey, string>>;
export type EpiphanyGraphLayoutMode = "layered" | "stress" | "force" | "combined-force";
export type EpiphanyGraphLayoutModeConfig =
  | EpiphanyGraphLayoutMode
  | Partial<Record<GraphKey, EpiphanyGraphLayoutMode>>;

export interface EpiphanyGraphMotionOptions {
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

export interface EpiphanyGraphViewerProps {
  state: EpiphanyGraphsState;
  initialGraph?: GraphKey;
  selection?: ViewerSelection | null;
  style?: CSSProperties;
  className?: string;
  title?: string;
  graphLabels?: EpiphanyGraphLabels;
  graphDescriptions?: EpiphanyGraphDescriptions;
  layoutMode?: EpiphanyGraphLayoutModeConfig;
  motion?: EpiphanyGraphMotionOptions | boolean;
  sidebar?: ReactNode;
  sidebarWidth?: CSSProperties["width"];
  showSidebar?: boolean;
  overlayPanels?: boolean;
  viewportBackdrop?: ReactNode;
  viewportBackground?: CSSProperties["background"];
  focusSelection?: boolean;
  selectionFocusMode?: "preview" | "article";
  expandedNode?: {
    graphKey: GraphKey;
    nodeId: string;
    content: ReactNode;
    className?: string;
    ariaLabel?: string;
  };
  onExpandedNodeClick?: MouseEventHandler<HTMLElement>;
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

export interface PositionedNode extends EpiphanyGraphNode {
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

export interface PositionedEdge extends EpiphanyGraphEdge {
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
