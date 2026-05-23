import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { layoutEpiphanyGraphs } from "./layout";
import { simulationProfilePresets } from "./simulation-profile";
import type {
  EpiphanyCodeRef,
  EpiphanyGraphLink,
  EpiphanyGraphLayoutModeConfig,
  EpiphanyGraphMotionOptions,
  EpiphanyGraphPerformanceOptions,
  EpiphanyGraphPerformancePreset,
  EpiphanyGraphViewerProps,
  EpiphanyValidationIssue,
  GraphKey,
  GraphLayout,
  NodeEnvelope,
  PositionedEdge,
  PositionedNode,
  PositionedPoint,
  ViewerSelection,
  ViewportTransformEnvelope,
} from "./types";
import { validateEpiphanyGraphsState } from "./validation";

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
  userMoved: boolean;
};

type NodeFocusMode = "preview" | "article";

type DynamicNodeState = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type ViewportDragState = {
  active: boolean;
  pointerId: number;
  moved: boolean;
  suppressClick: boolean;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

type AdaptiveSimulationBudget = {
  nodeBudget: number;
  edgeRefreshRate: number;
  averageCostMs: number;
};

const PANEL_SURFACE = "rgba(7, 16, 30, 0.76)";
const PANEL_BORDER = "1px solid rgba(148, 163, 184, 0.18)";

export function EpiphanyGraphViewer({
  state,
  initialGraph = "architecture",
  selection: controlledSelection,
  style,
  className,
  title = "Epiphany Graph Viewer",
  graphLabels,
  graphDescriptions,
  layoutMode = "layered",
  motion,
  performance,
  sidebar,
  sidebarWidth = 330,
  showSidebar = true,
  overlayPanels = false,
  viewportBackdrop,
  viewportBackground,
  focusSelection = false,
  selectionFocusMode = "preview",
  expandedNode,
  nodeArticle,
  onExpandedNodeClick,
  onSelectionChange,
  onCodeRefSelect,
}: EpiphanyGraphViewerProps) {
  const [activeGraphKey, setActiveGraphKey] = useState<GraphKey>(initialGraph);
  const [localSelection, setLocalSelection] = useState<ViewerSelection | null>(null);
  const [layouts, setLayouts] = useState<Record<GraphKey, GraphLayout> | null>(null);
  const [dynamicLayouts, setDynamicLayouts] = useState<Record<GraphKey, GraphLayout> | null>(null);
  const [issues, setIssues] = useState<EpiphanyValidationIssue[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [transforms, setTransforms] = useState<Record<GraphKey, ViewTransform>>({
    architecture: { x: 0, y: 0, scale: 1, userMoved: false },
    dataflow: { x: 0, y: 0, scale: 1, userMoved: false },
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dynamicStateRef = useRef<Record<GraphKey, DynamicNodeState[]> | null>(null);
  const dynamicLayoutRef = useRef<Record<GraphKey, GraphLayout> | null>(null);
  const wheelStateRef = useRef({
    activeGraphKey,
    transforms,
  });
  const dragRef = useRef<ViewportDragState | null>(null);
  const explicitFocusRef = useRef<string | null>(null);
  const selection = controlledSelection === undefined ? localSelection : controlledSelection;
  const layoutModeKey = layoutModeCacheKey(layoutMode);
  const motionOptions = resolveMotionOptions(layoutMode, motion);
  const motionKey = motionOptions ? motionOptionsCacheKey(motionOptions) : "off";
  const performanceOptions = resolvePerformanceOptions(performance);
  const performanceKey = performanceOptionsCacheKey(performanceOptions);
  const updateSelection = (nextSelection: ViewerSelection | null) => {
    if (controlledSelection === undefined) {
      setLocalSelection(nextSelection);
    }
    onSelectionChange?.(nextSelection);
  };

  useEffect(() => {
    if (!controlledSelection?.graphKey) {
      return;
    }
    setActiveGraphKey(controlledSelection.graphKey);
  }, [controlledSelection?.graphKey]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    setIssues(validateEpiphanyGraphsState(state));

    layoutEpiphanyGraphs(
      state,
      layoutMode,
      viewportSize.width > 0 && viewportSize.height > 0 ? viewportSize : undefined,
    )
      .then((nextLayouts) => {
        if (cancelled) {
          return;
        }
        setLayouts(nextLayouts);
        setDynamicLayouts(nextLayouts);
        dynamicLayoutRef.current = nextLayouts;
        dynamicStateRef.current = {
          architecture: dynamicNodesFromLayout(nextLayouts.architecture),
          dataflow: dynamicNodesFromLayout(nextLayouts.dataflow),
        };
        setStatus("ready");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [layoutModeKey, state, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!motionOptions || !layouts || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    let frameId = 0;
    let lastTime = globalThis.performance.now();
    let lastStepTime = lastTime;
    let stepIndex = 0;
    const adaptiveBudget = createAdaptiveSimulationBudget(
      layouts[activeGraphKey].nodes.length,
      performanceOptions,
    );
    const tick = (time: number) => {
      const minFrameMs = 1000 / performanceOptions.targetFps;
      if (time - lastStepTime < minFrameMs) {
        frameId = requestAnimationFrame(tick);
        return;
      }
      stepIndex += 1;
      lastStepTime = time;
      const dt = Math.min(
        performanceOptions.maxTimeStepMs / 1000,
        Math.max(0.001, (time - lastTime) / 1000),
      );
      lastTime = time;
      const stepStart = globalThis.performance.now();
      const next = stepDynamicLayouts({
        baseLayouts: layouts,
        states: dynamicStateRef,
        activeGraphKey,
        transforms,
        motionOptions,
        viewportElement: viewportRef.current,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        dt,
        time: time / 1000,
        maxAnimatedNodes: adaptiveBudget.nodeBudget,
        refreshEdges: stepIndex % adaptiveBudget.edgeRefreshRate === 0,
        previousLayout: dynamicLayoutRef.current?.[activeGraphKey] ?? null,
      });
      adjustAdaptiveSimulationBudget(
        adaptiveBudget,
        globalThis.performance.now() - stepStart,
        layouts[activeGraphKey].nodes.length,
        performanceOptions,
      );
      if (next) {
        dynamicLayoutRef.current = next.layouts;
        setDynamicLayouts(next.layouts);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    activeGraphKey,
    layouts,
    motionKey,
    performanceKey,
    transforms,
    viewportSize.height,
    viewportSize.width,
  ]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setViewportSize({
        width: box.width,
        height: box.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    wheelStateRef.current = {
      activeGraphKey,
      transforms,
    };
  }, [activeGraphKey, transforms]);

  const visibleLayouts = dynamicLayouts ?? layouts;

  useEffect(() => {
    const element = viewportRef.current;
    const layout = visibleLayouts?.[activeGraphKey] ?? null;
    if (!element || !layout || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    const transform = transforms[activeGraphKey];
    const bounds = nodeAabb(layout.nodes);
    element.dispatchEvent(new CustomEvent<ViewportTransformEnvelope>("epiphanygraph-viewport-transform", {
      bubbles: true,
      detail: {
        graphKey: activeGraphKey,
        x: transform.x,
        y: transform.y,
        scale: transform.scale,
        width: viewportSize.width,
        height: viewportSize.height,
        bounds,
      },
    }));
  }, [
    activeGraphKey,
    transforms,
    visibleLayouts,
    viewportSize.height,
    viewportSize.width,
  ]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const {
        activeGraphKey: currentGraphKey,
        transforms: currentTransforms,
      } = wheelStateRef.current;
      handleNativeWheel(
        event,
        element,
        currentGraphKey,
        currentTransforms,
        setTransforms,
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!layouts || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    setTransforms((current) => ({
      architecture: current.architecture.userMoved
        ? current.architecture
        : fitGraphToViewport(layouts.architecture, viewportSize.width, viewportSize.height),
      dataflow: current.dataflow.userMoved
        ? current.dataflow
        : fitGraphToViewport(layouts.dataflow, viewportSize.width, viewportSize.height),
    }));
  }, [layouts, viewportSize.height, viewportSize.width]);

  const activeLayout = visibleLayouts?.[activeGraphKey] ?? null;
  const activeTransform = transforms[activeGraphKey];
  const compactGraph = activeLayout ? isCompactGraphLayout(activeLayout) : false;
  const selectedNode =
    selection?.kind === "node" && selection.graphKey === activeGraphKey && activeLayout
      ? activeLayout.nodes.find((node) => node.id === selection.nodeId) ?? null
      : null;
  const selectedEdge =
    selection?.kind === "edge" && selection.graphKey === activeGraphKey && activeLayout
      ? activeLayout.edges.find((edge) => edge.resolvedId === selection.edgeId) ?? null
      : null;
  const labels = {
    architecture: graphLabels?.architecture ?? "Architecture",
    dataflow: graphLabels?.dataflow ?? "Dataflow",
  };
  const descriptions = {
    architecture:
      graphDescriptions?.architecture ??
      "Architecture nodes describe durable system parts: stores, renderers, promoters, bridges, and shells.",
    dataflow:
      graphDescriptions?.dataflow ??
      "Dataflow nodes describe the movement of evidence and structure through the pipeline: observations, proposals, validation, fragments, turns.",
  };

  const neighboringIds = new Set<string>();
  if (selectedNode && activeLayout) {
    for (const edge of activeLayout.edges) {
      if (edge.source_id === selectedNode.id) {
        neighboringIds.add(edge.target_id);
      }
      if (edge.target_id === selectedNode.id) {
        neighboringIds.add(edge.source_id);
      }
    }
  }

  const linkedNodes = selectedNode
    ? findLinkedNodes(selectedNode.id, activeGraphKey, state)
    : [];
  const expandedNodeMatches =
    Boolean(expandedNode) &&
    Boolean(selectedNode) &&
    expandedNode?.graphKey === activeGraphKey &&
    expandedNode.nodeId === selectedNode?.id;

  useEffect(() => {
    if (!focusSelection || !selectedNode || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    const selectionKey = `${activeGraphKey}:${selectedNode.id}`;
    if (explicitFocusRef.current === selectionKey) {
      explicitFocusRef.current = null;
      return;
    }

    focusNodeInViewport(
      selectedNode,
      activeGraphKey,
      selectionFocusMode,
      viewportSize.width,
      viewportSize.height,
      setTransforms,
    );
  }, [
    activeGraphKey,
    focusSelection,
    selectionFocusMode,
    selectedNode?.id,
    selectedNode?.x,
    selectedNode?.y,
    viewportSize.height,
    viewportSize.width,
  ]);

  return (
    <section
      aria-label={title}
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: overlayPanels
          ? "minmax(0, 1fr)"
          : `minmax(0, 1fr) ${typeof sidebarWidth === "number" ? `${sidebarWidth}px` : sidebarWidth}`,
        gap: 16,
        minHeight: overlayPanels ? "100vh" : "72vh",
        position: "relative",
        overflow: overlayPanels ? "hidden" : undefined,
        ...style,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateRows: overlayPanels ? "1fr" : "auto 1fr",
          gap: 12,
          minHeight: 0,
        }}
      >
        <header
          className={overlayPanels ? "epiphany-graph-overlay-panel" : undefined}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 16px",
            borderRadius: 22,
            background: PANEL_SURFACE,
            border: PANEL_BORDER,
            boxShadow: "0 18px 48px rgba(0, 0, 0, 0.26)",
            backdropFilter: "blur(14px)",
            ...(overlayPanels
              ? {
                  position: "absolute",
                  top: 16,
                  left: 16,
                  right: 16,
                  zIndex: 6,
                }
              : {}),
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div
              style={{
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                color: "#9fb3c8",
                fontSize: 12,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              <span>{title}</span>
              <span style={{ color: "#5eead4" }}>{status}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <GraphTab
                active={activeGraphKey === "architecture"}
                label={labels.architecture}
                count={state.architecture.nodes.length}
                onClick={() =>
                  startTransition(() => {
                    setActiveGraphKey("architecture");
                    if (selection?.graphKey && selection.graphKey !== "architecture") {
                      updateSelection(null);
                    }
                  })
                }
              />
              <GraphTab
                active={activeGraphKey === "dataflow"}
                label={labels.dataflow}
                count={state.dataflow.nodes.length}
                onClick={() =>
                  startTransition(() => {
                    setActiveGraphKey("dataflow");
                    if (selection?.graphKey && selection.graphKey !== "dataflow") {
                      updateSelection(null);
                    }
                  })
                }
              />
              <Pill label="Links" value={String(state.links.length)} accent="#f9a8d4" />
              <Pill label="Issues" value={String(issues.length)} accent={issues.length ? "#fbbf24" : "#86efac"} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ActionButton onClick={() => nudgeZoom(activeGraphKey, 1.18, setTransforms)}>+</ActionButton>
            <ActionButton onClick={() => nudgeZoom(activeGraphKey, 1 / 1.18, setTransforms)}>-</ActionButton>
            <ActionButton
              onClick={() => {
                if (!activeLayout || viewportSize.width <= 0 || viewportSize.height <= 0) {
                  return;
                }
                setTransforms((current) => ({
                  ...current,
                  [activeGraphKey]: fitGraphToViewport(
                    activeLayout,
                    viewportSize.width,
                    viewportSize.height,
                  ),
                }));
              }}
            >
              Reset
            </ActionButton>
          </div>
        </header>

        <div
          ref={viewportRef}
          onPointerDownCapture={(event) => {
            if ((event.button !== 0 && !isMiddlePointerEvent(event)) || isInteractiveArticleTarget(event.target)) {
              return;
            }

            handleViewportPointerDown(event, activeTransform, dragRef);
          }}
          onPointerMoveCapture={(event) =>
            handleViewportPointerMove(event, activeGraphKey, dragRef, setTransforms)
          }
          onPointerUpCapture={(event) => handleViewportPointerUp(event, dragRef)}
          onPointerCancelCapture={(event) => handleViewportPointerUp(event, dragRef)}
          onAuxClickCapture={(event) => {
            if (isMiddleMouseEvent(event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onClickCapture={(event) => {
            if (isMiddleMouseEvent(event)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          style={{
            position: "relative",
            minHeight: overlayPanels ? "100vh" : 540,
            overflow: "hidden",
            overscrollBehavior: "contain",
            touchAction: "none",
            borderRadius: overlayPanels ? 0 : 28,
            background: viewportBackground ?? (
              activeGraphKey === "architecture"
                ? "radial-gradient(circle at top left, rgba(8, 145, 178, 0.22), transparent 38%), linear-gradient(160deg, #08111e 0%, #0c1624 46%, #11192c 100%)"
                : "radial-gradient(circle at top right, rgba(244, 63, 94, 0.18), transparent 34%), linear-gradient(160deg, #0b1018 0%, #15111c 44%, #1a0d18 100%)"
            ),
            border: overlayPanels ? "none" : PANEL_BORDER,
            boxShadow: overlayPanels ? "none" : "0 18px 54px rgba(0, 0, 0, 0.3)",
          }}
        >
          {viewportBackdrop}

          <div
            className={overlayPanels ? "epiphany-graph-overlay-panel" : undefined}
            style={{
              position: "absolute",
              top: overlayPanels ? 102 : 14,
              left: 14,
              zIndex: 2,
              display: "grid",
              gap: 6,
              padding: "10px 12px",
              borderRadius: 18,
              background: "rgba(5, 10, 22, 0.7)",
              border: "1px solid rgba(148, 163, 184, 0.16)",
              color: "#b5c5d8",
              fontSize: 12,
              maxWidth: 260,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontWeight: 700, color: "#e5eef8" }}>
              {labels[activeGraphKey]} graph
            </div>
            <div>Wheel to zoom. Drag the void to pan. Click something interesting and the side panel stops being decorative.</div>
          </div>

          {status === "loading" && <StageMessage tone="#67e8f9">Laying out the graph. Rust solver is taking the hill.</StageMessage>}
          {status === "error" && <StageMessage tone="#fca5a5">{errorMessage ?? "Layout failed."}</StageMessage>}
          {status === "ready" && activeLayout && (
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${viewportSize.width || 1} ${viewportSize.height || 1}`}
              onPointerDown={(event) =>
                handlePointerDown(event, activeTransform, dragRef)
              }
              onPointerMove={(event) =>
                handlePointerMove(event, activeGraphKey, dragRef, setTransforms)
              }
              onPointerUp={(event) => handlePointerUp(event, dragRef)}
              onPointerLeave={(event) => handlePointerUp(event, dragRef)}
              onClick={(event) => {
                if (dragRef.current?.suppressClick) {
                  event.preventDefault();
                  event.stopPropagation();
                  dragRef.current.suppressClick = false;
                  return;
                }
                if (event.target === event.currentTarget) {
                  updateSelection(null);
                }
              }}
              style={{ width: "100%", height: "100%", display: "block", cursor: dragRef.current?.active ? "grabbing" : "grab" }}
            >
              <defs>
                <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="rgba(34, 211, 238, 0.38)" />
                </filter>
                <filter id="selectedGlow" x="-60%" y="-60%" width="220%" height="220%">
                  <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="rgba(253, 224, 71, 0.46)" />
                </filter>
              </defs>

              <g transform={`translate(${activeTransform.x} ${activeTransform.y}) scale(${activeTransform.scale})`}>
                {renderBackdropGrid(activeLayout, activeGraphKey)}
                {activeLayout.edges.map((edge) => {
                  const isSelected = selectedEdge?.resolvedId === edge.resolvedId;
                  const isConnected =
                    selectedNode &&
                    (edge.source_id === selectedNode.id || edge.target_id === selectedNode.id);
                  return (
                    <g key={edge.resolvedId} pointerEvents="none">
                      <path
                        d={edge.path}
                        fill="none"
                        stroke={edgeColor(activeGraphKey, isSelected, isConnected)}
                        strokeWidth={isSelected ? 3.4 : isConnected ? 2.6 : 1.9}
                        strokeOpacity={isSelected ? 0.94 : isConnected ? 0.76 : 0.35}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      {isSelected && edge.label?.trim() && (
                        <g
                          transform={`translate(${edge.midpoint.x} ${edge.midpoint.y}) scale(${1 / Math.max(0.001, activeTransform.scale)})`}
                          pointerEvents="none"
                          opacity={0.95}
                        >
                          <rect
                            x={-44}
                            y={-12}
                            width={88}
                            height={20}
                            rx={10}
                            fill="rgba(5, 10, 22, 0.82)"
                            stroke="rgba(148, 163, 184, 0.2)"
                            vectorEffect="non-scaling-stroke"
                          />
                          <text
                            x={0}
                            y={3}
                            textAnchor="middle"
                            fill="#dbe7f4"
                            fontSize={9.5}
                            fontWeight={700}
                          >
                            {edge.label}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              </g>
            </svg>
          )}
          {status === "ready" && activeLayout && (
            <div
              aria-label={`${labels[activeGraphKey]} node surfaces`}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 4,
                pointerEvents: "none",
              }}
            >
              {activeLayout.nodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                const isNeighbor = neighboringIds.has(node.id);
                const metrics = expandedNodeViewportMetrics(node, activeTransform, viewportSize.width, viewportSize.height);
                const selectionEmphasis = nodeOpacity(node, selectedNode, isNeighbor);
                const viewportEmphasis = smoothstep(0.1, 0.72, metrics.reveal);
                const emphasis = Math.max(selectionEmphasis, viewportEmphasis);
                const legacyExpandedNode =
                  expandedNodeMatches && isSelected && expandedNode
                    ? {
                        content: expandedNode.content,
                        className: expandedNode.className,
                        ariaLabel: expandedNode.ariaLabel,
                      }
                    : null;
                const providedArticle = nodeArticle
                  ? {
                      content: nodeArticle.content(node),
                      className: nodeArticle.className,
                      ariaLabel: nodeArticle.ariaLabel?.(node),
                    }
                  : null;
                const nodeArticleSurface = providedArticle?.content ? providedArticle : legacyExpandedNode;
                const rendersArticle = Boolean(nodeArticleSurface && metrics.article > 0.18);
                const rendersCompact = !rendersArticle && metrics.preview < 0.08;
                const className = nodeArticleSurface
                  ? ["epiphany-graph-node-surface", nodeArticleSurface.className].filter(Boolean).join(" ")
                  : "epiphany-graph-node-surface";

                return (
                  <div
                    key={node.id}
                    aria-label={nodeArticleSurface?.ariaLabel ?? node.title}
                    className={className}
                    onClickCapture={(event) => {
                      if (!rendersArticle) {
                        return;
                      }

                      if (dragRef.current?.suppressClick) {
                        event.preventDefault();
                        event.stopPropagation();
                        dragRef.current.suppressClick = false;
                        return;
                      }

                      onExpandedNodeClick?.(event);
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      if (dragRef.current?.suppressClick) {
                        event.preventDefault();
                        event.stopPropagation();
                        dragRef.current.suppressClick = false;
                        return;
                      }
                      if (isInteractiveArticleTarget(event.target)) {
                        return;
                      }
                      if (rendersArticle && isSelected) {
                        event.stopPropagation();
                        return;
                      }
                      event.stopPropagation();
                      updateSelection({
                        kind: "node",
                        graphKey: activeGraphKey,
                        nodeId: node.id,
                      });
                      explicitFocusRef.current = `${activeGraphKey}:${node.id}`;
                      if (focusSelection && viewportSize.width > 0 && viewportSize.height > 0) {
                        focusNodeInViewport(
                          node,
                          activeGraphKey,
                          "article",
                          viewportSize.width,
                          viewportSize.height,
                          setTransforms,
                        );
                      }
                    }}
                    onDoubleClick={(event) => {
                      if (isInteractiveArticleTarget(event.target)) {
                        return;
                      }
                      event.stopPropagation();
                      updateSelection({
                        kind: "node",
                        graphKey: activeGraphKey,
                        nodeId: node.id,
                      });
                      explicitFocusRef.current = `${activeGraphKey}:${node.id}`;
                      if (viewportSize.width > 0 && viewportSize.height > 0) {
                        focusNodeInViewport(
                          node,
                          activeGraphKey,
                          "article",
                          viewportSize.width,
                          viewportSize.height,
                          setTransforms,
                        );
                      }
                    }}
                    data-graph-key={activeGraphKey}
                    data-node-id={node.id}
                    data-node-stage={metrics.stage}
                    style={{
                      ...nodeSurfaceStyle(node, metrics, emphasis, isSelected, isNeighbor, rendersArticle),
                      cursor: "grab",
                    }}
                  >
                    {rendersArticle ? nodeArticleSurface?.content : rendersCompact ? <CompactNodeSurface node={node} /> : <DefaultNodeSurface node={node} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showSidebar && (
        <aside
        className={overlayPanels ? "epiphany-graph-overlay-panel" : undefined}
        style={{
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          gap: 12,
          minHeight: 0,
          ...(overlayPanels
            ? {
                position: "absolute",
                top: 110,
                right: 16,
                bottom: 16,
                zIndex: 5,
                width: typeof sidebarWidth === "number" ? `${sidebarWidth}px` : sidebarWidth,
                maxWidth: "calc(100vw - 32px)",
              }
            : {}),
        }}
      >
        <section
          style={{
            padding: "16px 18px",
            borderRadius: 24,
            background: PANEL_SURFACE,
            border: PANEL_BORDER,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div
                style={{
                  color: "#a3b4c8",
                  fontSize: 12,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Live graph
              </div>
              <div style={{ fontSize: 21, fontWeight: 800, color: "#f7fbff" }}>
                {labels[activeGraphKey]}
              </div>
            </div>
            <div
              style={{
                display: "grid",
                alignContent: "start",
                justifyItems: "end",
                color: "#b5c5d8",
                fontSize: 13,
              }}
            >
              <strong style={{ color: "#f8fbff" }}>{activeLayout?.nodes.length ?? 0} nodes</strong>
              <span>{activeLayout?.edges.length ?? 0} edges</span>
            </div>
          </div>
          <div style={{ color: "rgba(229, 238, 248, 0.68)", fontSize: 14, lineHeight: 1.5 }}>
            Low zoom shows structure. Higher zoom lets titles, purpose, and mechanism crawl into view one guilty layer at a time.
          </div>
        </section>

        <section
          style={{
            padding: "14px 16px",
            borderRadius: 22,
            background: PANEL_SURFACE,
            border: PANEL_BORDER,
            display: "grid",
            gap: 8,
          }}
        >
          <div
            style={{
              color: "#a3b4c8",
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Validation
          </div>
          {issues.length === 0 ? (
            <div style={{ color: "#86efac", fontSize: 14 }}>Typed graph shape is clean.</div>
          ) : (
            issues.slice(0, 4).map((issue) => (
              <div
                key={`${issue.scope}:${issue.message}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "rgba(120, 53, 15, 0.24)",
                  border: "1px solid rgba(251, 191, 36, 0.22)",
                  color: "#fcd34d",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ color: "#fde68a" }}>{issue.scope}</strong>: {issue.message}
              </div>
            ))
          )}
        </section>

        <section
          style={{
            minHeight: 0,
            overflow: "auto",
            padding: "18px 18px 20px",
            borderRadius: 28,
            background: PANEL_SURFACE,
            border: PANEL_BORDER,
            display: "grid",
            gap: 16,
          }}
        >
          {sidebar !== undefined ? sidebar : selectedNode ? (
            <NodeDetails
              node={selectedNode}
              graphKey={activeGraphKey}
              graphLabels={labels}
              linkedNodes={linkedNodes}
              links={state.links}
              onJump={(graphKey, nodeId) => {
                startTransition(() => {
                  setActiveGraphKey(graphKey);
                  updateSelection({ kind: "node", graphKey, nodeId });
                });
              }}
              onCodeRefSelect={(codeRef) => onCodeRefSelect?.(codeRef, { graphKey: activeGraphKey, selection })}
            />
          ) : selectedEdge ? (
            <EdgeDetails
              edge={selectedEdge}
              graphLabels={labels}
              onCodeRefSelect={(codeRef) => onCodeRefSelect?.(codeRef, { graphKey: activeGraphKey, selection })}
            />
          ) : (
            <EmptyDetails
              activeGraphKey={activeGraphKey}
              graphDescriptions={descriptions}
            />
          )}
        </section>
        </aside>
      )}
    </section>
  );
}

function GraphTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 0,
        borderRadius: 999,
        padding: "8px 12px",
        background: active ? "rgba(103, 232, 249, 0.18)" : "rgba(15, 23, 42, 0.74)",
        color: active ? "#d8f9ff" : "#b8c7d8",
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        cursor: "pointer",
        fontWeight: 700,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          minWidth: 22,
          height: 22,
          borderRadius: 999,
          display: "inline-grid",
          placeItems: "center",
          background: active ? "rgba(7, 16, 30, 0.84)" : "rgba(148, 163, 184, 0.14)",
          fontSize: 12,
        }}
      >
        {count}
      </span>
    </button>
  );
}

function Pill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        padding: "8px 12px",
        background: "rgba(15, 23, 42, 0.72)",
        color: "#b8c7d8",
        fontSize: 13,
      }}
    >
      <span>{label}</span>
      <strong style={{ color: accent }}>{value}</strong>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 0,
        borderRadius: 999,
        padding: "8px 12px",
        background: "rgba(15, 23, 42, 0.82)",
        color: "#e5eef8",
        cursor: "pointer",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function StageMessage({
  children,
  tone,
}: {
  children: string;
  tone: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 40,
        textAlign: "center",
        color: tone,
        fontSize: 18,
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}

function NodeDetails({
  node,
  graphKey,
  graphLabels,
  linkedNodes,
  links,
  onJump,
  onCodeRefSelect,
}: {
  node: PositionedNode;
  graphKey: GraphKey;
  graphLabels: Record<GraphKey, string>;
  linkedNodes: Array<{
    graphKey: GraphKey;
    nodeId: string;
    title: string;
    relationship: string | null;
  }>;
  links: EpiphanyGraphLink[];
  onJump: (graphKey: GraphKey, nodeId: string) => void;
  onCodeRefSelect: (codeRef: EpiphanyCodeRef) => void;
}) {
  const crossLinkCount = graphKey === "architecture"
    ? links.filter((link) => link.architecture_node_id === node.id).length
    : links.filter((link) => link.dataflow_node_id === node.id).length;

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            color: "#a3b4c8",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Selected node
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.05 }}>{node.title}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatusChip label={graphLabels[graphKey]} tone={graphKey === "architecture" ? "#67e8f9" : "#fb7185"} />
            {node.status?.trim() && <StatusChip label={node.status} tone={node.stroke} />}
            <StatusChip label={`${node.degree} degree`} tone="#c4b5fd" />
            <StatusChip label={`${crossLinkCount} links`} tone="#f9a8d4" />
          </div>
        </div>
      </div>

      <DetailBlock title="Purpose">{node.purpose}</DetailBlock>
      {node.mechanism?.trim() && <DetailBlock title="Mechanism">{node.mechanism}</DetailBlock>}
      {node.metaphor?.trim() && <DetailBlock title="Metaphor">{node.metaphor}</DetailBlock>}

      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            color: "#a3b4c8",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Cross-links
        </div>
        {linkedNodes.length === 0 ? (
          <div style={{ color: "rgba(229, 238, 248, 0.64)", fontSize: 14 }}>
            No typed cross-links for this node yet.
          </div>
        ) : (
          linkedNodes.map((linked) => (
            <button
              key={`${linked.graphKey}:${linked.nodeId}`}
              type="button"
              onClick={() => onJump(linked.graphKey, linked.nodeId)}
              style={{
                border: "1px solid rgba(249, 168, 212, 0.24)",
                borderRadius: 16,
                background: "rgba(76, 5, 25, 0.22)",
                color: "#fce7f3",
                padding: "12px 14px",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4 }}>
                {linked.title}
              </strong>
              <span style={{ color: "rgba(252, 231, 243, 0.78)", fontSize: 13 }}>
                {graphLabels[linked.graphKey]} • {linked.nodeId}
                {linked.relationship ? ` • ${linked.relationship}` : ""}
              </span>
            </button>
          ))
        )}
      </div>

      <CodeRefsList codeRefs={node.code_refs ?? []} onCodeRefSelect={onCodeRefSelect} />
    </>
  );
}

function EdgeDetails({
  edge,
  graphLabels,
  onCodeRefSelect,
}: {
  edge: PositionedEdge;
  graphLabels: Record<GraphKey, string>;
  onCodeRefSelect: (codeRef: EpiphanyCodeRef) => void;
}) {
  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            color: "#a3b4c8",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Selected edge
        </div>
        <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.08 }}>
          {edge.label?.trim() || edge.kind}
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusChip label={graphLabels[edge.graphKey]} tone={edge.graphKey === "architecture" ? "#67e8f9" : "#fb7185"} />
          <StatusChip label={edge.kind} tone="#c4b5fd" />
          {edge.id?.trim() && <StatusChip label={edge.id} tone="#c4b5fd" />}
        </div>
      </div>
      <DetailBlock title="Flow">
        {edge.source_id} → {edge.target_id}
      </DetailBlock>
      {edge.mechanism?.trim() && <DetailBlock title="Mechanism">{edge.mechanism}</DetailBlock>}
      <CodeRefsList codeRefs={edge.code_refs ?? []} onCodeRefSelect={onCodeRefSelect} />
    </>
  );
}

function EmptyDetails({
  activeGraphKey,
  graphDescriptions,
}: {
  activeGraphKey: GraphKey;
  graphDescriptions: Record<GraphKey, string>;
}) {
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        <div
          style={{
            color: "#a3b4c8",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Details
        </div>
        <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.05 }}>
          Click a node, or keep staring until the graph volunteers.
        </h2>
      </div>
      <DetailBlock title="What you are looking at">
        {graphDescriptions[activeGraphKey]}
      </DetailBlock>
      <DetailBlock title="Zoom policy">
        Titles appear first. Then purpose. Then mechanism and metaphor. The graph gets to be a map before it has to be a filing cabinet.
      </DetailBlock>
      <DetailBlock title="Cross-links">
        Nodes with the pink badge have typed correspondences in the other graph. Selecting them exposes the jump points instead of making you infer the relation from aura alone.
      </DetailBlock>
    </>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          color: "#a3b4c8",
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: "rgba(229, 238, 248, 0.88)",
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 9px",
        borderRadius: 999,
        background: "rgba(15, 23, 42, 0.76)",
        border: `1px solid ${tone}44`,
        color: tone,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function CodeRefsList({
  codeRefs,
  onCodeRefSelect,
}: {
  codeRefs: EpiphanyCodeRef[];
  onCodeRefSelect: (codeRef: EpiphanyCodeRef) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          color: "#a3b4c8",
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Code refs
      </div>
      {codeRefs.length === 0 ? (
        <div style={{ color: "rgba(229, 238, 248, 0.64)", fontSize: 14 }}>
          No code refs on this element yet.
        </div>
      ) : (
        codeRefs.map((codeRef, index) => (
          <button
            key={`${codeRef.path}:${codeRef.start_line ?? "?"}:${index}`}
            type="button"
            onClick={() => onCodeRefSelect(codeRef)}
            style={{
              border: "1px solid rgba(103, 232, 249, 0.22)",
              borderRadius: 16,
              background: "rgba(7, 20, 30, 0.72)",
              color: "#e5eef8",
              padding: "12px 14px",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <strong style={{ display: "block", marginBottom: 4 }}>{codeRef.path}</strong>
            <div style={{ color: "#9dd7ea", fontSize: 13 }}>
              {formatCodeRef(codeRef)}
            </div>
            {codeRef.note?.trim() && (
              <div style={{ color: "rgba(229, 238, 248, 0.66)", fontSize: 12, marginTop: 6 }}>
                {codeRef.note}
              </div>
            )}
          </button>
        ))
      )}
    </div>
  );
}

function renderBackdropGrid(layout: GraphLayout, graphKey: GraphKey) {
  const stroke = graphKey === "architecture" ? "rgba(103, 232, 249, 0.08)" : "rgba(251, 113, 133, 0.08)";
  const columns = Math.ceil(layout.width / 160);
  const rows = Math.ceil(layout.height / 120);
  const lines = [];

  for (let column = 0; column <= columns; column += 1) {
    const x = column * 160;
    lines.push(
      <line
        key={`column-${column}`}
        x1={x}
        y1={0}
        x2={x}
        y2={layout.height}
        stroke={stroke}
        strokeWidth={1}
      />,
    );
  }

  for (let row = 0; row <= rows; row += 1) {
    const y = row * 120;
    lines.push(
      <line
        key={`row-${row}`}
        x1={0}
        y1={y}
        x2={layout.width}
        y2={y}
        stroke={stroke}
        strokeWidth={1}
      />,
    );
  }

  return <g pointerEvents="none">{lines}</g>;
}

function findLinkedNodes(
  nodeId: string,
  graphKey: GraphKey,
  state: EpiphanyGraphViewerProps["state"],
) {
  if (graphKey === "architecture") {
    return state.links
      .filter((link) => link.architecture_node_id === nodeId)
      .map((link) => ({
        graphKey: "dataflow" as const,
        nodeId: link.dataflow_node_id,
        title:
          state.dataflow.nodes.find((node) => node.id === link.dataflow_node_id)?.title ??
          link.dataflow_node_id,
        relationship: link.relationship ?? null,
      }));
  }

  return state.links
    .filter((link) => link.dataflow_node_id === nodeId)
    .map((link) => ({
      graphKey: "architecture" as const,
      nodeId: link.architecture_node_id,
      title:
        state.architecture.nodes.find((node) => node.id === link.architecture_node_id)?.title ??
        link.architecture_node_id,
      relationship: link.relationship ?? null,
    }));
}

function fitGraphToViewport(layout: GraphLayout, width: number, height: number): ViewTransform {
  const padding = 76;
  const scale = clamp(
    Math.min((width - padding * 2) / layout.width, (height - padding * 2) / layout.height),
    0.36,
    1.12,
  );
  return {
    x: (width - layout.width * scale) / 2,
    y: (height - layout.height * scale) / 2,
    scale,
    userMoved: false,
  };
}

function nodeCenter(node: PositionedNode) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  };
}

function layoutModeCacheKey(mode: EpiphanyGraphLayoutModeConfig) {
  if (typeof mode === "string") {
    return mode;
  }

  return `${mode.architecture ?? "layered"}|${mode.dataflow ?? "layered"}`;
}

function resolveMotionOptions(
  layoutMode: EpiphanyGraphLayoutModeConfig,
  motion: EpiphanyGraphMotionOptions | boolean | undefined,
): EpiphanyGraphMotionOptions | null {
  if (motion === false) {
    return null;
  }

  const combinedForce =
    typeof layoutMode === "string"
      ? layoutMode === "combined-force"
      : layoutMode.architecture === "combined-force" || layoutMode.dataflow === "combined-force";

  if (motion === undefined && !combinedForce) {
    return null;
  }

  if (motion === true || motion === undefined) {
    return {};
  }

  return motion.enabled === false ? null : motion;
}

function motionOptionsCacheKey(options: EpiphanyGraphMotionOptions) {
  return [
    options.strength ?? "",
    options.damping ?? "",
    options.flow ?? "",
    options.orbit ?? "",
    options.lift ?? "",
    options.pulse ?? "",
    options.emitNodeEnvelopes ? "emit" : "",
  ].join("|");
}

function resolvePerformanceOptions(
  performance: EpiphanyGraphPerformancePreset | EpiphanyGraphPerformanceOptions | undefined,
): Required<EpiphanyGraphPerformanceOptions> {
  const base = performancePresetDefaults(
    typeof performance === "string" ? performance : performance?.preset ?? "balanced",
  );
  const overrides = typeof performance === "string" ? {} : performance ?? {};

  return {
    preset: overrides.preset ?? base.preset,
    simulationBudgetMs: clampFiniteNumber(overrides.simulationBudgetMs ?? base.simulationBudgetMs, 0.25, 24),
    targetFps: clampWholeNumber(overrides.targetFps ?? base.targetFps, 1, 60),
    maxAnimatedNodes: clampWholeNumber(overrides.maxAnimatedNodes ?? base.maxAnimatedNodes, 1, 5000),
    edgeRefreshRate: clampWholeNumber(overrides.edgeRefreshRate ?? base.edgeRefreshRate, 1, 12),
    maxTimeStepMs: clampWholeNumber(overrides.maxTimeStepMs ?? base.maxTimeStepMs, 8, 100),
  };
}

function performancePresetDefaults(
  preset: EpiphanyGraphPerformancePreset,
): Required<EpiphanyGraphPerformanceOptions> {
  if (preset === "quality") {
    return {
      preset,
      ...simulationProfilePresets.quality,
    };
  }

  if (preset === "fast") {
    return {
      preset,
      ...simulationProfilePresets.fast,
    };
  }

  return {
    preset,
    ...simulationProfilePresets.balanced,
  };
}

function performanceOptionsCacheKey(options: Required<EpiphanyGraphPerformanceOptions>) {
  return [
    options.preset,
    options.simulationBudgetMs,
    options.targetFps,
    options.maxAnimatedNodes,
    options.edgeRefreshRate,
    options.maxTimeStepMs,
  ].join("|");
}

function clampWholeNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.round(clamp(value, min, max));
}

function clampFiniteNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return clamp(value, min, max);
}

