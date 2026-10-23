"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { generateDeterministicAssistantReply } from "@/lib/assistant";
import {
  addBranch,
  appendBranchMessage,
  connectBranches,
  createDiscoveryAnswer,
  createManualAutomationRun,
  createTaskDrafts,
  getSafeAutomationTemplates,
  updateTaskStatus,
} from "@/lib/operating-system";
import { createStableId } from "@/lib/workspace";
import type {
  BranchEdgeRelationship,
  ProjectBranch,
  ProjectOperatingSystem,
} from "@/types/operating-system";
import type { ProjectWorkspace, WorkspaceMessage } from "@/types/workspace";

type WorkspaceOperatingSystemProps = {
  workspace: ProjectWorkspace;
  onChange: (workspace: ProjectWorkspace) => void;
  projectId?: string;
  serverBacked?: boolean;
  onSelectedBranchChange?: (branchId: string) => void;
  presentation?: "branches" | "connection";
};

type CanvasPoint = { x: number; y: number };
type CanvasView = { zoom: number; pan: CanvasPoint };

/**
 * The persisted layout fields are optional while older workspace records are
 * being upgraded. Keep the UI compatible with both the current local types
 * and the server contract that carries these fields.
 */
type PersistedProjectBranch = ProjectBranch & { canvasPosition?: CanvasPoint };
type PersistedProjectOperatingSystem = ProjectOperatingSystem & { viewport?: CanvasView; canvasViewport?: CanvasView };

type RelationshipFilter = "selected" | "all";

const CANVAS_WIDTH = 1_360;
const CANVAS_HEIGHT = 720;
const NODE_WIDTH = 210;
const NODE_HEIGHT = 82;
const ROOT_WIDTH = 250;
const ROOT_HEIGHT = 74;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.75;
const BRANCH_VIEW_STORAGE_PREFIX = "medharya:workspace-os-view:v1:";
const PAN_LIMIT = 2_000;

function timestamp() {
  return new Date().toISOString();
}

function branchMessage(
  role: WorkspaceMessage["role"],
  content: string,
  source: WorkspaceMessage["source"] = role === "user" ? "user" : "deterministic-fallback",
  citations?: WorkspaceMessage["citations"],
): WorkspaceMessage {
  return {
    id: createStableId("branch-message"),
    role,
    content,
    createdAt: timestamp(),
    source,
    ...(citations?.length ? { citations } : {}),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function positionWithinCanvas(point: CanvasPoint): CanvasPoint {
  return {
    x: clamp(point.x, 16, CANVAS_WIDTH - NODE_WIDTH - 16),
    y: clamp(point.y, 110, CANVAS_HEIGHT - NODE_HEIGHT - 18),
  };
}

function isCanvasPoint(value: unknown): value is CanvasPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && Number.isFinite(point.x)
    && typeof point.y === "number" && Number.isFinite(point.y);
}

function persistedViewport(value: unknown): CanvasView | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom) || !isCanvasPoint(candidate.pan)) return null;
  return {
    zoom: clamp(candidate.zoom, MIN_ZOOM, MAX_ZOOM),
    pan: { x: candidate.pan.x, y: candidate.pan.y },
  };
}

function roundedPoint(point: CanvasPoint): CanvasPoint {
  return {
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
  };
}

function descendantIds(branches: ProjectBranch[], branchId: string) {
  const descendants = new Set<string>();
  const pending = [branchId];
  while (pending.length) {
    const parentId = pending.shift();
    if (!parentId) continue;
    branches.forEach((branch) => {
      if (branch.parentBranchId === parentId && !descendants.has(branch.id)) {
        descendants.add(branch.id);
        pending.push(branch.id);
      }
    });
  }
  return descendants;
}

function hasAttachedBranchWork(
  operatingSystem: ProjectOperatingSystem,
  branch: ProjectBranch,
) {
  return branch.taskIds.length > 0
    || branch.requirements.length > 0
    || branch.researchFindingIds.length > 0
    || branch.decisionIds.length > 0
    || operatingSystem.tasks.some((task) => task.branchId === branch.id)
    || operatingSystem.milestones.some((milestone) => milestone.branchId === branch.id)
    || branch.messages.length > 1
    || branch.messages.some((message) => message.role === "user" || message.source !== "deterministic-fallback");
}

function isDuplicateActiveRelationship(
  edges: ProjectOperatingSystem["edges"],
  fromBranchId: string,
  toBranchId: string,
  relationship: BranchEdgeRelationship,
  exceptEdgeId?: string,
) {
  return edges.some((edge) => {
    if (edge.status !== "active" || edge.id === exceptEdgeId || edge.relationship !== relationship) return false;
    const sameDirection = edge.fromBranchId === fromBranchId && edge.toBranchId === toBranchId;
    const reverseRelated = relationship === "related-to"
      && edge.fromBranchId === toBranchId
      && edge.toBranchId === fromBranchId;
    return sameDirection || reverseRelated;
  });
}

function defaultPositions(branches: ProjectBranch[]) {
  const positions: Record<string, CanvasPoint> = {};
  const topLevelBranches = branches.filter((branch) => !branch.parentBranchId);

  topLevelBranches.forEach((branch, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    positions[branch.id] = positionWithinCanvas({
      x: 34 + column * 316,
      y: 148 + row * 130,
    });
  });

  function resolvePosition(branch: ProjectBranch, visiting = new Set<string>()): CanvasPoint {
    if (positions[branch.id]) return positions[branch.id];
    if (visiting.has(branch.id)) {
      const fallback = positionWithinCanvas({ x: 34, y: 148 + branches.indexOf(branch) * 30 });
      positions[branch.id] = fallback;
      return fallback;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(branch.id);
    const parent = branch.parentBranchId
      ? branches.find((candidate) => candidate.id === branch.parentBranchId)
      : undefined;
    if (!parent) {
      const fallback = positionWithinCanvas({ x: 34, y: 148 + branches.indexOf(branch) * 30 });
      positions[branch.id] = fallback;
      return fallback;
    }

    const parentPosition = resolvePosition(parent, nextVisiting);
    const siblings = branches.filter((candidate) => candidate.parentBranchId === parent.id);
    const siblingIndex = Math.max(0, siblings.findIndex((candidate) => candidate.id === branch.id));
    const centeredOffset = (siblingIndex - (siblings.length - 1) / 2) * 100;
    const resolved = positionWithinCanvas({
      x: parentPosition.x + 244,
      y: parentPosition.y + centeredOffset,
    });
    positions[branch.id] = resolved;
    return resolved;
  }

  branches.forEach((branch) => resolvePosition(branch));
  return positions;
}

function readCitations(value: unknown): WorkspaceMessage["citations"] {
  if (!Array.isArray(value)) return undefined;
  const citations = value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.title !== "string" ||
      typeof record.url !== "string" ||
      typeof record.retrievedAt !== "string"
    ) {
      return [];
    }
    return [{
      title: record.title,
      url: record.url,
      retrievedAt: record.retrievedAt,
      ...(typeof record.evidenceId === "string" ? { evidenceId: record.evidenceId } : {}),
      ...(typeof record.sourceId === "string" ? { sourceId: record.sourceId } : {}),
    }];
  });
  return citations.length ? citations : undefined;
}

