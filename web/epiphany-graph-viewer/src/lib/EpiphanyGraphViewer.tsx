import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { layoutEpiphanyGraphs } from "./layout";
import type {
  EpiphanyCodeRef,
  EpiphanyGraphLink,
  EpiphanyGraphViewerProps,
  EpiphanyValidationIssue,
  GraphKey,
  GraphLayout,
  PositionedEdge,
  PositionedNode,
  PositionedPoint,
  ViewerSelection,
} from "./types";
import { validateEpiphanyGraphsState } from "./validation";

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
  userMoved: boolean;
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
  layoutAlgorithms,
  sidebar,
  sidebarWidth = 330,
  showSidebar = true,
  overlayPanels = false,
  focusSelection = false,
  expandedNode,
  onExpandedNodeClick,
  onSelectionChange,
  onCodeRefSelect,
}: EpiphanyGraphViewerProps) {
  const [activeGraphKey, setActiveGraphKey] = useState<GraphKey>(initialGraph);
  const [localSelection, setLocalSelection] = useState<ViewerSelection | null>(null);
  const [layouts, setLayouts] = useState<Record<GraphKey, GraphLayout> | null>(null);
  const [issues, setIssues] = useState<EpiphanyValidationIssue[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [transforms, setTransforms] = useState<Record<GraphKey, ViewTransform>>({
    architecture: { x: 0, y: 0, scale: 1, userMoved: false },
    dataflow: { x: 0, y: 0, scale: 1, userMoved: false },
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const wheelStateRef = useRef({
    activeGraphKey,
    transforms,
  });
  const dragRef = useRef<{
    active: boolean;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const selection = controlledSelection === undefined ? localSelection : controlledSelection;
  const layoutAlgorithmKey = `${layoutAlgorithms?.architecture ?? ""}|${layoutAlgorithms?.dataflow ?? ""}`;
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
      layoutAlgorithms,
      viewportSize.width > 0 && viewportSize.height > 0 ? viewportSize : undefined,
    )
      .then((nextLayouts) => {
        if (cancelled) {
          return;
        }
        setLayouts(nextLayouts);
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
  }, [layoutAlgorithmKey, state, viewportSize.height, viewportSize.width]);

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

  const activeLayout = layouts?.[activeGraphKey] ?? null;
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
  const expandedNodeMetrics =
    expandedNodeMatches && selectedNode && viewportSize.width > 0 && viewportSize.height > 0
      ? expandedNodeViewportMetrics(selectedNode, activeTransform, viewportSize.width, viewportSize.height)
      : null;

  useEffect(() => {
    if (!focusSelection || !selectedNode || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    const center = nodeCenter(selectedNode);
    const targetScale = clamp(transforms[activeGraphKey].scale, 0.72, 1.08);
    setTransforms((current) => ({
      ...current,
      [activeGraphKey]: {
        x: viewportSize.width / 2 - center.x * targetScale,
        y: viewportSize.height / 2 - center.y * targetScale,
        scale: targetScale,
        userMoved: true,
      },
    }));
  }, [
    activeGraphKey,
    focusSelection,
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
          style={{
            position: "relative",
            minHeight: overlayPanels ? "100vh" : 540,
            overflow: "hidden",
            overscrollBehavior: "contain",
            touchAction: "none",
            borderRadius: overlayPanels ? 0 : 28,
            background:
              activeGraphKey === "architecture"
                ? "radial-gradient(circle at top left, rgba(8, 145, 178, 0.22), transparent 38%), linear-gradient(160deg, #08111e 0%, #0c1624 46%, #11192c 100%)"
                : "radial-gradient(circle at top right, rgba(244, 63, 94, 0.18), transparent 34%), linear-gradient(160deg, #0b1018 0%, #15111c 44%, #1a0d18 100%)",
            border: overlayPanels ? "none" : PANEL_BORDER,
            boxShadow: overlayPanels ? "none" : "0 18px 54px rgba(0, 0, 0, 0.3)",
          }}
        >
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

          {status === "loading" && <StageMessage tone="#67e8f9">Laying out the graph. ELK is thinking noble thoughts.</StageMessage>}
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
              onPointerUp={() => handlePointerUp(dragRef)}
              onPointerLeave={() => handlePointerUp(dragRef)}
              onClick={(event) => {
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
                    <g key={edge.resolvedId}>
                      <path
                        d={edge.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={18}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateSelection({
                            kind: "edge",
                            graphKey: activeGraphKey,
                            edgeId: edge.resolvedId,
                          });
                        }}
                      />
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
                      {(isSelected || isConnected || (!compactGraph && activeTransform.scale > 1.75)) &&
                        edge.label?.trim() && (
                        <g
                          transform={`translate(${edge.midpoint.x} ${edge.midpoint.y})`}
                          pointerEvents="none"
                          opacity={
                            isSelected || isConnected
                              ? 1
                              : fadeBetween(activeTransform.scale, 1.75, 2.05)
                          }
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

                {activeLayout.nodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const isNeighbor = neighboringIds.has(node.id);
                  const emphasis = nodeOpacity(node, selectedNode, isNeighbor);
                  const copyLayout = buildNodeCopyLayout(node);
                  const clipId = `node-clip-${safeDomId(activeGraphKey)}-${safeDomId(node.id)}`;
                  const badgeRadius = Math.max(6, Math.min(12, node.width / 4, node.height / 3));
                  const badgeX = Math.max(badgeRadius + 4, Math.min(20, node.width / 2));
                  const badgeY = node.height < 40 ? node.height / 2 : 20;
                  const statusText = node.status?.trim() ?? "";
                  const showStatus = Boolean(statusText) && node.width >= 176 && node.height >= 72;
                  const showLinkCount = node.linkCount > 0 && node.width >= 150 && node.height >= 86;
                  const titleX = badgeX + badgeRadius + 14;
                  const titleY = node.height < 76 ? node.height / 2 + 4 : 26;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      opacity={emphasis}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateSelection({
                          kind: "node",
                          graphKey: activeGraphKey,
                          nodeId: node.id,
                        });
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={node.width}
                        height={node.height}
                        rx={26}
                        fill={node.fill}
                        stroke={node.stroke}
                        strokeWidth={isSelected ? 2.8 : isNeighbor ? 2.1 : 1.4}
                        vectorEffect="non-scaling-stroke"
                        filter={isSelected ? "url(#selectedGlow)" : "url(#nodeGlow)"}
                      />
                      <clipPath id={clipId}>
                        <rect x={0} y={0} width={node.width} height={node.height} rx={26} />
                      </clipPath>
                      <g clipPath={`url(#${clipId})`}>
                        <rect
                          x={6}
                          y={6}
                          width={Math.max(0, node.width - 12)}
                          height={Math.max(0, node.height - 12)}
                          rx={21}
                          fill="rgba(255, 255, 255, 0.02)"
                          stroke="rgba(255, 255, 255, 0.06)"
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          cx={badgeX}
                          cy={badgeY}
                          r={badgeRadius}
                          fill={node.stroke}
                          stroke="rgba(229, 238, 248, 0.24)"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={badgeX}
                          y={badgeY + badgeRadius * 0.34}
                          textAnchor="middle"
                          fill="#071019"
                          fontSize={Math.max(6, badgeRadius * 0.82)}
                          fontWeight={800}
                        >
                          {node.badgeText}
                        </text>

                        {showStatus && activeTransform.scale > 0.66 && (
                          <g transform={`translate(${node.width - 78} 10)`} opacity={fadeBetween(activeTransform.scale, 0.62, 0.9)}>
                          <rect
                            x={0}
                            y={0}
                            width={68}
                            height={18}
                            rx={9}
                            fill="rgba(5, 10, 22, 0.74)"
                            stroke="rgba(255, 255, 255, 0.1)"
                            vectorEffect="non-scaling-stroke"
                          />
                          <text
                            x={34}
                            y={12.5}
                            textAnchor="middle"
                            fill={node.stroke}
                            fontSize={8.5}
                            fontWeight={700}
                            letterSpacing="0.06em"
                          >
                            {statusText.toUpperCase()}
                          </text>
                          </g>
                        )}

                        {showLinkCount && (
                          <g transform={`translate(${node.width - 27} ${node.height - 24})`}>
                          <circle
                            cx={0}
                            cy={0}
                            r={10}
                            fill="rgba(5, 10, 22, 0.9)"
                            stroke="#f9a8d4"
                            strokeWidth={1.5}
                            vectorEffect="non-scaling-stroke"
                          />
                          <text
                            x={0}
                            y={3.5}
                            textAnchor="middle"
                            fill="#fce7f3"
                            fontSize={8.5}
                            fontWeight={800}
                          >
                            {node.linkCount}
                          </text>
                          </g>
                        )}

                        <g opacity={node.width >= 92 && node.height >= 40 ? fadeBetween(activeTransform.scale, 0.42, 0.72) : 0} pointerEvents="none">
                          {renderTextLines(
                            copyLayout.titleLines,
                            titleX,
                            titleY,
                            15,
                            {
                              fill: "#f8fbff",
                              fontSize: 13,
                              fontWeight: 800,
                            },
                          )}
                        </g>

                        <g opacity={node.width >= 136 && node.height >= 68 ? fadeBetween(activeTransform.scale, 1.02, 1.44) : 0} pointerEvents="none">
                          {renderTextLines(
                            copyLayout.purposeLines,
                            16,
                            copyLayout.purposeStartY,
                            12.5,
                            {
                              fill: "rgba(229, 238, 248, 0.88)",
                              fontSize: 10.6,
                            },
                          )}
                        </g>

                        <g opacity={node.width >= 190 && node.height >= 96 ? fadeBetween(activeTransform.scale, 1.72, 2.18) : 0} pointerEvents="none">
                          {renderTextLines(
                            copyLayout.mechanismLines,
                            16,
                            copyLayout.mechanismStartY,
                            11.5,
                            {
                              fill: "rgba(103, 232, 249, 0.86)",
                              fontSize: 9.4,
                            },
                          )}
                          {renderTextLines(
                            copyLayout.metaphorLines,
                            16,
                            copyLayout.metaphorStartY,
                            11.2,
                            {
                              fill: "rgba(244, 114, 182, 0.84)",
                              fontSize: 9.1,
                            },
                          )}
                        </g>
                      </g>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          {expandedNodeMatches && expandedNodeMetrics && expandedNode && (
            <div
              key={`${expandedNode.graphKey}:${expandedNode.nodeId}`}
              aria-label={expandedNode.ariaLabel}
              className={expandedNode.className}
              onClickCapture={onExpandedNodeClick}
              data-graph-key={activeGraphKey}
              data-node-id={selectedNode?.id}
              style={{
                position: "absolute",
                left: expandedNodeMetrics.left,
                top: expandedNodeMetrics.top,
                width: expandedNodeMetrics.width,
                height: expandedNodeMetrics.height,
                zIndex: 4,
                overflow: "auto",
                borderRadius: 32,
                background:
                  "linear-gradient(145deg, rgba(7, 22, 32, 0.96), rgba(6, 11, 23, 0.94))",
                border: "1px solid rgba(186, 230, 253, 0.72)",
                boxShadow:
                  "0 0 0 1px rgba(34, 211, 238, 0.16), 0 28px 90px rgba(0, 0, 0, 0.48), 0 0 58px rgba(34, 211, 238, 0.24)",
                pointerEvents: "auto",
              }}
            >
              {expandedNode.content}
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

function expandedNodeViewportMetrics(
  node: PositionedNode,
  transform: ViewTransform,
  viewportWidth: number,
  viewportHeight: number,
) {
  const center = nodeCenter(node);
  const screenCenter = {
    x: transform.x + center.x * transform.scale,
    y: transform.y + center.y * transform.scale,
  };
  const width = Math.min(Math.max(viewportWidth * 0.72, 560), viewportWidth - 56);
  const height = Math.min(Math.max(viewportHeight * 0.74, 420), viewportHeight - 136);
  const left = clamp(screenCenter.x - width / 2, 24, Math.max(24, viewportWidth - width - 24));
  const top = clamp(screenCenter.y - height / 2, 108, Math.max(108, viewportHeight - height - 24));

  return {
    left,
    top,
    width,
    height,
  };
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
  const nextScale = clamp(current.scale * zoomFactor, 0.28, 5.4);
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
  dragRef: React.MutableRefObject<{
    active: boolean;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>,
) {
  if (event.target !== event.currentTarget) {
    return;
  }
  dragRef.current = {
    active: true,
    originX: event.clientX,
    originY: event.clientY,
    startX: transform.x,
    startY: transform.y,
  };
}

function handlePointerMove(
  event: ReactPointerEvent<SVGSVGElement>,
  graphKey: GraphKey,
  dragRef: React.MutableRefObject<{
    active: boolean;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>,
  setTransforms: React.Dispatch<React.SetStateAction<Record<GraphKey, ViewTransform>>>,
) {
  if (!dragRef.current?.active) {
    return;
  }
  const deltaX = event.clientX - dragRef.current.originX;
  const deltaY = event.clientY - dragRef.current.originY;
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
  dragRef: React.MutableRefObject<{
    active: boolean;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>,
) {
  if (dragRef.current) {
    dragRef.current.active = false;
  }
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
      scale: clamp(current[graphKey].scale * factor, 0.28, 5.4),
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

function safeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
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

function buildNodeCopyLayout(node: PositionedNode) {
  const compactHeight = node.height < 76;
  const reservesStatusLane = node.status?.trim() && node.width >= 176 && node.height >= 72;
  const reservesLinkLane = node.linkCount > 0 && node.width >= 150 && node.height >= 86;
  const titleLeftInset = node.height < 40 ? 32 : 46;
  const titleRightInset = reservesStatusLane ? 92 : reservesLinkLane ? 48 : 18;
  const titleWidth = Math.max(
    28,
    node.width - titleLeftInset - titleRightInset,
  );
  const bodyWidth = Math.max(80, node.width - 34);
  const titleLines = wrapTextToLines(
    node.title,
    estimateCharacterCapacity(titleWidth, 7.4),
    compactHeight ? 1 : 2,
  );
  const purposeLines = wrapTextToLines(
    node.purpose,
    estimateCharacterCapacity(bodyWidth, 6.15),
    3,
  );
  const mechanismLines = node.mechanism?.trim()
    ? wrapTextToLines(
        node.mechanism,
        estimateCharacterCapacity(bodyWidth, 6),
        2,
      )
    : [];
  const metaphorLines = node.metaphor?.trim()
    ? wrapTextToLines(
        node.metaphor,
        estimateCharacterCapacity(bodyWidth, 6),
        2,
      )
    : [];

  const purposeStartY = 26 + titleLines.length * 15 + 12;
  const mechanismStartY =
    purposeStartY + purposeLines.length * 12.5 + (purposeLines.length > 0 ? 11 : 0);
  const metaphorStartY =
    mechanismStartY +
    mechanismLines.length * 11.5 +
    (mechanismLines.length > 0 ? 9 : 0);

  return {
    titleLines,
    purposeLines,
    mechanismLines,
    metaphorLines,
    purposeStartY,
    mechanismStartY,
    metaphorStartY,
  };
}

function renderTextLines(
  lines: string[],
  x: number,
  startY: number,
  lineHeight: number,
  options: {
    fill: string;
    fontSize: number;
    fontWeight?: number;
  },
) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <text
      x={x}
      y={startY}
      fill={options.fill}
      fontSize={options.fontSize}
      fontWeight={options.fontWeight}
    >
      {lines.map((line, index) => (
        <tspan key={`${startY}-${index}`} x={x} dy={index === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function wrapTextToLines(text: string, maxChars: number, maxLines: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      if (lines.length === maxLines) {
        truncated = true;
        current = "";
        break;
      }
      current = word;
      continue;
    }

    lines.push(word.slice(0, Math.max(1, maxChars - 1)));
    truncated = true;
    current = "";
    if (lines.length === maxLines) {
      break;
    }
  }

  if (current) {
    if (lines.length < maxLines) {
      lines.push(current);
    } else {
      truncated = true;
    }
  }

  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = ellipsizeLine(lines[lines.length - 1], maxChars);
  }

  return lines;
}

function estimateCharacterCapacity(pixelWidth: number, averageCharWidth: number) {
  return Math.max(12, Math.floor(pixelWidth / averageCharWidth));
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