function createAdaptiveSimulationBudget(
  nodeCount: number,
  options: Required<EpiphanyGraphPerformanceOptions>,
): AdaptiveSimulationBudget {
  return {
    nodeBudget: Math.min(nodeCount, options.maxAnimatedNodes),
    edgeRefreshRate: options.edgeRefreshRate,
    averageCostMs: options.simulationBudgetMs,
  };
}

function adjustAdaptiveSimulationBudget(
  budget: AdaptiveSimulationBudget,
  costMs: number,
  nodeCount: number,
  options: Required<EpiphanyGraphPerformanceOptions>,
) {
  const target = options.simulationBudgetMs;
  const profile = simulationProfilePresets[options.preset];
  const measuredCost = Math.max(0.01, costMs);
  budget.averageCostMs = budget.averageCostMs * 0.82 + measuredCost * 0.18;

  if (budget.averageCostMs > target * profile.reduceThreshold) {
    const ratio = target / budget.averageCostMs;
    budget.nodeBudget = clampWholeNumber(
      budget.nodeBudget * clamp(ratio * profile.nodeBudgetCutRatio, 0.35, 0.9),
      1,
      Math.min(nodeCount, options.maxAnimatedNodes),
    );
    budget.edgeRefreshRate = clampWholeNumber(budget.edgeRefreshRate + 1, 1, 12);
    return;
  }

  if (budget.averageCostMs < target * profile.expandThreshold) {
    budget.nodeBudget = clampWholeNumber(
      budget.nodeBudget * profile.nodeBudgetGrowthRatio + profile.nodeBudgetGrowthAdd,
      1,
      Math.min(nodeCount, options.maxAnimatedNodes),
    );
    if (budget.averageCostMs < target * 0.35) {
      budget.edgeRefreshRate = clampWholeNumber(budget.edgeRefreshRate - 1, 1, 12);
    }
  }
}