function responsePayload(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function branchSourceLabel(message: WorkspaceMessage) {
  if (message.role === "user") return "You · branch note";
  if (message.source === "model-assisted") return "Medharya · branch model";
  if (message.source === "web-researched") return "Medharya · branch research";
  return "Medharya · branch fallback";
}

function edgePath(from: CanvasPoint, to: CanvasPoint, fromHeight = NODE_HEIGHT) {
  const startX = from.x + NODE_WIDTH / 2;
  const startY = from.y + fromHeight;
  const endX = to.x + NODE_WIDTH / 2;
  const endY = to.y;
  const curve = Math.max(34, Math.abs(endY - startY) * 0.45);
  return `M ${startX} ${startY} C ${startX} ${startY + curve}, ${endX} ${endY - curve}, ${endX} ${endY}`;
}

function appendBranchMessageIfMissing(
  workspace: ProjectWorkspace,
  branchId: string,
  message: WorkspaceMessage,
) {
  const branch = workspace.operatingSystem?.branches.find((candidate) => candidate.id === branchId);
  if (!branch || branch.messages.some((candidate) => candidate.id === message.id)) return workspace;
  return appendBranchMessage(workspace, branchId, message);
}

export function WorkspaceOperatingSystem({
  workspace,
  onChange,
  projectId = "",
  serverBacked = false,
  onSelectedBranchChange,
  presentation = "branches",
}: WorkspaceOperatingSystemProps) {
  const operatingSystem = workspace.operatingSystem as PersistedProjectOperatingSystem;
  const branches = operatingSystem.branches as PersistedProjectBranch[];
  const canvasRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    kind: "node" | "pan";
    branchId?: string;
    start: CanvasPoint;
    origin: CanvasPoint;
  } | null>(null);
  const didDragRef = useRef(false);
  const lastNotifiedBranchRef = useRef("");
  const workspaceRef = useRef(workspace);
  const nodePositionsRef = useRef<Record<string, CanvasPoint>>(defaultPositions(branches));
  const viewRef = useRef<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const layoutWorkspaceRef = useRef("");
  const persistedLayoutSignatureRef = useRef("");
  const branchChatRequestRef = useRef<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id ?? "");
  const [nodePositions, setNodePositions] = useState<Record<string, CanvasPoint>>(() => defaultPositions(branches));
  const [view, setView] = useState<CanvasView>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [viewReady, setViewReady] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchParentId, setNewBranchParentId] = useState("");
  const [branchMessageDraft, setBranchMessageDraft] = useState("");
  const [branchChatSending, setBranchChatSending] = useState(false);
  const [branchChatError, setBranchChatError] = useState<string | null>(null);
  const [branchChatNotice, setBranchChatNotice] = useState<string | null>(null);
  const [connectTargetId, setConnectTargetId] = useState(branches[1]?.id ?? "");
  const [connectRelationship, setConnectRelationship] = useState<BranchEdgeRelationship>("related-to");
  const [connectorMode, setConnectorMode] = useState(false);
  const [connectorSourceId, setConnectorSourceId] = useState("");
  const [editingBranchId, setEditingBranchId] = useState("");
  const [editingBranchName, setEditingBranchName] = useState("");
  const [reparentParentId, setReparentParentId] = useState("");
  const [relationshipFilter, setRelationshipFilter] = useState<RelationshipFilter>("selected");
  const [discoveryDraft, setDiscoveryDraft] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | "draft" | "in-progress" | "blocked" | "done">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const selectedBranchIdRef = useRef(selectedBranchId);

  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  const fallbackPositions = useMemo(() => defaultPositions(branches), [branches]);
  const persistedPositions = useMemo(
    () => Object.fromEntries(
      branches.flatMap((branch) => isCanvasPoint(branch.canvasPosition)
        ? [[branch.id, positionWithinCanvas(branch.canvasPosition)]]
        : []),
    ),
    [branches],
  );
  const persistedView = useMemo(
    () => persistedViewport(operatingSystem.viewport ?? operatingSystem.canvasViewport),
    [operatingSystem.canvasViewport, operatingSystem.viewport],
  );
  const persistedLayoutSignature = useMemo(
    () => JSON.stringify({ positions: persistedPositions, viewport: persistedView }),
    [persistedPositions, persistedView],
  );
  const visibleTasks = useMemo(
    () => operatingSystem.tasks.filter((task) => taskFilter === "all" || task.status === taskFilter),
    [operatingSystem.tasks, taskFilter],
  );
  const firstQuestion = operatingSystem.discoveryQuestions.find((question) => question.status === "open");
  const activeRelationshipEdges = useMemo(
    () => operatingSystem.edges.filter((edge) => {
      if (edge.status !== "active") return false;
      const from = branches.find((branch) => branch.id === edge.fromBranchId);
      const to = branches.find((branch) => branch.id === edge.toBranchId);
      return Boolean(from && to && from.status === "active" && to.status === "active");
    }),
    [branches, operatingSystem.edges],
  );
  const displayedRelationshipEdges = useMemo(
    () => relationshipFilter === "selected" && selectedBranch
      ? activeRelationshipEdges.filter((edge) => edge.fromBranchId === selectedBranch.id || edge.toBranchId === selectedBranch.id)
      : activeRelationshipEdges,
    [activeRelationshipEdges, relationshipFilter, selectedBranch],
  );

  useEffect(() => {
    nodePositionsRef.current = nodePositions;
  }, [nodePositions]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    selectedBranchIdRef.current = selectedBranchId;
  }, [selectedBranchId]);

  useEffect(() => {
    const isNewWorkspace = layoutWorkspaceRef.current !== workspace.id;
    const isNewPersistedLayout = persistedLayoutSignatureRef.current !== persistedLayoutSignature;
    if (!isNewWorkspace && (!isNewPersistedLayout || (!Object.keys(persistedPositions).length && !persistedView))) return;

    layoutWorkspaceRef.current = workspace.id;
    persistedLayoutSignatureRef.current = persistedLayoutSignature;
    const storageKey = `${BRANCH_VIEW_STORAGE_PREFIX}${workspace.id}`;
    let savedBranchId = "";
    let savedPositions: Record<string, CanvasPoint> = {};
    let savedView: CanvasView | null = null;
    try {
      savedBranchId = window.localStorage.getItem(`${storageKey}:selected`) ?? "";
      const storedView = window.localStorage.getItem(storageKey);
      if (storedView) {
        const parsed: unknown = JSON.parse(storedView);
        if (typeof parsed === "object" && parsed !== null) {
          const record = parsed as Record<string, unknown>;
          savedView = persistedViewport(record);
          if (typeof record.positions === "object" && record.positions !== null) {
            const positions = record.positions as Record<string, unknown>;
            savedPositions = Object.fromEntries(
              Object.entries(positions).flatMap(([id, point]) => {
                return isCanvasPoint(point)
                  ? [[id, positionWithinCanvas(point)]]
                  : [];
              }),
            );
          }
        }
      }
    } catch {
      // A browser storage failure should not block the interactive canvas.
    }

    const validBranchId = branches.some((branch) => branch.id === savedBranchId)
      ? savedBranchId
      : branches[0]?.id ?? "";
    const frame = window.requestAnimationFrame(() => {
      setSelectedBranchId(validBranchId);
      const nextPositions = { ...fallbackPositions, ...savedPositions, ...persistedPositions };
      const nextView = persistedView ?? savedView ?? { zoom: 1, pan: { x: 0, y: 0 } };
      nodePositionsRef.current = nextPositions;
      viewRef.current = nextView;
      setNodePositions(nextPositions);
      setView(nextView);
      setViewReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [branches, fallbackPositions, persistedLayoutSignature, persistedPositions, persistedView, workspace.id]);

  useEffect(() => {
    if (!viewReady) return;
    const frame = window.requestAnimationFrame(() => {
      setSelectedBranchId((current) => branches.some((branch) => branch.id === current) ? current : branches[0]?.id ?? "");
      setNodePositions((current) => {
        const next: Record<string, CanvasPoint> = {};
        branches.forEach((branch) => {
          const position = persistedPositions[branch.id] ?? current[branch.id] ?? fallbackPositions[branch.id];
          if (position) next[branch.id] = position;
        });
        nodePositionsRef.current = next;
        return next;
      });
      setConnectTargetId((current) => branches.some((branch) => branch.id === current && branch.id !== selectedBranchId)
        ? current
        : branches.find((branch) => branch.id !== selectedBranchId)?.id ?? "");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [branches, fallbackPositions, persistedPositions, selectedBranchId, viewReady]);

  useEffect(() => {
    if (!viewReady || layoutWorkspaceRef.current !== workspace.id) return;
    const storageKey = `${BRANCH_VIEW_STORAGE_PREFIX}${workspace.id}`;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...view, positions: nodePositions }));
      if (selectedBranchId) window.localStorage.setItem(`${storageKey}:selected`, selectedBranchId);
    } catch {
      // The branch record itself is still persisted through onChange.
    }
  }, [nodePositions, selectedBranchId, view, viewReady, workspace.id]);

  useEffect(() => {
    if (selectedBranchId === lastNotifiedBranchRef.current) return;
    lastNotifiedBranchRef.current = selectedBranchId;
    onSelectedBranchChange?.(selectedBranchId);
  }, [onSelectedBranchChange, selectedBranchId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setReparentParentId(selectedBranch?.parentBranchId ?? "");
      setEditingBranchId("");
      setEditingBranchName("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedBranch?.id, selectedBranch?.parentBranchId]);

  function notifyWorkspaceChange(nextWorkspace: ProjectWorkspace) {
    workspaceRef.current = nextWorkspace;
    onChange(nextWorkspace);
  }

  function commit(nextOperatingSystem: ProjectOperatingSystem, message?: string) {
    const latestOperatingSystem = workspaceRef.current.operatingSystem as PersistedProjectOperatingSystem;
    const latestBranches = new Map(latestOperatingSystem.branches.map((branch) => [branch.id, branch]));
    const reconciledOperatingSystem: PersistedProjectOperatingSystem = {
      ...nextOperatingSystem,
      branches: nextOperatingSystem.branches.map((branch) => {
        const latestBranch = latestBranches.get(branch.id);
        return latestBranch && isCanvasPoint(latestBranch.canvasPosition)
          ? { ...branch, canvasPosition: latestBranch.canvasPosition }
          : branch;
      }),
      ...(latestOperatingSystem.viewport ? { viewport: latestOperatingSystem.viewport } : {}),
      ...(latestOperatingSystem.canvasViewport ? { canvasViewport: latestOperatingSystem.canvasViewport } : {}),
    };
    notifyWorkspaceChange({ ...workspaceRef.current, operatingSystem: reconciledOperatingSystem, updatedAt: timestamp() });
    if (message) setNotice(message);
  }

  function selectBranch(branchId: string) {
    if (branchId && !branches.some((branch) => branch.id === branchId)) return;
    setSelectedBranchId(branchId);
    setBranchChatError(null);
    setBranchChatNotice(null);
  }

  function setViewAndPersist(nextView: CanvasView, message?: string) {
    const normalizedView: CanvasView = {
      zoom: clamp(nextView.zoom, MIN_ZOOM, MAX_ZOOM),
      pan: {
        x: clamp(nextView.pan.x, -PAN_LIMIT, PAN_LIMIT),
        y: clamp(nextView.pan.y, -PAN_LIMIT, PAN_LIMIT),
      },
    };
    viewRef.current = normalizedView;
    setView(normalizedView);
    persistCanvasLayout(nodePositionsRef.current, normalizedView, message);
  }

  function persistCanvasLayout(
    positions: Record<string, CanvasPoint>,
    nextView: CanvasView,
    message?: string,
  ) {
    const currentWorkspace = workspaceRef.current;
    const currentOperatingSystem = currentWorkspace.operatingSystem as PersistedProjectOperatingSystem;
    const nextBranches = currentOperatingSystem.branches.map((branch) => {
      const nextPosition = positions[branch.id];
      if (!nextPosition) return branch;
      const rounded = roundedPoint(positionWithinCanvas(nextPosition));
      const currentPosition = isCanvasPoint(branch.canvasPosition) ? roundedPoint(branch.canvasPosition) : null;
      if (currentPosition && currentPosition.x === rounded.x && currentPosition.y === rounded.y) return branch;
      return { ...branch, canvasPosition: rounded, updatedAt: timestamp() };
    });
    const nextOperatingSystem: PersistedProjectOperatingSystem = {
      ...currentOperatingSystem,
      branches: nextBranches,
      viewport: {
        zoom: clamp(nextView.zoom, MIN_ZOOM, MAX_ZOOM),
        pan: {
          x: clamp(nextView.pan.x, -PAN_LIMIT, PAN_LIMIT),
          y: clamp(nextView.pan.y, -PAN_LIMIT, PAN_LIMIT),
        },
      },
      canvasViewport: {
        zoom: clamp(nextView.zoom, MIN_ZOOM, MAX_ZOOM),
        pan: {
          x: clamp(nextView.pan.x, -PAN_LIMIT, PAN_LIMIT),
          y: clamp(nextView.pan.y, -PAN_LIMIT, PAN_LIMIT),
        },
      },
    };
    notifyWorkspaceChange({ ...currentWorkspace, operatingSystem: nextOperatingSystem, updatedAt: timestamp() });
    if (message) setNotice(message);
  }

  function eventPoint(event: { clientX: number; clientY: number }): CanvasPoint {
    const point = canvasPoint(event);
    return {
      x: (point.x - viewRef.current.pan.x) / viewRef.current.zoom,
      y: (point.y - viewRef.current.pan.y) / viewRef.current.zoom,
    };
  }

  function canvasPoint(event: { clientX: number; clientY: number }): CanvasPoint {
    const svg = canvasRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * CANVAS_WIDTH;
    const canvasY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * CANVAS_HEIGHT;
    return {
      x: canvasX,
      y: canvasY,
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const point = canvasPoint(event);
    dragRef.current = { kind: "pan", start: point, origin: viewRef.current.pan };
    didDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleNodePointerDown(event: ReactPointerEvent<SVGGElement>, branchId: string) {
    event.stopPropagation();
    if (connectorMode || event.button !== 0) return;
    const point = eventPoint(event);
    const origin = nodePositionsRef.current[branchId] ?? fallbackPositions[branchId];
    if (!origin) return;
    dragRef.current = { kind: "node", branchId, start: point, origin };
    didDragRef.current = false;
    canvasRef.current?.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = drag.kind === "pan" ? canvasPoint(event) : eventPoint(event);
    const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
    if (Math.abs(delta.x) + Math.abs(delta.y) > 4) didDragRef.current = true;

    if (drag.kind === "node" && drag.branchId) {
      const nextPositions = {
        ...nodePositionsRef.current,
        [drag.branchId]: positionWithinCanvas({
          x: drag.origin.x + delta.x,
          y: drag.origin.y + delta.y,
        }),
      };
      nodePositionsRef.current = nextPositions;
      setNodePositions(() => nextPositions);
      return;
    }

    const nextView = {
      ...viewRef.current,
      pan: {
        x: clamp(drag.origin.x + delta.x, -PAN_LIMIT, PAN_LIMIT),
        y: clamp(drag.origin.y + delta.y, -PAN_LIMIT, PAN_LIMIT),
      },
    };
    viewRef.current = nextView;
    setView(() => nextView);
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag?.kind === "node" && drag.branchId && didDragRef.current) {
      persistCanvasLayout(nodePositionsRef.current, viewRef.current, "Node position saved to this project view.");
    } else if (drag?.kind === "pan" && didDragRef.current) {
      persistCanvasLayout(nodePositionsRef.current, viewRef.current);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleCanvasWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const nextView = {
      ...viewRef.current,
      zoom: clamp(viewRef.current.zoom + (event.deltaY < 0 ? 0.1 : -0.1), MIN_ZOOM, MAX_ZOOM),
    };
    viewRef.current = nextView;
    setView(() => nextView);
    persistCanvasLayout(nodePositionsRef.current, nextView);
  }

  function handleNodeClick(branchId: string) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (connectorMode) {
      if (!connectorSourceId) {
        setConnectorSourceId(branchId);
        selectBranch(branchId);
        setNotice("Connection source selected. Choose another node to complete the relationship.");
        return;
      }
      if (connectorSourceId === branchId) {
        setConnectorSourceId("");
        setNotice("Connection cancelled.");
        return;
      }
      const source = branches.find((branch) => branch.id === connectorSourceId);
      const target = branches.find((branch) => branch.id === branchId);
      if (!source || !target) return;
      if (isDuplicateActiveRelationship(operatingSystem.edges, source.id, target.id, connectRelationship)) {
        setNotice("That active relationship already exists.");
        setConnectorMode(false);
        setConnectorSourceId("");
        return;
      }
      commit({
        ...operatingSystem,
        edges: connectBranches(
          operatingSystem.edges,
          source.id,
          target.id,
          connectRelationship,
          `Connected directly from the idea map as ${connectRelationship}.`,
        ),
      }, `Connected ${source.name} to ${target.name}.`);
      setConnectorMode(false);
      setConnectorSourceId("");
      selectBranch(target.id);
      return;
    }
    selectBranch(branchId);
  }

  function handleNodeKeyDown(event: ReactKeyboardEvent<SVGGElement>, branchId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleNodeClick(branchId);
    }
  }

  function toggleConnectorMode() {
    setConnectorMode((current) => !current);
    setConnectorSourceId("");
    setNotice(connectorMode ? "Connection mode closed." : "Connection mode open. Select a source node, then a target node.");
  }

  function adjustZoom(delta: number) {
    const nextView = { ...viewRef.current, zoom: clamp(viewRef.current.zoom + delta, MIN_ZOOM, MAX_ZOOM) };
    setViewAndPersist(nextView, "Viewport saved to this project view.");
  }

  function resetCanvasView() {
    setViewAndPersist({ zoom: 1, pan: { x: 0, y: 0 } }, "Viewport reset and saved.");
  }

  function fitCanvasToView() {
    const points = [
      { x: rootPosition.x, y: rootPosition.y, width: ROOT_WIDTH, height: ROOT_HEIGHT },
      ...branches.map((branch) => {
        const position = nodePositionsRef.current[branch.id] ?? fallbackPositions[branch.id] ?? { x: 0, y: 0 };
        return { x: position.x, y: position.y, width: NODE_WIDTH, height: NODE_HEIGHT };
      }),
    ];
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x + point.width));
    const maxY = Math.max(...points.map((point) => point.y + point.height));
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const zoom = clamp(Math.min((CANVAS_WIDTH - 70) / width, (CANVAS_HEIGHT - 70) / height), MIN_ZOOM, MAX_ZOOM);
    setViewAndPersist({
      zoom,
      pan: {
        x: CANVAS_WIDTH / 2 - ((minX + maxX) / 2) * zoom,
        y: CANVAS_HEIGHT / 2 - ((minY + maxY) / 2) * zoom,
      },
    }, "Fit to view saved.");
  }

  function centerOnSelection() {
    const position = selectedBranch
      ? (nodePositionsRef.current[selectedBranch.id] ?? fallbackPositions[selectedBranch.id])
      : { x: rootPosition.x + (ROOT_WIDTH - NODE_WIDTH) / 2, y: rootPosition.y };
    if (!position) return;
    const width = selectedBranch ? NODE_WIDTH : ROOT_WIDTH;
    const height = selectedBranch ? NODE_HEIGHT : ROOT_HEIGHT;
    setViewAndPersist({
      ...viewRef.current,
      pan: {
        x: CANVAS_WIDTH / 2 - (position.x + width / 2) * viewRef.current.zoom,
        y: CANVAS_HEIGHT / 2 - (position.y + height / 2) * viewRef.current.zoom,
      },
    }, selectedBranch ? `${selectedBranch.name} centered and saved.` : "Project root centered and saved.");
  }

  function selectProjectRoot() {
    selectBranch("");
    setViewAndPersist({
      ...viewRef.current,
      pan: {
        x: CANVAS_WIDTH / 2 - (rootPosition.x + ROOT_WIDTH / 2) * viewRef.current.zoom,
        y: CANVAS_HEIGHT / 2 - (rootPosition.y + ROOT_HEIGHT / 2) * viewRef.current.zoom,
      },
    }, "Project root selected and centered.");
  }

  function handleAddBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newBranchName.trim()) return;
    const parentBranchId = newBranchParentId.trim() || undefined;
    const nextBranches = addBranch(branches, {
      workspaceId: workspace.id,
      name: newBranchName,
      template: "development-architecture",
      provenance: "user",
      approvalStatus: "pending",
      parentBranchId,
      timestamp: timestamp(),
    });
    const nextBranch = nextBranches[nextBranches.length - 1];
    commit({ ...operatingSystem, branches: nextBranches }, parentBranchId
      ? `Nested branch added under ${branches.find((branch) => branch.id === parentBranchId)?.name ?? "the selected branch"}.`
      : "Branch added as a reviewable project record.");
    selectBranch(nextBranch.id);
    setNewBranchName("");
    setNewBranchParentId("");
  }

  function beginRenameSelectedBranch() {
    if (!selectedBranch) return;
    setEditingBranchId(selectedBranch.id);
    setEditingBranchName(selectedBranch.name);
  }

  function cancelRename() {
    setEditingBranchId("");
    setEditingBranchName("");
  }

  function saveBranchRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch || editingBranchId !== selectedBranch.id) return;
    const name = editingBranchName.trim();
    if (!name) {
      setNotice("A branch name is required.");
      return;
    }
    commit({
      ...operatingSystem,
      branches: branches.map((branch) => branch.id === selectedBranch.id ? { ...branch, name, updatedAt: timestamp() } : branch),
    }, "Branch renamed.");
    cancelRename();
  }

  function moveSelectedBranch() {
    if (!selectedBranch) return;
    const descendants = descendantIds(branches, selectedBranch.id);
    if (reparentParentId === selectedBranch.id || descendants.has(reparentParentId)) {
      setNotice("A branch cannot be moved under itself or one of its descendants.");
      return;
    }
    if ((selectedBranch.parentBranchId ?? "") === reparentParentId) return;
    const parent = reparentParentId ? branches.find((branch) => branch.id === reparentParentId) : undefined;
    commit({
      ...operatingSystem,
      branches: branches.map((branch) => branch.id === selectedBranch.id
        ? { ...branch, ...(parent ? { parentBranchId: parent.id } : { parentBranchId: undefined }), updatedAt: timestamp() }
        : branch),
    }, parent ? `Moved ${selectedBranch.name} under ${parent.name}.` : `${selectedBranch.name} moved to the project root.`);
  }

  function deleteSelectedBranch() {
    if (!selectedBranch) return;
    const descendants = descendantIds(branches, selectedBranch.id);
    const treeIds = new Set([selectedBranch.id, ...descendants]);
    const hasDescendants = descendants.size > 0;
    const hasAttachedWork = branches.some((branch) => treeIds.has(branch.id) && hasAttachedBranchWork(operatingSystem, branch));
    const archiveInstead = hasDescendants || hasAttachedWork;
    const confirmation = archiveInstead
      ? `This branch ${hasDescendants ? "has nested branches" : "contains attached work"}. Archive ${hasDescendants ? "the complete branch tree" : "this branch"} instead of deleting its records?`
      : `Delete “${selectedBranch.name}” and its relationships? This cannot be undone.`;
    if (!window.confirm(confirmation)) return;

    if (archiveInstead) {
      commit({
        ...operatingSystem,
        branches: branches.map((branch) => treeIds.has(branch.id) ? { ...branch, status: "archived" as const, updatedAt: timestamp() } : branch),
        edges: operatingSystem.edges.map((edge) => treeIds.has(edge.fromBranchId) || treeIds.has(edge.toBranchId)
          ? { ...edge, status: "archived" as const }
          : edge),
      }, hasDescendants ? "The complete branch tree was archived safely." : "The branch was archived because it contains attached work.");
      return;
    }

    const nextParentId = selectedBranch.parentBranchId;
    const nextBranch = branches.find((branch) => branch.id === nextParentId && !treeIds.has(branch.id)) ?? branches.find((branch) => !treeIds.has(branch.id));
    commit({
      ...operatingSystem,
      branches: branches.filter((branch) => !treeIds.has(branch.id)),
      edges: operatingSystem.edges.filter((edge) => !treeIds.has(edge.fromBranchId) && !treeIds.has(edge.toBranchId)),
    }, "Branch deleted; unrelated project records were preserved.");
    selectBranch(nextBranch?.id ?? "");
  }

  function archiveSelectedBranch() {
    if (!selectedBranch) return;
    const archiving = selectedBranch.status === "active";
    const treeIds = new Set([selectedBranch.id, ...(archiving ? descendantIds(branches, selectedBranch.id) : [])]);
    commit({
      ...operatingSystem,
      branches: branches.map((branch) => treeIds.has(branch.id) ? { ...branch, status: archiving ? "archived" as const : "active" as const, updatedAt: timestamp() } : branch),
      ...(archiving ? {
        edges: operatingSystem.edges.map((edge) => treeIds.has(edge.fromBranchId) || treeIds.has(edge.toBranchId)
          ? { ...edge, status: "archived" as const }
          : edge),
      } : {}),
    }, archiving
      ? (treeIds.size > 1 ? "The selected branch tree was archived; its records remain available." : "Branch archived; its records remain available.")
      : "Branch reopened.");
  }

  function connectSelectedBranch() {
    if (!selectedBranch || !connectTargetId || connectTargetId === selectedBranch.id) {
      if (selectedBranch && connectTargetId === selectedBranch.id) setNotice("A branch cannot be connected to itself.");
      return;
    }
    const target = branches.find((branch) => branch.id === connectTargetId);
    if (!target) return;
    if (isDuplicateActiveRelationship(operatingSystem.edges, selectedBranch.id, target.id, connectRelationship)) {
      setNotice("That active relationship already exists.");
      return;
    }
    commit({
      ...operatingSystem,
      edges: connectBranches(
        operatingSystem.edges,
        selectedBranch.id,
        target.id,
        connectRelationship,
        `Connected from the project idea map as ${connectRelationship}.`,
      ),
    }, `Connected ${selectedBranch.name} to ${target.name}.`);
  }

  function updateRelationship(edgeId: string, relationship: BranchEdgeRelationship) {
    const edge = operatingSystem.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || edge.status !== "active") return;
    if (isDuplicateActiveRelationship(operatingSystem.edges, edge.fromBranchId, edge.toBranchId, relationship, edgeId)) {
      setNotice("That active relationship already exists, so the label was not changed.");
      return;
    }
    commit({
      ...operatingSystem,
      edges: operatingSystem.edges.map((candidate) => candidate.id === edgeId ? { ...candidate, relationship } : candidate),
    }, "Relationship label updated.");
  }

  function deleteRelationship(edgeId: string) {
    const edge = operatingSystem.edges.find((candidate) => candidate.id === edgeId);
    if (!edge || edge.status !== "active") return;
    const from = branches.find((branch) => branch.id === edge.fromBranchId)?.name ?? "branch";
    const to = branches.find((branch) => branch.id === edge.toBranchId)?.name ?? "branch";
    if (!window.confirm(`Delete the relationship from ${from} to ${to}?`)) return;
    commit({
      ...operatingSystem,
      edges: operatingSystem.edges.map((candidate) => candidate.id === edgeId ? { ...candidate, status: "archived" as const } : candidate),
    }, "Relationship deleted from the active idea map.");
  }

  async function sendBranchMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch || !branchMessageDraft.trim() || branchChatSending) return;

    const content = branchMessageDraft.trim();
    const requestWorkspace = workspaceRef.current;
    const requestWorkspaceId = requestWorkspace.id;
    const requestBranchId = selectedBranch.id;
    const requestBranchName = selectedBranch.name;
    const requestBranchCreatedAt = selectedBranch.createdAt;
    const requestToken = createStableId("branch-chat-request");
    const userMessage = branchMessage("user", content);
    const workspaceWithUserMessage = appendBranchMessage(requestWorkspace, requestBranchId, userMessage);
    branchChatRequestRef.current = requestToken;
    setBranchChatSending(true);
    setBranchChatError(null);
    setBranchChatNotice(null);
    if (!serverBacked) notifyWorkspaceChange(workspaceWithUserMessage);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverBacked
          ? { projectId, branchId: requestBranchId, message: content, messageId: userMessage.id }
          : { workspace: workspaceWithUserMessage, branchId: requestBranchId, message: content, messageId: userMessage.id }),
      });
      const payload = responsePayload(await response.json());
      if (!response.ok || typeof payload.content !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "The branch chat service returned an invalid response.");
      }

      const responseSource: WorkspaceMessage["source"] = payload.source === "model-assisted"
        ? "model-assisted"
        : payload.source === "web-researched"
          ? "web-researched"
          : "deterministic-fallback";
      const citations = readCitations(payload.citations);
      const assistantMessage = branchMessage("assistant", payload.content as string, responseSource, citations);
      const latestWorkspace = workspaceRef.current;
      if (latestWorkspace.id !== requestWorkspaceId) {
        setBranchChatNotice(`${requestBranchName} response arrived after navigation and was discarded.`);
        setBranchMessageDraft("");
        return;
      }
      const latestRequestBranch = latestWorkspace.operatingSystem?.branches.find(
        (branch) => branch.id === requestBranchId,
      );
      if (!latestRequestBranch || latestRequestBranch.createdAt !== requestBranchCreatedAt) {
        setBranchChatNotice(`${requestBranchName} was removed while its response was pending; the delayed response was discarded.`);
        setBranchMessageDraft("");
        return;
      }
      const responseWorkspace = serverBacked && typeof payload.workspace === "object" && payload.workspace !== null
        ? payload.workspace as ProjectWorkspace
        : null;
      const responseUpdatedAt = responseWorkspace ? Date.parse(responseWorkspace.updatedAt) : 0;
      const latestUpdatedAt = Date.parse(latestWorkspace.updatedAt);
      const baseWorkspace = responseWorkspace && Number.isFinite(responseUpdatedAt) && responseUpdatedAt >= latestUpdatedAt
        ? responseWorkspace
        : latestWorkspace;
      let nextWorkspace = appendBranchMessageIfMissing(baseWorkspace, requestBranchId, userMessage);
      const branchMessages = nextWorkspace.operatingSystem?.branches.find((branch) => branch.id === requestBranchId)?.messages ?? [];
      const userMessageIndex = branchMessages.findIndex((message) => message.id === userMessage.id);
      const responseAlreadyPresent = userMessageIndex >= 0 && branchMessages[userMessageIndex + 1]?.role === "assistant";
      if (!responseAlreadyPresent) nextWorkspace = appendBranchMessageIfMissing(nextWorkspace, requestBranchId, assistantMessage);
      if (serverBacked && typeof payload.workspace === "object" && payload.workspace !== null) {
        notifyWorkspaceChange(nextWorkspace);
        if (typeof payload.notice === "string" && payload.notice) setBranchChatNotice(payload.notice);
      } else {
        const sourceNotes = [
          typeof payload.notice === "string" && payload.notice ? `Source note: ${payload.notice}` : "",
          serverBacked ? "Persistence note: the server response did not include an updated workspace, so this branch copy is cached locally." : "",
        ].filter(Boolean);
        const sourceNote = sourceNotes.length ? `\n\n${sourceNotes.join("\n")}` : "";
        if (serverBacked) setBranchChatNotice("The server returned a branch response without a persisted workspace; this copy is cached locally.");
        const localAssistant = branchMessage("assistant", `${payload.content}${sourceNote}`, responseSource, citations);
        let localWorkspace = appendBranchMessageIfMissing(latestWorkspace, requestBranchId, userMessage);
        localWorkspace = appendBranchMessageIfMissing(localWorkspace, requestBranchId, localAssistant);
        notifyWorkspaceChange(localWorkspace);
      }
      if (selectedBranchIdRef.current !== requestBranchId) {
        setBranchChatNotice(`${requestBranchName} response saved to its captured branch. The current selection was not changed.`);
      }
      setBranchMessageDraft("");
    } catch (error) {
      if (workspaceRef.current.id !== requestWorkspaceId) {
        setBranchChatNotice(`${requestBranchName} response arrived after navigation and was discarded.`);
        setBranchMessageDraft("");
        return;
      }
      const latestRequestBranch = workspaceRef.current.operatingSystem?.branches.find(
        (branch) => branch.id === requestBranchId,
      );
      if (!latestRequestBranch || latestRequestBranch.createdAt !== requestBranchCreatedAt) {
        setBranchChatNotice(`${requestBranchName} was removed while its response was pending; the delayed response was discarded.`);
        setBranchMessageDraft("");
        return;
      }
      const fallback = generateDeterministicAssistantReply(workspaceWithUserMessage, content);
      const fallbackMessage = branchMessage(
        "assistant",
        `The branch chat service was unavailable, so this branch-only fallback was generated locally.\n\n${fallback.content}`,
        "deterministic-fallback",
      );
      let fallbackWorkspace = appendBranchMessageIfMissing(workspaceRef.current, requestBranchId, userMessage);
      fallbackWorkspace = appendBranchMessageIfMissing(fallbackWorkspace, requestBranchId, fallbackMessage);
      notifyWorkspaceChange(fallbackWorkspace);
      setBranchChatError(error instanceof Error ? `${error.message} Local branch fallback used.` : "The branch chat service was unavailable. Local branch fallback used.");
      if (selectedBranchIdRef.current !== requestBranchId) {
        setBranchChatNotice(`${requestBranchName} response saved to its captured branch. The current selection was not changed.`);
      }
      setBranchMessageDraft("");
    } finally {
      if (branchChatRequestRef.current === requestToken) {
        branchChatRequestRef.current = null;
        setBranchChatSending(false);
      }
    }
  }

  function answerDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstQuestion || !discoveryDraft.trim()) return;
    const answer = createDiscoveryAnswer(firstQuestion, discoveryDraft);
    const nextQuestions = operatingSystem.discoveryQuestions.map((question) => question.id === firstQuestion.id ? { ...question, status: "answered" as const } : question);
    commit({
      ...operatingSystem,
      discoveryQuestions: nextQuestions,
      discoveryAnswers: [...operatingSystem.discoveryAnswers, answer],
    }, "Discovery answer recorded as a user-provided fact for review.");
    setDiscoveryDraft("");
  }

  function skipDiscovery() {
    if (!firstQuestion) return;
    commit({
      ...operatingSystem,
      discoveryQuestions: operatingSystem.discoveryQuestions.map((question) => question.id === firstQuestion.id ? { ...question, status: "skipped" as const } : question),
    }, "Discovery question skipped; it can be revisited after a brief change.");
    setDiscoveryDraft("");
  }

  function generateTasks() {
    const buildBranch = branches.find((branch) => branch.template === "development-architecture") ?? branches[0];
    if (!buildBranch) return;
    const drafts = createTaskDrafts(workspace.plan, {
      branchId: buildBranch.id,
      existingTasks: operatingSystem.tasks,
      approvalStatus: "pending",
      timestamp: timestamp(),
    });
    commit({
      ...operatingSystem,
      tasks: [...operatingSystem.tasks, ...drafts],
      branches: branches.map((branch) => branch.id === buildBranch.id ? { ...branch, taskIds: [...branch.taskIds, ...drafts.map((task) => task.id)] } : branch),
    }, drafts.length ? `${drafts.length} task drafts prepared for approval.` : "No duplicate task drafts were created.");
  }

  function setTaskStatus(taskId: string, status: "draft" | "ready" | "in-progress" | "blocked" | "done" | "cancelled") {
    const result = updateTaskStatus(operatingSystem.tasks, taskId, status);
    commit({ ...operatingSystem, tasks: result.tasks }, result.reason);
  }

  function runAutomation(automationId: string) {
    const automation = operatingSystem.automations.find((item) => item.id === automationId) ?? getSafeAutomationTemplates().find((item) => item.id === automationId);
    if (!automation) return;
    const run = createManualAutomationRun(automation, ["No external side effect was requested.", "Any generated draft remains pending approval."]);
    commit({ ...operatingSystem, automationRuns: [...operatingSystem.automationRuns, run] }, run.summary);
  }

  const rootPosition = { x: (CANVAS_WIDTH - ROOT_WIDTH) / 2, y: 22 };
  const branchPosition = (branchId: string) => nodePositions[branchId] ?? fallbackPositions[branchId] ?? { x: 30, y: 150 };
  const structuralEdges = branches.flatMap((branch) => {
    const parent = branch.parentBranchId ? branches.find((candidate) => candidate.id === branch.parentBranchId) : undefined;
    return [{ branch, parent }];
  });
  const breadcrumbBranches: ProjectBranch[] = [];
  const breadcrumbSeen = new Set<string>();
  let breadcrumbBranch = selectedBranch;
  while (breadcrumbBranch && !breadcrumbSeen.has(breadcrumbBranch.id)) {
    breadcrumbSeen.add(breadcrumbBranch.id);
    breadcrumbBranches.unshift(breadcrumbBranch);
    breadcrumbBranch = breadcrumbBranch.parentBranchId
      ? branches.find((branch) => branch.id === breadcrumbBranch?.parentBranchId)
      : undefined;
  }
  const reparentOptions = selectedBranch
    ? branches.filter((branch) => branch.id !== selectedBranch.id && !descendantIds(branches, selectedBranch.id).has(branch.id))
    : [];

  return (
    <section
      className={`workspace-os-panel workspace-os-panel-${presentation}`}
      data-presentation={presentation}
      aria-labelledby="operating-system-title"
    >
      <div className="workspace-panel-heading">
        <div>
          <p className="eyebrow">{presentation === "connection" ? "Node connection" : "Idea operating system"}</p>
          <h2 id="operating-system-title">{presentation === "connection" ? "Connect the ideas that move this project forward." : "Branches, decisions, and execution."}</h2>
        </div>
        <span className="memory-version">Local record · reviewable</span>
      </div>
      {notice ? <p className="workspace-os-notice" role="status">{notice}</p> : null}
      {operatingSystem.branchImpactSuggestions?.some((suggestion) => suggestion.impact !== "low") ? (
        <section className="os-impact-strip" aria-labelledby="branch-impact-title">
          <div className="os-section-heading"><div><h3 id="branch-impact-title">Change impact review</h3><p>A brief change can affect multiple branches. These are deterministic suggestions, not silent updates.</p></div><span>approval required</span></div>
          <div className="impact-list">{operatingSystem.branchImpactSuggestions.filter((suggestion) => suggestion.impact !== "low").map((suggestion) => <div className={`impact-item impact-${suggestion.impact}`} key={suggestion.branchId}><strong>{suggestion.branchName}</strong><span>{suggestion.impact}</span><p>{suggestion.reason} {suggestion.suggestedAction}</p></div>)}</div>
        </section>
      ) : null}

      <div className="os-grid">
        <section className="os-canvas-section" aria-labelledby="branch-map-title">
          <div className="os-section-heading"><div><h3 id="branch-map-title">{presentation === "connection" ? "Node connection map" : "Idea map"}</h3><p>{presentation === "connection" ? "Review explicit dependencies and relationships, then connect nodes directly in the map." : "Drag nodes to arrange the view, use the controls to zoom, and connect branches directly in the map."}</p></div><span>{branches.filter((branch) => branch.status === "active").length} active branches</span></div>
          <nav className="branch-breadcrumbs" aria-label="Branch location">
            <button type="button" className={!selectedBranch ? "is-current" : ""} onClick={selectProjectRoot} aria-current={!selectedBranch ? "page" : undefined}>Project</button>
            {breadcrumbBranches.map((branch, index) => (
              <span className="branch-breadcrumb-item" key={branch.id}>
                <span aria-hidden="true">›</span>
                <button type="button" className={index === breadcrumbBranches.length - 1 ? "is-current" : ""} onClick={() => selectBranch(branch.id)} aria-current={index === breadcrumbBranches.length - 1 ? "page" : undefined}>{branch.name}</button>
              </span>
            ))}
          </nav>
          <div className={`branch-canvas-shell${connectorMode ? " is-connecting" : ""}`}>
            <svg
              ref={canvasRef}
              className="branch-canvas"
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
              preserveAspectRatio="none"
              role="application"
              aria-label="Interactive project branch idea map"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
              onWheel={handleCanvasWheel}
            >
              <defs>
                <marker id="branch-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor" />
                </marker>
                <marker id="branch-arrow-related" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#ff5148" />
                </marker>
              </defs>
              <rect className="branch-canvas-hit-area" x="0" y="0" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
              <g transform={`translate(${view.pan.x} ${view.pan.y}) scale(${view.zoom})`}>
                {structuralEdges.map(({ branch, parent }) => {
                  const from = parent ? branchPosition(parent.id) : rootPosition;
                  const to = branchPosition(branch.id);
                  return (
                    <path
                      className="branch-canvas-edge branch-canvas-structural-edge"
                      d={parent ? edgePath(from, to) : edgePath({ x: rootPosition.x + (ROOT_WIDTH - NODE_WIDTH) / 2, y: rootPosition.y }, to, ROOT_HEIGHT)}
                      key={`structure-${branch.id}`}
                      markerEnd="url(#branch-arrow)"
                    />
                  );
                })}
                {activeRelationshipEdges.map((edge) => {
                  const from = branchPosition(edge.fromBranchId);
                  const to = branchPosition(edge.toBranchId);
                  if (!branches.some((branch) => branch.id === edge.fromBranchId) || !branches.some((branch) => branch.id === edge.toBranchId)) return null;
                  return (
                    <g key={edge.id} className="branch-canvas-relationship">
                      <path className="branch-canvas-edge" d={edgePath(from, to)} markerEnd="url(#branch-arrow-related)" />
                      <text className="branch-canvas-edge-label" x={(from.x + to.x) / 2 + NODE_WIDTH / 2} y={(from.y + to.y) / 2 + NODE_HEIGHT / 2}>{edge.relationship.replaceAll("-", " ")}</text>
                    </g>
                  );
                })}
                <g className="branch-canvas-root" transform={`translate(${rootPosition.x} ${rootPosition.y})`} role="img" aria-label={`${workspace.name} project root`}>
                  <rect width={ROOT_WIDTH} height={ROOT_HEIGHT} rx="14" />
                  <text className="branch-canvas-node-index" x="18" y="23">PROJECT ROOT</text>
                  <text className="branch-canvas-node-title" x="18" y="45">{workspace.name.slice(0, 34)}</text>
                  <text className="branch-canvas-node-meta" x="18" y="63">Shared project context</text>
                </g>
                {branches.map((branch) => {
                  const position = branchPosition(branch.id);
                  const isSelected = selectedBranch?.id === branch.id;
                  const isConnectorSource = connectorSourceId === branch.id;
                  return (
                    <g
                      className={`branch-canvas-node${isSelected ? " is-selected" : ""}${branch.status === "archived" ? " is-archived" : ""}${isConnectorSource ? " is-connector-source" : ""}`}
                      key={branch.id}
                      transform={`translate(${position.x} ${position.y})`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${branch.name} branch${isSelected ? ", selected" : ""}`}
                      onPointerDown={(event) => handleNodePointerDown(event, branch.id)}
                      onClick={() => handleNodeClick(branch.id)}
                      onKeyDown={(event) => handleNodeKeyDown(event, branch.id)}
                    >
                      <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="11" />
                      <rect className="branch-canvas-node-accent" width="4" height={NODE_HEIGHT} rx="2" />
                      <text className="branch-canvas-node-index" x="16" y="21">{branch.template.replaceAll("-", " ")}</text>
                      <text className="branch-canvas-node-title" x="16" y="43">{branch.name.slice(0, 30)}</text>
                      <text className="branch-canvas-node-meta" x="16" y="63">{branch.taskIds.length} tasks · {branch.messages.length} messages</text>
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="branch-canvas-controls" aria-label="Idea map controls">
              <span>{connectorMode ? (connectorSourceId ? "Choose a target node" : "Choose a source node") : "Drag the canvas to pan"}</span>
              <div>
                <button className="button button-ghost button-small" type="button" onClick={() => adjustZoom(-0.1)} aria-label="Zoom out">−</button>
                <strong>{Math.round(view.zoom * 100)}%</strong>
                <button className="button button-ghost button-small" type="button" onClick={() => adjustZoom(0.1)} aria-label="Zoom in">+</button>
                <button className="button button-ghost button-small" type="button" onClick={fitCanvasToView}>Fit to view</button>
                <button className="button button-ghost button-small" type="button" onClick={centerOnSelection}>Center selection</button>
                <button className="button button-ghost button-small" type="button" onClick={resetCanvasView}>Reset</button>
              </div>
            </div>
          </div>
          <div className="branch-map-tools">
            <button className={`button button-secondary button-small${connectorMode ? " is-active" : ""}`} type="button" onClick={toggleConnectorMode}>{connectorMode ? "Cancel connection" : "Connect nodes"}</button>
            <label><span>Relationship</span><select value={connectRelationship} onChange={(event) => setConnectRelationship(event.target.value as BranchEdgeRelationship)}><option value="related-to">Related to</option><option value="depends-on">Depends on</option><option value="informs">Informs</option><option value="blocks">Blocks</option></select></label>
             <span className="branch-map-edge-count">{activeRelationshipEdges.length} explicit relationships · {branches.filter((branch) => branch.parentBranchId).length} nested links</span>
           </div>
           <section className="branch-relationship-panel" aria-labelledby="relationship-list-title">
             <div className="branch-relationship-heading"><div><h4 id="relationship-list-title">Active relationships</h4><p>{selectedBranch ? `Relationships touching ${selectedBranch.name}.` : "Relationships across the visible project branches."}</p></div><label><span className="sr-only">Relationship scope</span><select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value as RelationshipFilter)}><option value="selected">Selected branch</option><option value="all">All visible branches</option></select></label></div>
             {displayedRelationshipEdges.length ? <div className="branch-relationship-list">{displayedRelationshipEdges.map((edge) => {
               const from = branches.find((branch) => branch.id === edge.fromBranchId);
               const to = branches.find((branch) => branch.id === edge.toBranchId);
               if (!from || !to) return null;
               return <div className="branch-relationship-item" key={edge.id}><span className="branch-relationship-route"><strong>{from.name}</strong><span aria-hidden="true">→</span><strong>{to.name}</strong></span><label><span className="sr-only">Relationship label for {from.name} to {to.name}</span><select value={edge.relationship} onChange={(event) => updateRelationship(edge.id, event.target.value as BranchEdgeRelationship)}><option value="related-to">Related to</option><option value="depends-on">Depends on</option><option value="informs">Informs</option><option value="blocks">Blocks</option></select></label><button className="button button-ghost button-small" type="button" onClick={() => deleteRelationship(edge.id)}>Delete</button></div>;
             })}</div> : <p className="os-empty-state">No active relationships match this view. Connect two different branches to add one.</p>}
           </section>
           <div className="os-controls">
            <form onSubmit={handleAddBranch} className="inline-add-form"><label className="sr-only" htmlFor="new-branch-name">New branch name</label><input id="new-branch-name" value={newBranchName} maxLength={100} placeholder="Add a custom branch" onChange={(event) => setNewBranchName(event.target.value)} /><label className="sr-only" htmlFor="new-branch-parent">Parent branch</label><select id="new-branch-parent" value={newBranchParentId} onChange={(event) => setNewBranchParentId(event.target.value)}><option value="">At project root</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>Under {branch.name}</option>)}</select><button className="button button-secondary button-small" type="submit" disabled={!newBranchName.trim()}>Add branch</button></form>
             {selectedBranch && editingBranchId === selectedBranch.id ? <form className="selected-branch-actions branch-edit-form" onSubmit={saveBranchRename}><label className="sr-only" htmlFor="edit-branch-name">Branch name</label><input id="edit-branch-name" value={editingBranchName} maxLength={100} onChange={(event) => setEditingBranchName(event.target.value)} /><button className="button button-secondary button-small" type="submit" disabled={!editingBranchName.trim()}>Save name</button><button className="button button-ghost button-small" type="button" onClick={cancelRename}>Cancel</button></form> : <div className="selected-branch-actions"><span>{selectedBranch ? `Selected: ${selectedBranch.name}` : "Select a branch"}</span><button className="button button-ghost button-small" type="button" onClick={beginRenameSelectedBranch} disabled={!selectedBranch}>Edit name</button><button className="button button-ghost button-small" type="button" onClick={archiveSelectedBranch} disabled={!selectedBranch}>{selectedBranch?.status === "archived" ? "Reopen" : "Archive"}</button><button className="button button-ghost button-small" type="button" onClick={deleteSelectedBranch} disabled={!selectedBranch}>Delete</button></div>}
             <div className="selected-branch-actions branch-reparent-form"><label htmlFor="reparent-branch">Move selected branch</label><select id="reparent-branch" value={reparentParentId} onChange={(event) => setReparentParentId(event.target.value)} disabled={!selectedBranch}><option value="">At project root</option>{reparentOptions.map((branch) => <option value={branch.id} key={branch.id}>Under {branch.name}</option>)}</select><button className="button button-secondary button-small" type="button" onClick={moveSelectedBranch} disabled={!selectedBranch || (selectedBranch.parentBranchId ?? "") === reparentParentId}>Move branch</button></div>
             <div className="selected-branch-actions"><label className="sr-only" htmlFor="connect-branch">Connect to branch</label><select id="connect-branch" value={connectTargetId} onChange={(event) => setConnectTargetId(event.target.value)}><option value="">Connect to…</option>{branches.filter((branch) => branch.id !== selectedBranch?.id).map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><button className="button button-secondary button-small" type="button" onClick={connectSelectedBranch} disabled={!selectedBranch || !connectTargetId}>Connect branches</button></div>
          </div>
        </section>

        <section className="os-discovery-section" aria-labelledby="discovery-title" hidden={presentation === "connection"}>
          <div className="os-section-heading"><div><h3 id="discovery-title">Progressive discovery</h3><p>One question at a time; supplied brief fields are skipped.</p></div><span>{operatingSystem.discoveryAnswers.length} answers</span></div>
          {firstQuestion ? <form className="discovery-question-card" onSubmit={answerDiscovery}><span className="discovery-question-number">Next question</span><strong>{firstQuestion.prompt}</strong><p>{firstQuestion.rationale}</p><textarea value={discoveryDraft} rows={3} maxLength={1000} placeholder="Answer, or leave it until you are ready…" onChange={(event) => setDiscoveryDraft(event.target.value)} /><div><button className="button button-primary button-small" type="submit" disabled={!discoveryDraft.trim()}>Record answer</button><button className="button button-ghost button-small" type="button" onClick={skipDiscovery}>Skip for now</button></div></form> : <p className="os-empty-state">The current discovery questions are answered or skipped. You can revisit them after changing the brief.</p>}
        </section>
      </div>

      <section className="os-branch-chat" aria-labelledby="branch-chat-title" hidden={presentation === "connection"}>
        <div className="os-section-heading"><div><h3 id="branch-chat-title">{selectedBranch?.name ?? "Branch"} conversation</h3><p>Branch chat keeps its own messages while inheriting the shared project idea. It never appears in the main project conversation.</p></div><span>{selectedBranch?.approvalStatus ?? "pending"} review</span></div>
        {branchChatNotice ? <p className="branch-chat-notice" role="status">{branchChatNotice}</p> : null}
        {branchChatError ? <p className="workspace-inline-error branch-chat-error" role="alert">{branchChatError}</p> : null}
        <div className="branch-chat-history" aria-live="polite">
          {selectedBranch?.messages.slice(-8).map((message) => <article className={`branch-chat-message ${message.role}`} key={message.id}><small>{branchSourceLabel(message)}</small><p>{message.content}</p>{message.citations?.length ? <div className="branch-message-citations">{message.citations.map((citation) => <a href={citation.url} target="_blank" rel="noreferrer" key={`${message.id}-${citation.url}`}>{citation.title} <span aria-hidden="true">↗</span></a>)}</div> : null}</article>)}
        </div>
        <form className="branch-chat-composer" onSubmit={sendBranchMessage}><label className="sr-only" htmlFor="branch-message">Message this branch</label><textarea id="branch-message" rows={2} value={branchMessageDraft} maxLength={2000} placeholder="Ask a question specific to this branch…" onChange={(event) => setBranchMessageDraft(event.target.value)} disabled={branchChatSending} /><button className="button button-secondary button-small" type="submit" disabled={branchChatSending || !branchMessageDraft.trim()}>{branchChatSending ? "Checking branch…" : "Send to branch"} {!branchChatSending ? <span aria-hidden="true">↗</span> : null}</button></form>
      </section>

      <section className="os-execution-section" aria-labelledby="execution-title" hidden={presentation === "connection"}>
        <div className="os-section-heading"><div><h3 id="execution-title">Execution command center</h3><p>Generated work starts as drafts. Status changes are real records, not assistant claims.</p></div><button className="button button-secondary button-small" type="button" onClick={generateTasks}>Draft tasks from plan</button></div>
        <div className="task-toolbar"><label htmlFor="task-filter">Show <select id="task-filter" value={taskFilter} onChange={(event) => setTaskFilter(event.target.value as typeof taskFilter)}><option value="all">all</option><option value="draft">draft</option><option value="in-progress">in progress</option><option value="blocked">blocked</option><option value="done">done</option></select></label><span>{operatingSystem.tasks.filter((task) => task.status === "done").length}/{operatingSystem.tasks.length} done</span></div>
        <div className="task-list">{visibleTasks.length ? visibleTasks.map((task) => <article className="task-card" key={task.id}><div><span className={`task-status task-status-${task.status}`}>{task.status}</span><h4>{task.title}</h4><p>{task.description}</p><small>{task.approvalStatus} approval · {task.acceptanceCriteria[0]}</small></div><select aria-label={`Update ${task.title} status`} value={task.status} onChange={(event) => setTaskStatus(task.id, event.target.value as typeof task.status)}><option value="draft">Draft</option><option value="ready">Ready</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></article>) : <p className="os-empty-state">No tasks match this filter.</p>}</div>
      </section>

      <section className="os-automation-section" aria-labelledby="automation-title" hidden={presentation === "connection"}>
        <div className="os-section-heading"><div><h3 id="automation-title">Automation studio</h3><p>Only manual dry runs are enabled in this prototype; no scheduler is implied.</p></div><span>{operatingSystem.automationRuns.length} runs</span></div>
        <div className="automation-list">{operatingSystem.automations.map((automation) => <article className="automation-card" key={automation.id}><div><strong>{automation.name}</strong><p>{automation.description}</p><small>Manual-only · approval required for side effects</small></div><button className="button button-secondary button-small" type="button" onClick={() => runAutomation(automation.id)} disabled={automation.status !== "available"}>Run dry check</button></article>)}</div>
        {operatingSystem.automationRuns.length ? <p className="automation-run-note" role="status">Last run: {operatingSystem.automationRuns[operatingSystem.automationRuns.length - 1].summary}</p> : null}
      </section>
    </section>
  );
}
