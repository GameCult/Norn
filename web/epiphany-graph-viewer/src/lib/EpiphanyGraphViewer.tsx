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
  style,
  className,
  title = "Epiphany Graph Viewer",
  onCodeRefSelect,
}: EpiphanyGraphViewerProps) {
  const [activeGraphKey, setActiveGraphKey] = useState<GraphKey>(initialGraph);
  const [selection, setSelection] = useState<ViewerSelection | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    setIssues(validateEpiphanyGraphsState(state));

    layoutEpiphanyGraphs(state)
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
  }, [state]);

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
  const selectedNode =
    selection?.kind === "node" && selection.graphKey === activeGraphKey && activeLayout
      ? activeLayout.nodes.find((node) => node.id === selection.nodeId) ?? null
      : null;
  const selectedEdge =
    selection?.kind === "edge" && selection.graphKey === activeGraphKey && activeLayout
      ? activeLayout.edges.find((edge) => edge.resolvedId === selection.edgeId) ?? null
      : null;

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

  return (
    <section
      aria-label={title}
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 330px",
        gap: 16,
        minHeight: "72vh",
        ...style,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto 1fr",
          gap: 12,
          minHeight: 0,
        }}
      >
        <header
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
                label="Architecture"
                count={state.architecture.nodes.length}
                onClick={() =>
                  startTransition(() => {
                    setActiveGraphKey("architecture");
                    if (selection?.graphKey && selection.graphKey !== "architecture") {
                      setSelection(null);
                    }
                  })
                }
              />
              <GraphTab
                active={activeGraphKey === "dataflow"}
                label="Dataflow"
                count={state.dataflow.nodes.length}
                onClick={() =>
                  startTransition(() => {
                    setActiveGraphKey("dataflow");
                    if (selection?.graphKey && selection.graphKey !== "dataflow") {
                      setSelection(null);
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
            minHeight: 540,
            overflow: "hidden",
            overscrollBehavior: "contain",
            touchAction: "none",
            borderRadius: 28,
            background:
              activeGraphKey === "architecture"
                ? "radial-gradient(circle at top left, rgba(8, 145, 178, 0.22), transparent 38%), linear-gradient(160deg, #08111e 0%, #0c1624 46%, #11192c 100%)"
                : "radial-gradient(circle at top right, rgba(244, 63, 94, 0.18), transparent 34%), linear-gradient(160deg, #0b1018 0%, #15111c 44%, #1a0d18 100%)",
            border: PANEL_BORDER,
            boxShadow: "0 18px 54px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 14,
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
              {activeGraphKey === "architecture" ? "Architecture graph" : "Dataflow graph"}
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
                  setSelection(null);
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
                          setSelection({
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
                      {activeTransform.scale > 1.25 && edge.label?.trim() && (
                        <g
                          transform={`translate(${edge.midpoint.x} ${edge.midpoint.y})`}
                          pointerEvents="none"
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
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      opacity={emphasis}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelection({
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
                      <rect
                        x={6}
                        y={6}
                        width={node.width - 12}
                        height={node.height - 12}
                        rx={21}
                        fill="rgba(255, 255, 255, 0.02)"
                        stroke="rgba(255, 255, 255, 0.06)"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={20}
                        cy={20}
                        r={12}
                        fill={node.stroke}
                        stroke="rgba(229, 238, 248, 0.24)"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={20}
                        y={24}
                        textAnchor="middle"
                        fill="#071019"
                        fontSize={10}
                        fontWeight={800}
                      >
                        {node.badgeText}
                      </text>

                      {node.status?.trim() && activeTransform.scale > 0.66 && (
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
                            {node.status.toUpperCase()}
                          </text>
                        </g>
                      )}

                      {node.linkCount > 0 && (
                        <g transform={`translate(${node.width - 30} ${node.height - 26})`}>
                          <circle
                            cx={0}
                            cy={0}
                            r={13}
                            fill="rgba(5, 10, 22, 0.9)"
                            stroke="#f9a8d4"
                            strokeWidth={1.5}
                            vectorEffect="non-scaling-stroke"
                          />
                          <text
                            x={0}
                            y={4}
                            textAnchor="middle"
                            fill="#fce7f3"
                            fontSize={10}
                            fontWeight={800}
                          >
                            {node.linkCount}
                          </text>
                        </g>
                      )}

                      <g opacity={fadeBetween(activeTransform.scale, 0.5, 0.82)} pointerEvents="none">
                        {renderTextLines(
                          copyLayout.titleLines,
                          44,
                          26,
                          15,
                          {
                            fill: "#f8fbff",
                            fontSize: 13,
                            fontWeight: 800,
                          },
                        )}
                      </g>

                      <g opacity={fadeBetween(activeTransform.scale, 1.02, 1.44)} pointerEvents="none">
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

                      <g opacity={fadeBetween(activeTransform.scale, 1.55, 1.92)} pointerEvents="none">
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
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </div>

      <aside
        style={{
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          gap: 12,
          minHeight: 0,
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
                {activeGraphKey === "architecture" ? "Architecture" : "Dataflow"}
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
          {selectedNode ? (
            <NodeDetails
              node={selectedNode}
              graphKey={activeGraphKey}
              linkedNodes={linkedNodes}
              links={state.links}
              onJump={(graphKey, nodeId) => {
                startTransition(() => {
                  setActiveGraphKey(graphKey);
                  setSelection({ kind: "node", graphKey, nodeId });
                });
              }}
              onCodeRefSelect={(codeRef) => onCodeRefSelect?.(codeRef, { graphKey: activeGraphKey, selection })}
            />
          ) : selectedEdge ? (
            <EdgeDetails
              edge={selectedEdge}
              onCodeRefSelect={(codeRef) => onCodeRefSelect?.(codeRef, { graphKey: activeGraphKey, selection })}
            />
          ) : (
            <EmptyDetails activeGraphKey={activeGraphKey} />
          )}
        </section>
      </aside>
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
  linkedNodes,
  links,
  onJump,
  onCodeRefSelect,
}: {
  node: PositionedNode;
  graphKey: GraphKey;
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
            <StatusChip label={graphKey} tone={graphKey === "architecture" ? "#67e8f9" : "#fb7185"} />
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
                {linked.graphKey} • {linked.nodeId}
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
  onCodeRefSelect,
}: {
  edge: PositionedEdge;
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
          <StatusChip label={edge.kind} tone={edge.graphKey === "architecture" ? "#67e8f9" : "#fb7185"} />
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

function EmptyDetails({ activeGraphKey }: { activeGraphKey: GraphKey }) {
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
        {activeGraphKey === "architecture"
          ? "Architecture nodes describe durable system parts: stores, renderers, promoters, bridges, and shells."
          : "Dataflow nodes describe the movement of evidence and structure through the pipeline: observations, proposals, validation, fragments, turns."}
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
  const nextScale = clamp(current.scale * zoomFactor, 0.28, 2.8);
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
      scale: clamp(current[graphKey].scale * factor, 0.28, 2.8),
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
  const titleWidth = Math.max(
    108,
    node.width - (node.status?.trim() ? 154 : 92),
  );
  const bodyWidth = Math.max(148, node.width - 34);
  const titleLines = wrapTextToLines(
    node.title,
    estimateCharacterCapacity(titleWidth, 7.4),
    2,
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