function sampleCombinedForce(
  x: number,
  y: number,
  context: {
    graphKey: GraphKey;
    scale: number;
    time: number;
    bounds: ViewportTransformEnvelope["bounds"];
  },
  pulse: number,
) {
  const graphBias = context.graphKey === "architecture" ? 0.74 : 1.18;
  const normalizedX = x - 0.5;
  const normalizedY = y - 0.5;
  const distance = Math.max(0.001, Math.hypot(normalizedX, normalizedY));
  const spin = context.time * (0.32 + graphBias * 0.12) * pulse;
  const wave =
    Math.sin((x * 4.8 + y * 2.6 + spin) * Math.PI) * 0.52 +
    Math.cos((y * 5.2 - x * 1.8 - spin * 0.7) * Math.PI) * 0.48;
  const swirlX = -normalizedY / distance;
  const swirlY = normalizedX / distance;
  const driftX = Math.cos(wave + graphBias) * 0.34 + swirlX * 0.66;
  const driftY = Math.sin(wave - graphBias) * 0.34 + swirlY * 0.66;
  const scaleAttenuation = clamp(1.12 - context.scale * 0.08, 0.42, 1);
  const graphSpan = Math.max(1, Math.hypot(context.bounds.width, context.bounds.height));

  return {
    flowX: driftX * scaleAttenuation,
    flowY: driftY * scaleAttenuation,
    strength: clamp(0.42 + Math.abs(wave) * 0.38 + graphSpan / 8000, 0.24, 1),
    curvature: clamp((0.5 - distance) * 1.7 + wave * 0.26, -1, 1),
  };
}

function dynamicNodesFromLayout(layout: GraphLayout): DynamicNodeState[] {
  return layout.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    vx: 0,
    vy: 0,
  }));
}

function nodeAabb(nodes: PositionedNode[]) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = Math.max(160, Math.min(460, Math.max(width, height) * 0.18));
  return {
    x: minX - padding,
    y: minY - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

function stepDynamicLayouts({
  baseLayouts,
  states,
  activeGraphKey,
  transforms,
  motionOptions,
  viewportElement,
  viewportWidth,
  viewportHeight,
  dt,
  time,
  maxAnimatedNodes,
  refreshEdges,
  previousLayout,
}: {
  baseLayouts: Record<GraphKey, GraphLayout>;
  states: React.MutableRefObject<Record<GraphKey, DynamicNodeState[]> | null>;
  activeGraphKey: GraphKey;
  transforms: Record<GraphKey, ViewTransform>;
  motionOptions: EpiphanyGraphMotionOptions;
  viewportElement: HTMLElement | null;
  viewportWidth: number;
  viewportHeight: number;
  dt: number;
  time: number;
  maxAnimatedNodes: number;
  refreshEdges: boolean;
  previousLayout: GraphLayout | null;
}): { layouts: Record<GraphKey, GraphLayout> } | null {
  if (!states.current) {
    states.current = {
      architecture: dynamicNodesFromLayout(baseLayouts.architecture),
      dataflow: dynamicNodesFromLayout(baseLayouts.dataflow),
    };
  }

  const graphState = states.current[activeGraphKey];
  const baseLayout = baseLayouts[activeGraphKey];
  const transform = transforms[activeGraphKey];
  const nodeLookup = new Map(baseLayout.nodes.map((node) => [node.id, node]));
  const stateLookup = new Map(graphState.map((node) => [node.id, node]));
  const strength = motionOptions.strength ?? 1;
  const damping = motionOptions.damping ?? 0.82;
  const flow = motionOptions.flow ?? 1;
  const orbit = motionOptions.orbit ?? 1;
  const lift = motionOptions.lift ?? 1;
  const pulse = motionOptions.pulse ?? 1;
  const bounds = nodeAabb(baseLayout.nodes);
  const centerX = baseLayout.width * 0.5;
  const centerY = baseLayout.height * 0.5;
  const animatedNodeIds = animatedNodeIdSet(baseLayout.nodes, stateLookup, maxAnimatedNodes);

  for (const node of baseLayout.nodes) {
    if (animatedNodeIds && !animatedNodeIds.has(node.id)) {
      continue;
    }

    let dynamic = stateLookup.get(node.id);
    if (!dynamic) {
      dynamic = { id: node.id, x: node.x, y: node.y, vx: 0, vy: 0 };
      graphState.push(dynamic);
      stateLookup.set(node.id, dynamic);
    }

    const nodeCenterX = dynamic.x + node.width * 0.5;
    const nodeCenterY = dynamic.y + node.height * 0.5;
    const screenX = transform.x + nodeCenterX * transform.scale;
    const screenY = transform.y + nodeCenterY * transform.scale;
    const sample = sampleCombinedForce(screenX / Math.max(1, viewportWidth), screenY / Math.max(1, viewportHeight), {
      graphKey: activeGraphKey,
      scale: transform.scale,
      time,
      bounds,
    }, pulse);
    const homeX = node.x - dynamic.x;
    const homeY = node.y - dynamic.y;
    const orbitX = nodeCenterX - centerX;
    const orbitY = nodeCenterY - centerY;
    const orbitLength = Math.max(1, Math.hypot(orbitX, orbitY));
    const tangentX = -orbitY / orbitLength;
    const tangentY = orbitX / orbitLength;
    const envelope = Math.max(node.width, node.height) * 0.02 * lift;
    const forceX =
      homeX * 3.4 +
      sample.flowX * (42 + sample.strength * 80) * strength * flow +
      tangentX * sample.curvature * 36 * strength * orbit;
    const forceY =
      homeY * 3.4 +
      sample.flowY * (42 + sample.strength * 80) * strength * flow +
      tangentY * sample.curvature * 36 * strength * orbit -
      envelope;
    dynamic.vx = (dynamic.vx + forceX * dt) * Math.pow(damping, dt * 60);
    dynamic.vy = (dynamic.vy + forceY * dt) * Math.pow(damping, dt * 60);
    dynamic.x += dynamic.vx * dt;
    dynamic.y += dynamic.vy * dt;
  }

  const nextActiveLayout = layoutWithDynamicNodes(
    baseLayout,
    graphState,
    nodeLookup,
    refreshEdges,
    previousLayout,
  );
  if (motionOptions.emitNodeEnvelopes && viewportElement) {
    viewportElement.dispatchEvent(new CustomEvent<NodeEnvelope[]>("epiphanygraph-node-envelopes", {
      bubbles: true,
      detail: nextActiveLayout.nodes.map((node) => ({
        id: node.id,
        x: (transform.x + (node.x + node.width * 0.5) * transform.scale) / Math.max(1, viewportWidth),
        y: (transform.y + (node.y + node.height * 0.5) * transform.scale) / Math.max(1, viewportHeight),
        radius: Math.max(node.width, node.height) * transform.scale / Math.max(1, Math.min(viewportWidth, viewportHeight)),
        strength: 0.34 + Math.min(1, (node.degree + node.linkCount) / 6) * 0.66,
      })),
    }));
  }

  return {
    layouts: {
      ...baseLayouts,
      [activeGraphKey]: nextActiveLayout,
    },
  };
}

function animatedNodeIdSet(
  nodes: PositionedNode[],
  stateLookup: Map<string, DynamicNodeState>,
  maxAnimatedNodes: number,
) {
  if (nodes.length <= maxAnimatedNodes) {
    return null;
  }

  return new Set(
    [...nodes]
      .sort((left, right) =>
        nodeSimulationPriority(right, stateLookup.get(right.id)) -
        nodeSimulationPriority(left, stateLookup.get(left.id)),
      )
      .slice(0, maxAnimatedNodes)
      .map((node) => node.id),
  );
}

function nodeSimulationPriority(node: PositionedNode, dynamic: DynamicNodeState | undefined) {
  const graphImportance = node.degree * 2 + node.linkCount * 3;
  if (!dynamic) {
    return graphImportance + 1;
  }

  const homeError = Math.hypot(node.x - dynamic.x, node.y - dynamic.y) / Math.max(1, Math.max(node.width, node.height));
  const kineticError = Math.hypot(dynamic.vx, dynamic.vy) / 120;
  return graphImportance + homeError * 6 + kineticError * 4;
}

function layoutWithDynamicNodes(
  layout: GraphLayout,
  dynamicNodes: DynamicNodeState[],
  nodeLookup: Map<string, PositionedNode>,
  refreshEdges: boolean,
  previousLayout: GraphLayout | null,
): GraphLayout {
  const dynamicLookup = new Map(dynamicNodes.map((node) => [node.id, node]));
  const nodes = layout.nodes.map((node) => {
    const dynamic = dynamicLookup.get(node.id);
    return dynamic ? { ...node, x: dynamic.x, y: dynamic.y } : node;
  });
  if (!refreshEdges) {
    return { ...layout, nodes, edges: previousLayout?.edges ?? layout.edges };
  }

  const nextLookup = new Map(nodes.map((node) => [node.id, node]));
  const edges = layout.edges.map((edge) => {
    const source = nextLookup.get(edge.source_id) ?? nodeLookup.get(edge.source_id);
    const target = nextLookup.get(edge.target_id) ?? nodeLookup.get(edge.target_id);
    if (!source || !target) {
      return edge;
    }
    const points = dynamicStraightEdgePoints(edge, nextLookup);
    return {
      ...edge,
      points,
      path: dynamicPointsToPath(points),
      midpoint: dynamicEdgeMidpoint(points),
    };
  });
  return { ...layout, nodes, edges };
}

function dynamicStraightEdgePoints(
  edge: Pick<PositionedEdge, "source_id" | "target_id">,
  nodes: Map<string, PositionedNode>,
): PositionedPoint[] {
  const source = nodes.get(edge.source_id);
  const target = nodes.get(edge.target_id);
  if (!source || !target) {
    return [];
  }
  return [
    {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    },
    {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    },
  ];
}

function dynamicPointsToPath(points: PositionedPoint[]) {
  if (points.length === 0) {
    return "";
  }
  const [first, ...rest] = points;
  return `M ${formatPoint(first.x)} ${formatPoint(first.y)} ${rest
    .map((point) => `L ${formatPoint(point.x)} ${formatPoint(point.y)}`)
    .join(" ")}`;
}

function dynamicEdgeMidpoint(points: PositionedPoint[]) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  return points[Math.floor(points.length / 2)];
}

function formatPoint(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0";
}

function focusNodeInViewport(
  node: PositionedNode,
  graphKey: GraphKey,
  mode: NodeFocusMode,
  viewportWidth: number,
  viewportHeight: number,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  const targetScale = focusedNodeScale(node, viewportWidth, viewportHeight, mode);
  const center = nodeCenter(node);
  setTransforms((current) => ({
    ...current,
    [graphKey]: {
      x: viewportWidth / 2 - center.x * targetScale,
      y: viewportHeight / 2 - center.y * targetScale,
      scale: targetScale,
      userMoved: true,
    },
  }));
}

function focusedNodeScale(
  node: PositionedNode,
  viewportWidth: number,
  viewportHeight: number,
  mode: NodeFocusMode,
) {
  const targetWidth = Math.max(320, viewportWidth * (mode === "article" ? 0.72 : 0.38));
  const targetHeight = Math.max(180, viewportHeight * (mode === "article" ? 0.74 : 0.28));
  return clamp(
    Math.min(targetWidth / Math.max(1, node.width), targetHeight / Math.max(1, node.height)),
    0.72,
    16,
  );
}

function expandedNodeViewportMetrics(
  node: PositionedNode,
  transform: ViewTransform,
  viewportWidth: number,
  viewportHeight: number,
) {
  const left = transform.x + node.x * transform.scale;
  const top = transform.y + node.y * transform.scale;
  const width = node.width * transform.scale;
  const height = node.height * transform.scale;
  const areaRatio = (width * height) / Math.max(1, viewportWidth * viewportHeight);
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const focusDistance = Math.hypot(centerX - viewportWidth / 2, centerY - viewportHeight / 2);
  const focusRadius = Math.min(viewportWidth, viewportHeight);
  const focusProximity = 1 - smoothstep(focusRadius * 0.16, focusRadius * 0.62, focusDistance);
  const footprintReveal = smoothstep(0.018, 0.25, areaRatio);
  const minimumReadableSpan = Math.min(width / Math.max(1, viewportWidth), height / Math.max(1, viewportHeight));
  const spanReveal = smoothstep(0.12, 0.54, minimumReadableSpan);
  const readableFootprint = clamp(footprintReveal * 0.58 + spanReveal * 0.42, 0, 1);
  const reveal = readableFootprint * (0.55 + focusProximity * 0.45);
  const preview = smoothstep(0.16, 0.58, reveal);
  const article = smoothstep(0.58, 0.92, reveal);
  const borderRadius = lerp(16, 32, article);
  const compactWidth = Math.min(width, clamp(94 + node.title.length * 7.8, 132, 360));
  const compactHeight = Math.min(height, 58);
  const visualGrowth = Math.max(preview, article);
  const visualWidth = lerp(compactWidth, width, visualGrowth);
  const visualHeight = lerp(compactHeight, height, visualGrowth);
  const visualLeft = centerX - visualWidth / 2;
  const visualTop = centerY - visualHeight / 2;

  return {
    left: visualLeft,
    top: visualTop,
    width: visualWidth,
    height: visualHeight,
    layoutLeft: left,
    layoutTop: top,
    layoutWidth: width,
    layoutHeight: height,
    areaRatio,
    focusProximity,
    reveal,
    preview,
    article,
    borderRadius,
    surfaceOpacity: smoothstep(0.04, 0.2, reveal),
    stage: expandedNodeStage(width, height, areaRatio),
  };
}

function nodeSurfaceStyle(
  node: PositionedNode,
  metrics: ReturnType<typeof expandedNodeViewportMetrics>,
  emphasis: number,
  isSelected: boolean,
  isNeighbor: boolean,
  rendersArticle: boolean,
) {
  const preview = metrics.preview;
  const article = metrics.article;
  const selectedGlow = isSelected ? 0.28 : isNeighbor ? 0.14 : 0.06;

  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: metrics.width,
    height: metrics.height,
    transform: `translate3d(${metrics.left}px, ${metrics.top}px, 0)`,
    "--node-screen-area-ratio": metrics.areaRatio,
    "--node-focus-proximity": metrics.focusProximity,
    "--node-reveal": metrics.reveal,
    "--node-preview": preview,
    "--node-article": article,
    "--node-compact": 1 - preview,
    "--node-pad-y": `${0.5 + article * 1.32}rem`,
    "--node-pad-x": `${0.58 + article * 1.64}rem`,
    "--node-badge-size": `${2.2 + preview * 1.25 + article * 1.1}rem`,
    "--node-title-size": `${0.92 + preview * 0.9 + article * 0.86}rem`,
    "--node-title-max-height": `${1.08 + preview * 1.62 + article * 3.2}em`,
    "--node-kicker-margin": `${0.1 + preview * 0.34}rem`,
    "--node-panel-gap": `${0.55 + preview * 0.45}rem`,
    "--node-header-margin": `${preview}rem`,
    "--node-preview-height": `${preview * 12}rem`,
    "--node-status-margin": `${preview}rem`,
    "--node-article-height": `${article * 420}rem`,
    "--node-note-list-height": `${article * 80}rem`,
    "--node-article-offset": `${(1 - article) * 0.65}rem`,
    "--node-badge-glow": `${0.8 + preview * 1.6}rem`,
    zIndex: isSelected ? 5 : isNeighbor ? 4 : 3,
    boxSizing: "border-box",
    display: "block",
    minWidth: 0,
    minHeight: 0,
    overflow: rendersArticle ? "auto" : "hidden",
    overscrollBehavior: "contain",
    padding: `var(--node-pad-y) var(--node-pad-x)`,
    borderRadius: metrics.borderRadius,
    color: "#effcf8",
    background:
      isSelected
        ? "linear-gradient(145deg, rgba(7, 22, 32, 0.97), rgba(6, 11, 23, 0.94))"
        : node.fill,
    border: `1px solid ${isSelected ? "rgba(186, 230, 253, 0.76)" : node.stroke}`,
    boxShadow:
      isSelected || isNeighbor
        ? `0 0 0 1px rgba(34, 211, 238, ${selectedGlow}), 0 12px 32px rgba(0, 0, 0, 0.32), 0 0 24px rgba(34, 211, 238, ${selectedGlow})`
        : "0 0 0 1px rgba(34, 211, 238, 0.06), 0 8px 18px rgba(0, 0, 0, 0.24)",
    opacity: Math.max(0.18, emphasis),
    pointerEvents: "auto",
    willChange: rendersArticle ? "auto" : "transform",
  } as CSSProperties & NodeSurfaceCustomProperties;
}

type NodeSurfaceCustomProperties = {
  "--node-screen-area-ratio": number;
  "--node-focus-proximity": number;
  "--node-reveal": number;
  "--node-preview": number;
  "--node-article": number;
  "--node-compact": number;
  "--node-pad-y": string;
  "--node-pad-x": string;
  "--node-badge-size": string;
  "--node-title-size": string;
  "--node-title-max-height": string;
  "--node-kicker-margin": string;
  "--node-panel-gap": string;
  "--node-header-margin": string;
  "--node-preview-height": string;
  "--node-status-margin": string;
  "--node-article-height": string;
  "--node-note-list-height": string;
  "--node-article-offset": string;
  "--node-badge-glow": string;
};

function CompactNodeSurface({ node }: { node: PositionedNode }) {
  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "var(--node-badge-size) minmax(0, 1fr)",
        alignItems: "center",
        gap: "0.55rem",
        height: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          width: "var(--node-badge-size)",
          height: "var(--node-badge-size)",
          placeItems: "center",
          borderRadius: 999,
          background: node.stroke,
          color: "#071019",
          fontSize: "calc(var(--node-title-size) * 0.78)",
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        {node.badgeText}
      </span>
      <strong
        style={{
          display: "block",
          minWidth: 0,
          overflow: "hidden",
          color: "#f7fffb",
          fontSize: "var(--node-title-size)",
          lineHeight: 1.05,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {node.title}
      </strong>
    </article>
  );
}

function DefaultNodeSurface({ node }: { node: PositionedNode }) {
  return (
    <article
      style={{
        display: "grid",
        gap: "calc(var(--node-preview) * 0.8rem)",
        height: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "var(--node-badge-size) minmax(0, 1fr)",
          alignItems: "center",
          gap: "var(--node-panel-gap)",
          minHeight: "var(--node-badge-size)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            width: "var(--node-badge-size)",
            height: "var(--node-badge-size)",
            placeItems: "center",
            borderRadius: 999,
            background: `linear-gradient(160deg, ${node.stroke}, #c2f5f0)`,
            color: "#071019",
            fontSize: "calc(var(--node-title-size) * 0.8)",
            fontWeight: 900,
            lineHeight: 1,
            boxShadow:
              "inset 0 0 0 1px rgba(255, 255, 255, 0.28), 0 0 var(--node-badge-glow) rgba(94, 234, 212, 0.3)",
          }}
        >
          {node.badgeText}
        </span>
        <span style={{ minWidth: 0 }}>
          <strong
            style={{
              display: "block",
              maxHeight: "var(--node-title-max-height)",
              overflow: "hidden",
              color: "#f7fffb",
              fontSize: "var(--node-title-size)",
              lineHeight: 1.04,
              letterSpacing: 0,
            }}
          >
            {node.title}
          </strong>
          <span
            style={{
              display: "block",
              maxHeight: "calc(var(--node-preview) * 2.8em)",
              overflow: "hidden",
              color: "rgba(103, 232, 249, 0.82)",
              fontSize: "calc(var(--node-title-size) * 0.42)",
              fontWeight: 800,
              lineHeight: 1.15,
              opacity: "var(--node-preview)",
              textTransform: "uppercase",
            }}
          >
            {node.status ?? `${node.linkCount} links`}
          </span>
        </span>
      </header>
      <p
        style={{
          maxHeight: "var(--node-preview-height)",
          margin: 0,
          overflow: "hidden",
          color: "rgba(229, 238, 248, 0.86)",
          fontSize: "calc(0.78rem + var(--node-article) * 0.18rem)",
          lineHeight: 1.45,
          opacity: "var(--node-preview)",
        }}
      >
        {node.purpose}
      </p>
      {(node.mechanism || node.metaphor) && (
        <p
          style={{
            maxHeight: "calc(var(--node-article) * 10rem)",
            margin: 0,
            overflow: "hidden",
            color: "rgba(244, 114, 182, 0.82)",
            fontSize: "0.84rem",
            lineHeight: 1.45,
            opacity: "var(--node-article)",
          }}
        >
          {node.mechanism ?? node.metaphor}
        </p>
      )}
    </article>
  );
}

function expandedNodeStage(width: number, height: number, areaRatio: number) {
  if (width >= 680 && height >= 420 && areaRatio >= 0.22) {
    return "article";
  }

  if (width >= 360 && height >= 190 && areaRatio >= 0.07) {
    return "preview";
  }

  return "summary";
}

function handleNativeWheel(
  event: WheelEvent,
  viewportElement: HTMLElement,
  graphKey: GraphKey,
  transforms: Record<GraphKey, ViewTransform>,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  event.preventDefault();
  event.stopPropagation();
  const rect = viewportElement.getBoundingClientRect();
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const current = transforms[graphKey];
  const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nextScale = clamp(current.scale * zoomFactor, 0.28, 16);
  const worldX = (cursorX - current.x) / current.scale;
  const worldY = (cursorY - current.y) / current.scale;
  const nextX = cursorX - worldX * nextScale;
  const nextY = cursorY - worldY * nextScale;

  setTransforms((existing) => ({
    ...existing,
    [graphKey]: {
      x: nextX,
      y: nextY,
      scale: nextScale,
      userMoved: true,
    },
  }));
}

function handlePointerDown(
  event: ReactPointerEvent<SVGSVGElement>,
  transform: ViewTransform,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
) {
  if (event.target !== event.currentTarget) {
    return;
  }
  if (event.button !== 0 && !isMiddlePointerEvent(event)) {
    return;
  }
  dragRef.current = {
    active: true,
    pointerId: event.pointerId,
    moved: false,
    suppressClick: false,
    originX: event.clientX,
    originY: event.clientY,
    startX: transform.x,
    startY: transform.y,
  };
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
}

function handlePointerMove(
  event: ReactPointerEvent<SVGSVGElement>,
  graphKey: GraphKey,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  if (!dragRef.current?.active) {
    return;
  }
  if (event.pointerId !== dragRef.current.pointerId) {
    return;
  }
  const deltaX = event.clientX - dragRef.current.originX;
  const deltaY = event.clientY - dragRef.current.originY;
  if (Math.hypot(deltaX, deltaY) > 3) {
    dragRef.current.moved = true;
    dragRef.current.suppressClick = true;
  }
  setTransforms((existing) => ({
    ...existing,
    [graphKey]: {
      ...existing[graphKey],
      x: dragRef.current!.startX + deltaX,
      y: dragRef.current!.startY + deltaY,
      userMoved: true,
    },
  }));
}

function handlePointerUp(
  event: ReactPointerEvent<SVGSVGElement>,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
) {
  if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) {
    return;
  }

  if (dragRef.current.moved) {
    event.preventDefault();
  }

  if (event.currentTarget.hasPointerCapture(dragRef.current.pointerId)) {
    event.currentTarget.releasePointerCapture(dragRef.current.pointerId);
  }
  dragRef.current.active = false;
}

function handleViewportPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  transform: ViewTransform,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
) {
  if (event.button !== 0 && !isMiddlePointerEvent(event)) {
    return;
  }
  dragRef.current = {
    active: true,
    pointerId: event.pointerId,
    moved: false,
    suppressClick: false,
    originX: event.clientX,
    originY: event.clientY,
    startX: transform.x,
    startY: transform.y,
  };
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
}

function isMiddlePointerEvent(event: ReactPointerEvent<HTMLElement>) {
  return event.button === 1 || (event.buttons & 4) === 4;
}

function isMiddleMouseEvent(event: ReactMouseEvent<HTMLElement>) {
  return event.button === 1 || (event.buttons & 4) === 4;
}

function handleViewportPointerMove(
  event: ReactPointerEvent<HTMLElement>,
  graphKey: GraphKey,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  if (!dragRef.current?.active || event.pointerId !== dragRef.current.pointerId) {
    return;
  }

  const deltaX = event.clientX - dragRef.current.originX;
  const deltaY = event.clientY - dragRef.current.originY;
  if (Math.hypot(deltaX, deltaY) > 3) {
    dragRef.current.moved = true;
    dragRef.current.suppressClick = true;
  }
  event.preventDefault();
  event.stopPropagation();
  setTransforms((existing) => ({
    ...existing,
    [graphKey]: {
      ...existing[graphKey],
      x: dragRef.current!.startX + deltaX,
      y: dragRef.current!.startY + deltaY,
      userMoved: true,
    },
  }));
}

function handleViewportPointerUp(
  event: ReactPointerEvent<HTMLElement>,
  dragRef: React.MutableRefObject<ViewportDragState | null>,
) {
  if (!dragRef.current || event.pointerId !== dragRef.current.pointerId) {
    return;
  }

  event.stopPropagation();
  if (dragRef.current.moved) {
    event.preventDefault();
  }

  if (event.currentTarget.hasPointerCapture(dragRef.current.pointerId)) {
    event.currentTarget.releasePointerCapture(dragRef.current.pointerId);
  }
  dragRef.current.active = false;
}

function isInteractiveArticleTarget(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, select, summary, [role='button']"));
}

function nudgeZoom(
  graphKey: GraphKey,
  factor: number,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  setTransforms((current) => ({
    ...current,
    [graphKey]: {
      ...current[graphKey],
      scale: clamp(current[graphKey].scale * factor, 0.28, 16),
      userMoved: true,
    },
  }));
}

function edgeColor(graphKey: GraphKey, isSelected: boolean, isConnected: boolean | null) {
  if (isSelected) {
    return "#fde68a";
  }
  if (isConnected) {
    return graphKey === "architecture" ? "#67e8f9" : "#fb7185";
  }
  return graphKey === "architecture" ? "#22d3ee" : "#f43f5e";
}

function nodeOpacity(
  node: PositionedNode,
  selectedNode: PositionedNode | null,
  isNeighbor: boolean,
) {
  if (!selectedNode) {
    return 1;
  }
  if (selectedNode.id === node.id || isNeighbor) {
    return 1;
  }
  return 0.36;
}

function isCompactGraphLayout(layout: GraphLayout) {
  if (layout.nodes.length === 0) {
    return false;
  }

  const widths = layout.nodes.map((node) => node.width).sort((left, right) => left - right);
  const medianWidth = widths[Math.floor(widths.length / 2)] ?? 0;
  return medianWidth < 96;
}

function fadeBetween(value: number, start: number, end: number) {
  if (value <= start) {
    return 0;
  }
  if (value >= end) {
    return 1;
  }
  return (value - start) / (end - start);
}

function smoothstep(start: number, end: number, value: number) {
  if (start === end) {
    return value >= end ? 1 : 0;
  }
  const progress = clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * clamp(amount, 0, 1);
}

function ellipsizeLine(text: string, maxChars: number) {
  if (text.length < maxChars) {
    return `${text}…`;
  }
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

function formatCodeRef(codeRef: EpiphanyCodeRef) {
  const linePart =
    codeRef.start_line != null
      ? codeRef.end_line != null && codeRef.end_line !== codeRef.start_line
        ? `:${codeRef.start_line}-${codeRef.end_line}`
        : `:${codeRef.start_line}`
      : "";
  const symbolPart = codeRef.symbol?.trim() ? ` • ${codeRef.symbol}` : "";
  return `${codeRef.path}${linePart}${symbolPart}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
