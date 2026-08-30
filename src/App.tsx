import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  ControlButton,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import { get, set } from "idb-keyval";
import {
  AlertTriangle,
  Boxes,
  Braces,
  BookOpen,
  Cable,
  CheckCircle2,
  ChevronDown,
ExternalLink,
  FileUp,
  Github,
  Globe2,
  Keyboard,
  Mail,
  Maximize2,
  MoreHorizontal,
  Paintbrush,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Variable,
  LayoutGrid,
  ListChecks,
  Play,
  Plus,
  Redo2,
  Route,
  Search,
  Send,
  ShieldCheck,
  Shuffle,
  Settings2,
  Trash2,
  Undo2,
  WandSparkles,
  Wrench,
} from "lucide-react";
import type {
  GraphDocument,
  SimulationStep,
  StudioEdge,
  StudioNode,
  StudioProject,
  ValidationIssue,
} from "./types";
import { schema, getDefinition, portLabel } from "./domain/schema";
import { L3, L4, solveGraph } from "./domain/layerSolver";
import { pairIssuesFor, validatePair } from "./domain/pairValidator";
import {
  checkConnection,
  hasBlockingIssues,
  hasIncompleteIssues,
  validateGraph,
} from "./domain/validator";
import { recommendNext, type RankedSuggestion } from "./domain/recommender";
import { emptyProject } from "./domain/importer";
import {
  autoLayout,
  projectFromScenario,
  type Scenario,
} from "./data/scenarios";
import {
  categoryLabel,
  NODE_CATEGORIES,
  nodeCategory,
  nodeExperience,
  SIMPLE_NODE_TYPES,
} from "./data/node-experience";
import { Rocket } from "lucide-react";
import { WizardModal } from "./components/WizardModal";
import { WaterWallNode } from "./components/WaterWallNode";
import { WaterWallEdge } from "./components/WaterWallEdge";
import { GraphActions } from "./components/GraphActions";
import { Sheet } from "./components/Sheet";
import { NodePicker } from "./components/NodePicker";
import { Inspector } from "./components/Inspector";
import { IssuesPanel } from "./components/IssuesPanel";
import { Simulator } from "./components/Simulator";
import { ImportExport } from "./components/ImportExport";
import { ScenarioLibrary } from "./components/ScenarioLibrary";
import { LiveJson } from "./components/LiveJson";
import { VariablesPanel } from "./components/VariablesPanel";
import { QuickNodePicker } from "./components/QuickNodePicker";
import { CREATOR_LINKS } from "./config/social";
import meshivoLogo from "./assets/meshivo-logo.png";
import waterwallLogo from "./assets/waterwall-logo.png";

const nodeTypes = { waterwall: WaterWallNode },
  edgeTypes = { waterwall: WaterWallEdge };
type Panel =
  | "palette"
  | "inspector"
  | "issues"
  | "simulator"
  | "io"
  | "scenarios"
  | "json"
  | "variables"
  | "tools"
  | null;
type PendingAdd = {
  sourceId?: string;
  handleId?: string;
  edgeId?: string;
  anchor?: { x: number; y: number };
};
const STORAGE_KEY = "waterwall-studio-project-v1";
function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    packet: token("--packet", "#e69140"),
    stream: token("--stream", "#5596d6"),
    any: token("--any", "#9a75c9"),
    edgeActive: token("--edge-active", "#f6be75"),
    dots: token("--canvas-dots", "#4a3927"),
  };
}
const DEFAULT_THEME: ThemeId = "blanc";
/* Bumping this string re-applies DEFAULT_THEME once for everyone, including
   people who had already picked something else. */
const THEME_RESET_KEY = "ww-theme-default-blanc";
type ThemeId = "blanc" | "gold" | "slate" | "emerald" | "amethyst";
/* One list feeds the desktop swatch strip in the header tools and the mobile
   strip above it; they must never drift apart. */
const THEMES: { id: ThemeId; label: string }[] = [
  { id: "blanc", label: "سفید Blanc" },
  { id: "gold", label: "طلایی SBCV" },
  { id: "slate", label: "سرمه‌ای Slate" },
  { id: "emerald", label: "زمردی Emerald" },
  { id: "amethyst", label: "بنفش Amethyst" },
];

export default function App() {
  const [project, setProject] = useState<StudioProject>(() =>
    emptyProject(schema),
  );
  const [loaded, setLoaded] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [panel, setPanel] = useState<Panel>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(),
    [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (localStorage.getItem(THEME_RESET_KEY) !== "1") {
      localStorage.setItem(THEME_RESET_KEY, "1");
      localStorage.setItem("ww-theme", DEFAULT_THEME);
      return DEFAULT_THEME;
    }
    return (localStorage.getItem("ww-theme") as ThemeId) || DEFAULT_THEME;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ww-theme", theme);
  }, [theme]);
  /* Canvas colours reach React Flow as plain strings on SVG attributes, where
     `var(--token)` does not resolve. This effect runs after the one above, so
     the values it reads already belong to the theme just applied. */
  const [themeColors, setThemeColors] = useState(readThemeColors);
  useEffect(() => setThemeColors(readThemeColors()), [theme]);
  const [pendingAdd, setPendingAdd] = useState<PendingAdd>(),
    [message, setMessage] = useState<{
      kind: "error" | "info" | "success";
      text: string;
      technical?: string;
    }>();
  const [replace, setReplace] = useState<{
      connection: Connection;
      edge: StudioEdge;
      newNode?: StudioNode;
    }>(),
    [activeStep, setActiveStep] = useState<SimulationStep>();
  const [rejected, setRejected] = useState<{
    check: ReturnType<typeof checkConnection>;
    connection?: Connection;
  }>();
  const [confirmClear, setConfirmClear] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  // Level of detail: node body text is unreadable below ~0.55 zoom.
  const [zoomedOut, setZoomedOut] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [quickAddExpanded, setQuickAddExpanded] = useState(false);
  const history = useRef<StudioProject[]>([]),
    future = useRef<StudioProject[]>([]),
    lastConnection = useRef<Connection | undefined>(undefined),
    flow = useRef<Pick<ReactFlowInstance<StudioNode>, "fitView"> | null>(null),
    lastCheck = useRef<ReturnType<typeof checkConnection> | undefined>(
      undefined,
    );
  const graph = project.servers[project.activeServer],
    nodes = graph.nodes,
    edges = graph.edges;
  const solution = useMemo(() => solveGraph(nodes, edges), [nodes, edges]);
  // Cross-server findings are kept out of `issues` on purpose: a perfectly
  // valid Iran config has to stay simulatable while Kharej is half-built, and
  // hasBlockingIssues gates the simulator on that array.
  const pairFindings = useMemo(() => validatePair(project), [project]);
  const pairIssues = useMemo(
    () => pairIssuesFor(pairFindings, project.activeServer),
    [pairFindings, project.activeServer],
  );
  const issues = useMemo(
    () => validateGraph(nodes, edges, solution),
    [nodes, edges, solution],
  );
  // A git checkout gives a commit; a plain copy of the source falls back to a
  // content hash. Show whichever it is, short enough to compare at a glance.
  const totalIssueCount = issues.length + pairIssues.length;
  const hasErrorIssue =
    issues.some((item) => item.severity === "error") ||
    pairIssues.some((item) => item.severity === "error");
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  // A stable primitive changes only when graph membership changes, not while a
  // node is dragged. It keeps fitView reactive without making the canvas snap.
  const nodeIdsForFit = nodes.map(({ id }) => id).join("\u0000");
  const focusAddedNodes = (ids: string[]) => {
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    window.setTimeout(
      () =>
        flow.current?.fitView({
          nodes: ids.map((id) => ({ id })),
          padding: 0.22,
          minZoom: 0.68,
          maxZoom: 0.9,
          duration: 280,
        }),
      520,
    );
  };

  useEffect(() => {
    get<StudioProject>(STORAGE_KEY).then((saved) => {
      if (saved?.servers) {
        setProject(saved);
        setMessage({
          kind: "success",
          text: "آخرین پروژه از همین دستگاه بازیابی شد.",
        });
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(
      () =>
        set(STORAGE_KEY, { ...project, updatedAt: new Date().toISOString() }),
      450,
    );
    return () => window.clearTimeout(timer);
  }, [project, loaded]);
  // Toasts dismiss themselves; errors carry the fix so they linger a little
  // longer, but nothing stays on screen forever.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(
      () => setMessage(undefined),
      message.kind === "error" ? 8000 : 5000,
    );
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    // Wait for the side-column transition before measuring the canvas; fitting
    // during the 200ms grid animation leaves the final node under Inspector.
    const timer = window.setTimeout(() => {
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const compact = window.matchMedia("(max-width: 360px)").matches;
      const medium = window.matchMedia("(max-width: 1100px)").matches;
      const fitIds = nodeIdsForFit ? nodeIdsForFit.split("\u0000") : [];
      const focusNodes = compact
        ? fitIds.slice(0, 1)
        : mobile
          ? fitIds.slice(0, 2)
          : medium
            ? fitIds.slice(0, 3)
            : undefined;
      flow.current?.fitView({
        nodes: focusNodes?.map((id) => ({ id })),
        padding: compact ? 0.12 : mobile ? 0.18 : 0.2,
        duration: 280,
        maxZoom: medium ? 0.9 : 1.2,
        minZoom: compact ? 0.78 : mobile ? 0.68 : medium ? 0.55 : 0.2,
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [nodeIdsForFit, project.activeServer, leftOpen, rightOpen]);

  const snapshot = useCallback(() => {
    history.current.push(structuredClone(project));
    if (history.current.length > 60) history.current.shift();
    future.current = [];
  }, [project]);
  const updateGraph = useCallback(
    (next: GraphDocument | ((current: GraphDocument) => GraphDocument)) =>
      setProject((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        servers: {
          ...current.servers,
          [current.activeServer]:
            typeof next === "function"
              ? next(current.servers[current.activeServer])
              : next,
        },
      })),
    [],
  );
  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    future.current.push(structuredClone(project));
    setProject(previous);
  }, [project]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(structuredClone(project));
    setProject(next);
  }, [project]);

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;
      snapshot();
      const newNodeId = `${targetNode.data.type.toLowerCase()}-${Date.now().toString(36)}`;
      const newNode: StudioNode = {
        ...targetNode,
        id: newNodeId,
        position: {
          x: targetNode.position.x + 35,
          y: targetNode.position.y + 35,
        },
        data: {
          ...targetNode.data,
          name: `${targetNode.data.name}_کپی`,
        },
        selected: true,
      };
      updateGraph((cur) => ({
        ...cur,
        nodes: [...cur.nodes.map((n) => ({ ...n, selected: false })), newNode],
      }));
      setSelectedNodeId(newNodeId);
      setMessage({
        kind: "info",
        text: `نود «${targetNode.data.name}» تکثیر شد.`,
      });
    },
    [nodes, snapshot, updateGraph],
  );

  const deleteNode = useCallback(
    (id: string) => {
      snapshot();
      updateGraph((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== id),
        edges: current.edges.filter(
          (edge) => edge.source !== id && edge.target !== id,
        ),
      }));
      setSelectedNodeId(undefined);
    },
    [snapshot, updateGraph],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      snapshot();
      updateGraph((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== id),
      }));
      setSelectedEdgeId(undefined);
    },
    [snapshot, updateGraph],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (isCmdOrCtrl && e.key === "[") {
        e.preventDefault();
        setLeftOpen((prev) => !prev);
      } else if (isCmdOrCtrl && e.key === "]") {
        e.preventDefault();
        setRightOpen((prev) => !prev);
      } else if (isCmdOrCtrl && e.key === "\\") {
        e.preventDefault();
        setLeftOpen((prev) => {
          const next = !prev;
          setRightOpen(next);
          return next;
        });
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPanel("palette");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setPanel("io");
      } else if (isCmdOrCtrl && e.key.toLowerCase() === "d" && selectedNodeId) {
        e.preventDefault();
        duplicateNode(selectedNodeId);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId) {
          e.preventDefault();
          deleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          e.preventDefault();
          deleteEdge(selectedEdgeId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedNodeId,
    selectedEdgeId,
    duplicateNode,
    deleteNode,
    deleteEdge,
    undo,
    redo,
  ]);

  const onNodesChange = (changes: NodeChange<StudioNode>[]) =>
    updateGraph((current) => ({
      ...current,
      nodes: applyNodeChanges(changes, current.nodes),
    }));
  const onEdgesChange = (changes: EdgeChange<StudioEdge>[]) => {
    if (changes.some((change) => change.type === "remove")) snapshot();
    updateGraph((current) => ({
      ...current,
      edges: applyEdgeChanges(changes, current.edges),
    }));
  };
  const isValidConnection = (connection: StudioEdge | Connection) => {
    const checked = checkConnection(
      {
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      },
      nodes,
      edges,
    );
    lastCheck.current = checked;
    lastConnection.current = {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    };
    return checked.valid || Boolean(checked.occupiedEdge);
  };
  const onConnect = (connection: Connection) => {
    const checked = checkConnection(connection, nodes, edges);
    if (checked.occupiedEdge) {
      setReplace({ connection, edge: checked.occupiedEdge });
      return;
    }
    if (!checked.valid) {
      showReject(checked, connection);
      return;
    }
    snapshot();
    updateGraph((current) => ({
      ...current,
      edges: addEdge(
        { ...connection, id: crypto.randomUUID(), type: "waterwall" },
        current.edges,
      ) as StudioEdge[],
    }));
    setMessage({ kind: "success", text: "اتصال معتبر اضافه شد." });
  };
  const onConnectEnd = () => {
    if (
      lastCheck.current &&
      !lastCheck.current.valid &&
      !lastCheck.current.occupiedEdge
    )
      showReject(lastCheck.current, lastConnection.current);
  };
  const showReject = (
    checked: ReturnType<typeof checkConnection>,
    connection?: Connection,
  ) => {
    setMessage({
      kind: "error",
      text: checked.reason,
      technical: checked.technical,
    });
    setRejected({ check: checked, connection });
  };

  const insertSuggestedAdapter = () => {
    const connection = rejected?.connection;
    const adapterType = rejected?.check.suggestedAdapter;
    if (!connection?.source || !connection.target || !adapterType) return;
    const definition = getDefinition(adapterType);
    const adapter: StudioNode = {
      id: `${adapterType.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`,
      type: "waterwall",
      position: midpoint(
        nodes.find((item) => item.id === connection.source),
        nodes.find((item) => item.id === connection.target),
      ),
      data: {
        type: adapterType,
        name: `${adapterType.toLowerCase()}-${crypto.randomUUID().slice(0, 4)}`,
        settings: {},
        definition,
      },
    };
    const withAdapter = [...nodes, adapter];
    const incoming: Connection = {
      source: connection.source,
      target: adapter.id,
      sourceHandle: connection.sourceHandle,
      targetHandle: definition.inputs[0]?.id ?? "previous",
    };
    const outgoing: Connection = {
      source: adapter.id,
      target: connection.target,
      sourceHandle: definition.outputs[0]?.id ?? "next",
      targetHandle: connection.targetHandle,
    };
    const first = checkConnection(incoming, withAdapter, edges);
    const second = checkConnection(outgoing, withAdapter, edges);
    if (!first.valid || !second.valid) {
      showReject(!first.valid ? first : second, connection);
      return;
    }
    snapshot();
    updateGraph((current) => ({
      ...current,
      nodes: [...current.nodes, adapter],
      edges: [
        ...current.edges,
        { ...incoming, id: crypto.randomUUID(), type: "waterwall" },
        { ...outgoing, id: crypto.randomUUID(), type: "waterwall" },
      ] as StudioEdge[],
    }));
    setRejected(undefined);
    setMessage({
      kind: "success",
      text: `${adapterType} میان دو لایه درج شد.`,
    });
    setSelectedNodeId(adapter.id);
    setPanel("inspector");
  };

  const autoFixNodeAdapter = useCallback(
    (nodeId: string) => {
      const sourceNode = nodes.find((n) => n.id === nodeId);
      if (!sourceNode) return;
      const outgoingEdge = edges.find((e) => e.source === nodeId);
      if (!outgoingEdge) return;
      const targetNode = nodes.find((n) => n.id === outgoingEdge.target);
      if (!targetNode) return;

      const sourceDef = getDefinition(sourceNode.data.type);
      const sourcePort = sourceDef.outputs.find(
        (p) => p.id === (outgoingEdge.sourceHandle ?? "next"),
      );
      const adapterType =
        sourcePort?.layer === "packet" ||
        sourceNode.data.type === "ObfuscatorClient" ||
        sourceNode.data.type === "TunDevice"
          ? "PacketsToConnection"
          : "StreamToPackets";

      const definition = getDefinition(adapterType);
      const adapterId = `${adapterType.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
      const adapter: StudioNode = {
        id: adapterId,
        type: "waterwall",
        position: {
          x: (sourceNode.position.x + targetNode.position.x) / 2,
          y: (sourceNode.position.y + targetNode.position.y) / 2,
        },
        data: {
          type: adapterType,
          name: `${adapterType.toLowerCase()}_autofix`,
          settings: {},
          definition,
        },
      };

      snapshot();
      updateGraph((current) => ({
        ...current,
        nodes: [...current.nodes, adapter],
        edges: [
          ...current.edges.filter((e) => e.id !== outgoingEdge.id),
          {
            id: crypto.randomUUID(),
            source: sourceNode.id,
            target: adapterId,
            sourceHandle: outgoingEdge.sourceHandle ?? "next",
            targetHandle: definition.inputs[0]?.id ?? "previous",
            type: "waterwall",
          },
          {
            id: crypto.randomUUID(),
            source: adapterId,
            target: targetNode.id,
            sourceHandle: definition.outputs[0]?.id ?? "next",
            targetHandle: outgoingEdge.targetHandle ?? "previous",
            type: "waterwall",
          },
        ] as StudioEdge[],
      }));

      setMessage({
        kind: "success",
        text: `مبدل ${adapterType} با موفقیت بین ${sourceNode.data.name} و ${targetNode.data.name} درج شد.`,
      });
      setSelectedNodeId(adapterId);
    },
    [nodes, edges, snapshot, updateGraph],
  );

  const handleRejectedAction = () => {
    const related = rejected?.check.relatedEdge;
    if (related) {
      setSelectedEdgeId(related.id);
      setPanel("simulator");
    } else if (rejected?.connection?.source) {
      setSelectedNodeId(rejected.connection.source);
      setPanel("inspector");
    }
    setRejected(undefined);
  };

  const openAdd = (
    sourceId?: string,
    handleId?: string,
    edgeId?: string,
    anchor?: { x: number; y: number },
  ) => {
    setPendingAdd({ sourceId, handleId, edgeId, anchor });
    setQuickAddExpanded(false);
    setPanel(anchor ? null : "palette");
  };
  const suggestions = useMemo(() => {
    if (!pendingAdd) return [];
    if (pendingAdd.edgeId) {
      const edge = edges.find((item) => item.id === pendingAdd.edgeId),
        source = nodes.find((item) => item.id === edge?.source);
      return recommendNext(
        source,
        edge?.sourceHandle ?? "next",
        nodes,
        edges,
      ).filter((item) => canInsert(item, edge, nodes, edges));
    }
    return recommendNext(
      nodes.find((node) => node.id === pendingAdd.sourceId),
      pendingAdd.handleId ?? "next",
      nodes,
      edges,
    );
  }, [pendingAdd, nodes, edges]);
  const pickNode = (type: string) => {
    const definition = getDefinition(type),
      id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
    const source = nodes.find((node) => node.id === pendingAdd?.sourceId),
      edge = edges.find((item) => item.id === pendingAdd?.edgeId);
    const position = edge
      ? midpoint(
          nodes.find((n) => n.id === edge.source),
          nodes.find((n) => n.id === edge.target),
        )
      : source
        ? { x: source.position.x + 320, y: source.position.y }
        : {
            x: 180 + (nodes.length % 3) * 260,
            y: 120 + Math.floor(nodes.length / 3) * 170,
          };
    const count = nodes.filter((n) => n.data.type === type).length + 1;
    const friendlyName = `${type}_${count}`;
    const node: StudioNode = {
      id,
      type: "waterwall",
      position,
      data: {
        type,
        name: friendlyName,
        // generate-schema.mjs never emits FieldDefinition.default, so this was
        // always an empty object built by filtering everything out.
        settings: {},
        definition,
      },
    };
    if (edge) {
      const withoutEdge = edges.filter((item) => item.id !== edge.id);
      const first = checkConnection(
        {
          source: edge.source,
          target: node.id,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: definition.inputs[0]?.id ?? "previous",
        },
        [...nodes, node],
        withoutEdge,
      );
      const second = checkConnection(
        {
          source: node.id,
          target: edge.target,
          sourceHandle: definition.outputs[0]?.id ?? "next",
          targetHandle: edge.targetHandle ?? "previous",
        },
        [...nodes, node],
        withoutEdge,
      );
      if (!first.valid || !second.valid) {
        showReject(!first.valid ? first : second);
        return;
      }
    } else if (source) {
      const connection: Connection = {
        source: source.id,
        target: node.id,
        sourceHandle: pendingAdd?.handleId ?? "next",
        targetHandle: definition.inputs[0]?.id ?? "previous",
      };
      const checked = checkConnection(connection, [...nodes, node], edges);
      if (checked.occupiedEdge) {
        setReplace({ connection, edge: checked.occupiedEdge, newNode: node });
        setPendingAdd(undefined);
        return;
      }
      if (!checked.valid) {
        showReject(checked);
        return;
      }
    }
    snapshot();
    updateGraph((current) => {
      let nextEdges = [...current.edges];
      if (edge) {
        nextEdges = nextEdges.filter((item) => item.id !== edge.id);
        nextEdges.push(
          {
            id: crypto.randomUUID(),
            source: edge.source,
            target: id,
            sourceHandle: edge.sourceHandle,
            targetHandle: "previous",
            type: "waterwall",
          },
          {
            id: crypto.randomUUID(),
            source: id,
            target: edge.target,
            sourceHandle: definition.outputs[0]?.id ?? "next",
            targetHandle: edge.targetHandle ?? "previous",
            type: "waterwall",
          },
        );
      } else if (source) {
        nextEdges.push({
          id: crypto.randomUUID(),
          source: source.id,
          target: id,
          sourceHandle: pendingAdd?.handleId ?? "next",
          targetHandle: definition.inputs[0]?.id ?? "previous",
          type: "waterwall",
        });
      }
      return { ...current, nodes: [...current.nodes, node], edges: nextEdges };
    });
    setSelectedNodeId(id);
    setPendingAdd(undefined);
    setPanel("inspector");
    setRightOpen(true);
    focusAddedNodes(source ? [source.id, id] : [id]);
    setMessage({
      kind: "success",
      text: edge
        ? "نود پس از بررسی هر دو سمت در مسیر درج شد."
        : "نود به مسیر اضافه شد.",
    });
  };
  const updateNode = (next: StudioNode) => {
    snapshot();
    updateGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === next.id ? next : node)),
    }));
  };
  const switchServer = (server: "iran" | "kharej") =>
    setProject((current) => ({ ...current, activeServer: server }));
  const arrangeGraph = () => {
    if (!nodes.length) return;
    snapshot();
    updateGraph((current) => autoLayout(current));
    setMessage({
      kind: "success",
      text: "چیدمان مسیر بر اساس جهت اتصال‌ها مرتب شد.",
    });
  };
  const loadScenario = (scenario: Scenario) => {
    snapshot();
    setProject((current) => projectFromScenario(scenario, current));
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setPanel(null);
    setMessage({
      kind: "success",
      text: `سناریوی «${scenario.title}» برای هر دو سرور بارگذاری شد. هشدارها را پیش از خروجی بررسی کنید.`,
    });
  };
  const clearActiveGraph = () => {
    snapshot();
    updateGraph({ nodes: [], edges: [], variables: {} });
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setConfirmClear(false);
    setMessage({
      kind: "success",
      text: "بوم سرور فعال پاک شد؛ با Undo قابل بازیابی است.",
    });
  };
  const applyIssue = (issue: ValidationIssue) => {
    // A pair finding names a node on the other server; jump there and select it.
    if (issue.action?.type === "switch-server" && issue.peer) {
      const peer = issue.peer;
      setProject((current) => ({ ...current, activeServer: peer.server }));
      setSelectedNodeId(peer.nodeId);
      setPanel("inspector");
      setRightOpen(true);
      return;
    }
    if (issue.nodeId) {
      setSelectedNodeId(issue.nodeId);
      const toInspector = issue.action?.type === "configure";
      setPanel(toInspector ? "inspector" : "issues");
      // Opening the inspector panel without revealing the side dock leaves the
      // click looking dead; "تکمیل تنظیمات" must actually show the settings.
      if (toInspector) setRightOpen(true);
    }
    if (issue.edgeId && issue.action?.type === "remove-edge") {
      snapshot();
      updateGraph((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== issue.edgeId),
      }));
    }
  };
  const confirmReplace = () => {
    if (!replace) return;
    snapshot();
    updateGraph((current) => ({
      ...current,
      nodes: replace.newNode
        ? [...current.nodes, replace.newNode]
        : current.nodes,
      edges: addEdge(
        { ...replace.connection, id: crypto.randomUUID(), type: "waterwall" },
        current.edges.filter((edge) => edge.id !== replace.edge.id),
      ) as StudioEdge[],
    }));
    if (replace.newNode) {
      setSelectedNodeId(replace.newNode.id);
      setPanel("inspector");
    }
    setReplace(undefined);
    setMessage({
      kind: "success",
      text: "اتصال قبلی با تأیید شما جایگزین شد.",
    });
  };

  const displayNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      definition: getDefinition(node.data.type),
      occupiedHandles: edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => edge.sourceHandle ?? "next"),
      resolvedLayer: layerBadge(solution.resolvedByNode.get(node.id)),
      status: issues.some(
        (item) => item.nodeId === node.id && item.severity === "error",
      )
        ? "error"
        : issues.some(
              (item) => item.nodeId === node.id && item.severity === "warning",
            )
          ? "warning"
          : "valid",
    },
    className: activeStep?.nodeId === node.id ? "sim-active-node" : "",
  })) as StudioNode[];
  const displayEdges = edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source);
    const port = getDefinition(source?.data.type ?? "").outputs.find(
      (item) => item.id === (edge.sourceHandle ?? "next"),
    );
    const layer = port?.layer ?? "any";
    const layerColor =
      layer === "packet"
        ? themeColors.packet
        : layer === "stream"
          ? themeColors.stream
          : themeColors.any;
    const color =
      activeStep?.edgeId === edge.id ? themeColors.edgeActive : layerColor;
    return {
      ...edge,
      data: {
        ...edge.data,
        // A symbolic edge already carries its own label — the Bridge pair name.
        // Overwriting it with a layer name would say nothing true: the pair
        // link carries no traffic.
        label: edge.data?.symbolic
          ? edge.data.label
          : layer === "packet"
            ? "L3 پکت"
            : layer === "stream"
              ? "L4 استریم"
              : "هر دو",
      },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      className: activeStep?.edgeId === edge.id ? "sim-active-edge" : "",
      style: {
        stroke: color,
        strokeWidth: activeStep?.edgeId === edge.id ? 4 : 2.4,
      },
    };
  });
  const graphActions = {
    addAfter: (
      nodeId: string,
      handleId: string,
      anchor?: { x: number; y: number },
    ) => openAdd(nodeId, handleId, undefined, anchor),
    inspect: (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setPanel("inspector");
      setRightOpen(true);
    },
    insertEdge: (edgeId: string) => openAdd(undefined, undefined, edgeId),
    remove: deleteNode,
    duplicate: duplicateNode,
  };

  const historyActions = () => (
    <div
      className="command-group history-actions history-actions--header"
      role="group"
      aria-label="تاریخچه"
    >
      <button
        className="icon-button"
        onClick={undo}
        disabled={!history.current.length}
        aria-label="واگرد"
        title="واگرد"
      >
        <Undo2 />
      </button>
      <button
        className="icon-button"
        onClick={redo}
        disabled={!future.current.length}
        aria-label="بازانجام"
        title="بازانجام"
      >
        <Redo2 />
      </button>
    </div>
  );

  /* The active server reads as canvas context, not as a program-level action,
     so on mobile it moves onto the board beside the layer legend. Only one of
     the two placements is ever visible; CSS picks by breakpoint. */
  const serverSwitch = (placement: "desktop" | "canvas") => (
    <div
      className={`server-switch server-switch--${placement}`}
      role="group"
      aria-label="سرور فعال"
    >
      <button
        className={project.activeServer === "iran" ? "active" : ""}
        onClick={() => switchServer("iran")}
      >
        🇮🇷 ایران
      </button>
      <button
        className={project.activeServer === "kharej" ? "active" : ""}
        onClick={() => switchServer("kharej")}
      >
        🌐 خارج
      </button>
    </div>
  );

  return (
    <main
      className={`app-shell ${!leftOpen ? "no-left" : ""} ${!rightOpen ? "no-right" : ""}`}
    >
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={meshivoLogo} alt="Meshivo" />
          <div className="brand-copy">
            <strong>WaterWall Studio</strong>
            <a
              className="brand-by"
              href={CREATOR_LINKS.github}
              target="_blank"
              rel="noreferrer"
              aria-label="Meshivo در GitHub"
            >
              by Meshivo
            </a>
          </div>
        </div>
        {serverSwitch("desktop")}
        <div className="command-actions">
          <button
            className={`panel-trigger ${leftOpen ? "is-active" : ""}`}
            onClick={() => {
              setLeftOpen(!leftOpen);
              if (!leftOpen) setRightOpen(false);
            }}
            aria-pressed={leftOpen}
          >
            {leftOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            <span>نودها</span>
          </button>
          {historyActions()}
          <button
            className="icon-button focus-canvas-button"
            onClick={() => {
              const bothClosed = !leftOpen && !rightOpen;
              setLeftOpen(bothClosed);
              setRightOpen(false);
            }}
            title={
              !leftOpen && !rightOpen
                ? "نمایش پالت (Ctrl+\\)"
                : "تمرکز روی بوم (Ctrl+\\)"
            }
            aria-label="تمرکز روی بوم"
          >
            <Maximize2 size={15} />
          </button>
          {!nodes.length && (
            <button
              className="primary-button workspace-primary is-empty-context"
              onClick={() => setShowWizard(true)}
            >
              <Rocket />
              <span>ساخت سریع</span>
            </button>
          )}
          {/* Ready-made scenarios are the fastest way in, so they sit ahead of
              the muted tool strip with a visible label. */}
          <button
            className="secondary-button scenarios-button"
            onClick={() => setPanel("scenarios")}
            aria-label="سناریوهای آماده"
            title="سناریوهای آماده"
          >
            <BookOpen />
            <span className="scenarios-label-long">سناریوهای آماده</span>
            <span className="scenarios-label-short">سناریوها</span>
          </button>
          <div
            className="header-quick-tools"
            role="group"
            aria-label="ابزارهای سریع"
          >
            {/* Both also live in the overflow menu, so mobile drops them here
                and keeps only the swatches. */}
            <button
              className="icon-button quick-tool-desktop"
              onClick={() => setPanel("io")}
              aria-label="ورود و خروجی"
              title="ورود و خروجی"
            >
              <FileUp />
            </button>
            <button
              className="icon-button quick-tool-desktop"
              onClick={arrangeGraph}
              disabled={!nodes.length}
              aria-label="چیدمان خودکار"
              title="چیدمان خودکار"
            >
              <LayoutGrid />
            </button>
            {/* Mobile: four overlapped dots never stayed legible in the width
                available, so the palette collapses to one control. */}
            <div className="theme-picker">
              <button
                className="icon-button theme-picker-trigger"
                onClick={() => setShowThemes(!showThemes)}
                aria-expanded={showThemes}
                aria-label="تغییر رنگ‌بندی"
                title="تغییر رنگ‌بندی"
              >
                <Paintbrush />
                <span className={`theme-picker-dot theme-swatch--${theme}`} />
              </button>
              {showThemes && (
                <>
                  <div
                    className="theme-picker-scrim"
                    onClick={() => setShowThemes(false)}
                  />
                  <menu className="theme-picker-menu">
                    {THEMES.map((option) => (
                      <li key={option.id}>
                        <button
                          className={theme === option.id ? "is-active" : ""}
                          onClick={() => {
                            setTheme(option.id);
                            setShowThemes(false);
                          }}
                          aria-pressed={theme === option.id}
                        >
                          <span
                            className={`theme-picker-dot theme-swatch--${option.id}`}
                          />
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </menu>
                </>
              )}
            </div>
            <div className="theme-swatches" role="group" aria-label="تم">
              {THEMES.map((option) => (
                <button
                  key={option.id}
                  className={`theme-swatch theme-swatch--${option.id} ${theme === option.id ? "is-active" : ""}`}
                  onClick={() => setTheme(option.id)}
                  aria-pressed={theme === option.id}
                  aria-label={option.label}
                  title={option.label}
                />
              ))}
            </div>
          </div>
          {/* Secondary tools stay available without competing with the canvas. */}
          <div className="command-overflow">
            <button
              className="icon-button"
              aria-label="ابزارهای بیشتر"
              aria-expanded={showOverflow}
              onClick={() => setShowOverflow(!showOverflow)}
            >
              <MoreHorizontal />
              <span className="overflow-label">بیشتر</span>
            </button>
            {showOverflow && (
              <>
                <div
                  className="overflow-scrim"
                  onClick={() => setShowOverflow(false)}
                />
                <menu className="overflow-menu">
                  {[
                    {
                      label: "ورود و خروجی",
                      icon: <FileUp />,
                      run: () => setPanel("io"),
                      disabled: false,
                    },
                    {
                      label: advanced ? "حالت ساده" : "حالت حرفه‌ای",
                      icon: <Braces />,
                      run: () => setAdvanced(!advanced),
                      disabled: false,
                    },
                    {
                      label: "چیدمان خودکار",
                      icon: <LayoutGrid />,
                      run: arrangeGraph,
                      disabled: !nodes.length,
                    },
                    {
                      label: "متغیرها",
                      icon: <Variable />,
                      run: () => setPanel("variables"),
                      disabled: false,
                    },
                    {
                      label: "JSON زنده",
                      icon: <Braces />,
                      run: () => setPanel("json"),
                      disabled: false,
                    },
                    {
                      label: "کلیدهای میانبر",
                      icon: <Keyboard />,
                      run: () => setShowHotkeys(true),
                      disabled: false,
                    },
                    {
                      label: "پاک‌کردن بوم فعال",
                      icon: <Trash2 />,
                      run: () => setConfirmClear(true),
                      disabled: !nodes.length,
                    },
                  ].map((item) => (
                    <li key={item.label}>
                      <button
                        disabled={item.disabled}
                        onClick={() => {
                          setShowOverflow(false);
                          item.run();
                        }}
                      >
                        {item.icon} {item.label}
                      </button>
                    </li>
                  ))}
                </menu>
              </>
            )}
          </div>
        </div>
      </header>
      <aside className="side-panel palette-panel">
        <button
          className="panel-collapse"
          onClick={() => setLeftOpen(false)}
          aria-label="بستن فهرست نودها"
        >
          <PanelLeftClose />
        </button>
        <Palette
          advanced={advanced}
          onAdd={(type) => {
            const definition = getDefinition(type),
              id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
            snapshot();
            updateGraph((current) => ({
              ...current,
              nodes: [
                ...current.nodes,
                {
                  id,
                  type: "waterwall",
                  position: {
                    x: 120 + (current.nodes.length % 3) * 270,
                    y: 100 + Math.floor(current.nodes.length / 3) * 170,
                  },
                  data: { type, name: id, settings: {}, definition },
                },
              ],
            }));
            setSelectedNodeId(id);
            setPanel("inspector");
            setRightOpen(true);
          }}
        />
      </aside>
      <section
        className={`canvas-wrap ${!nodes.length ? "is-welcome" : ""}`}
        aria-label="بوم توپولوژی"
      >
        {!nodes.length && (
          <div className="welcome-stage">
            <svg
              className="welcome-network"
              viewBox="0 0 1200 760"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <path id="welcome-route-a" d="M-40 210 C160 80 260 390 470 220 S790 40 980 230 1260 350 1240 90" />
              <path id="welcome-route-b" d="M30 610 C210 420 320 720 520 520 S830 330 1010 560 1190 680 1260 470" />
              <path id="welcome-route-c" d="M160 20 C250 170 120 330 310 430 S690 690 830 430 1030 80 1210 170" />
              <path id="welcome-route-d" d="M-70 420 C120 300 260 480 430 380 S720 160 890 330 1120 500 1280 340" />
              <path id="welcome-route-e" d="M40 80 C210 250 370 90 540 300 S820 710 1190 650" />
              <g className="network-nodes">
                <circle cx="126" cy="170" r="8" /><circle cx="334" cy="294" r="6" />
                <circle cx="532" cy="186" r="8" /><circle cx="932" cy="180" r="7" />
                <circle cx="1110" cy="276" r="6" /><circle cx="218" cy="560" r="7" />
                <circle cx="590" cy="558" r="6" /><circle cx="1000" cy="548" r="8" />
                <circle cx="72" cy="402" r="6" /><circle cx="426" cy="382" r="7" />
                <circle cx="752" cy="248" r="6" /><circle cx="884" cy="438" r="8" />
                <circle cx="1164" cy="630" r="6" /><circle cx="682" cy="664" r="7" />
              </g>
              <g className="network-packets">
                <circle r="5"><animateMotion dur="8s" repeatCount="indefinite"><mpath href="#welcome-route-a" /></animateMotion></circle>
                <circle r="4"><animateMotion dur="11s" begin="-4s" repeatCount="indefinite"><mpath href="#welcome-route-b" /></animateMotion></circle>
                <circle r="4"><animateMotion dur="13s" begin="-7s" repeatCount="indefinite"><mpath href="#welcome-route-c" /></animateMotion></circle>
                <circle r="5"><animateMotion dur="9s" begin="-2s" repeatCount="indefinite"><mpath href="#welcome-route-d" /></animateMotion></circle>
                <circle r="4"><animateMotion dur="12s" begin="-6s" repeatCount="indefinite"><mpath href="#welcome-route-e" /></animateMotion></circle>
              </g>
            </svg>

            <div className="welcome-scroll">
              <div className="welcome-layout">
                <section className="welcome-hero" aria-labelledby="welcome-title">
                  <div className="welcome-logos" aria-label="Meshivo و WaterWall">
                    <img src={meshivoLogo} alt="Meshivo" />
                    <span aria-hidden="true">×</span>
                    <img src={waterwallLogo} alt="WaterWall" />
                  </div>
                  <div className="welcome-wordmark">
                    <strong>WaterWall Studio</strong>
                    <a
                      href={CREATOR_LINKS.github}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Meshivo در GitHub"
                    >
                      by Meshivo
                    </a>
                  </div>
                  <h1 id="welcome-title">مسیر واتروال‌تان را بصری بسازید</h1>
                  <p className="welcome-lead">
                    نودها را بچینید، مسیر ایران و خارج را متصل کنید و یک
                    کانفیگ JSON آماده‌ی بررسی تحویل بگیرید.
                  </p>
                  <ul className="canvas-empty-features">
                    <li><Boxes /> ۷۰+ نوع نود</li>
                    <li><Cable /> ایران ⇄ خارج</li>
                    <li><Braces /> خروجی JSON</li>
                  </ul>
                  <div className="empty-actions">
                    <button className="primary-button welcome-primary" onClick={() => setShowWizard(true)}>
                      <Rocket /> ساخت سریع مسیر
                    </button>
                    <div className="empty-secondary-actions">
                      <button onClick={() => setPanel("io")}>واردکردن کانفیگ</button>
                      <span aria-hidden="true">·</span>
                      <button onClick={() => openAdd()}>شروع دستی</button>
                    </div>
                  </div>
                </section>

                <aside className="welcome-about" aria-label="درباره‌ی WaterWall Studio">
                  <section>
                    <div className="welcome-about-heading">
                      <img src={waterwallLogo} alt="" />
                      <h2>درباره‌ی WaterWall</h2>
                    </div>
                    <p>WaterWall یک پلتفرم شبکه‌ی ماژولار برای ساخت و مدیریت مسیرهای پردازش ترافیک است.</p>
                    <a href="https://github.com/radkesvat/WaterWall" target="_blank" rel="noreferrer">
                      مشاهده‌ی پروژه <ExternalLink />
                    </a>
                  </section>
                  <section>
                    <div className="welcome-about-heading">
                      <img src={meshivoLogo} alt="" />
                      <h2>درباره‌ی این استودیو</h2>
                    </div>
                    <p>WaterWall Studio ابزاری مستقل است که توسط Meshivo توسعه داده شده و وابستگی رسمی به تیم WaterWall ندارد.</p>
                  </section>
                </aside>
              </div>

              <section className="welcome-contact" aria-labelledby="contact-title">
                <h2 id="contact-title">ارتباط با من</h2>
                <div className="welcome-contact-links">
                  {CREATOR_LINKS.github && <a href={CREATOR_LINKS.github} target="_blank" rel="noreferrer" aria-label="GitHub"><span className="contact-icon"><Github /></span><strong>GitHub</strong><small>Meshivo</small></a>}
                  {CREATOR_LINKS.telegram && <a href={CREATOR_LINKS.telegram} target="_blank" rel="noreferrer" aria-label="Telegram"><span className="contact-icon"><Send /></span><strong>Telegram</strong><small>Meshivo</small></a>}
                  {CREATOR_LINKS.website && <a href={CREATOR_LINKS.website} target="_blank" rel="noreferrer" aria-label="Website"><span className="contact-icon"><Globe2 /></span><strong>Website</strong><small>Meshivo</small></a>}
                  {CREATOR_LINKS.email && <a href={`mailto:${CREATOR_LINKS.email.replace(/^mailto:/, "")}`} aria-label="Email"><span className="contact-icon"><Mail /></span><strong>Email</strong><small>Meshivo</small></a>}
                  {!Object.values(CREATOR_LINKS).some(Boolean) && (
                    <p className="welcome-contact-pending">لینک‌های ارتباطی پس از ثبت آدرس‌های رسمی نمایش داده می‌شوند.</p>
                  )}
                </div>
                <a
                  className="welcome-contact-signature"
                  href={CREATOR_LINKS.website}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="وب‌سایت Meshivo"
                >
                  <img src={meshivoLogo} alt="" />
                  <span>ساخته شده با <b aria-label="عشق">♥</b> توسط Meshivo</span>
                </a>
              </section>
            </div>
          </div>
        )}
        <GraphActions.Provider value={graphActions}>
          <ReactFlow
            dir="ltr"
            className={zoomedOut ? "lod-far" : undefined}
            onMove={(_, viewport) => setZoomedOut(viewport.zoom < 0.55)}
            deleteKeyCode={["Delete", "Backspace"]}
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              flow.current = instance;
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setPanel("inspector");
              setRightOpen(true);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setPanel("simulator");
            }}
            onPaneClick={() => {
              // Clicking empty board is the universal "I'm done here" gesture;
              // without it the inspector could only be closed from its own
              // header, which desktop users kept missing.
              setSelectedNodeId(undefined);
              setSelectedEdgeId(undefined);
              setRightOpen(false);
              // Any open sheet closes: a tap on empty board is "done here".
              // A full-screen scrim would have done this too, but it also ate
              // every pan and zoom gesture while the sheet was open.
              if (panel === "inspector" || panel === "palette" || panel === "tools")
                setPanel(null);
            }}
            onNodeDragStart={snapshot}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
            connectionRadius={36}
            snapToGrid
            snapGrid={[16, 16]}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color={themeColors.dots}
            />
            <Controls position="bottom-right" orientation="horizontal">
              <ControlButton
                className="control-history"
                onClick={undo}
                disabled={!history.current.length}
                title="واگرد"
                aria-label="واگرد"
              >
                <Undo2 />
              </ControlButton>
              <ControlButton
                className="control-history"
                onClick={redo}
                disabled={!future.current.length}
                title="بازانجام"
                aria-label="بازانجام"
              >
                <Redo2 />
              </ControlButton>
            </Controls>
            {nodes.length > 0 && (
              <>
                {nodes.length > 8 && (
                  <MiniMap
                    position="bottom-right"
                    pannable
                    zoomable
                    nodeColor={(node) =>
                      getDefinition(String(node.data?.type)).outputs[0]
                        ?.layer === "packet"
                        ? themeColors.packet
                        : themeColors.stream
                    }
                    ariaLabel="نمای کوچک بوم"
                  />
                )}
              </>
            )}
          </ReactFlow>
        </GraphActions.Provider>
        <div className="canvas-top-left">
          {serverSwitch("canvas")}
          <details className="layer-legend">
            <summary>لایه‌ها</summary>
            <div aria-label="راهنمای رنگ لایه‌ها">
              <span>
                <i className="layer-packet" /> پکت L3
              </span>
              <span>
                <i className="layer-stream" /> استریم L4
              </span>
              <span>
                <i className="layer-any" /> هر دو
              </span>
            </div>
          </details>
          {nodes.length > 0 && (
            <button
              className="primary-button canvas-run-check"
              onClick={() => setPanel("simulator")}
            >
              <Play />
              <span>بررسی مسیر</span>
            </button>
          )}
          <button
            className="canvas-json-open"
            onClick={() => setPanel("json")}
            title="دیدن، کپی و دانلود خروجی JSON"
          >
            <Braces />
            <span>
              خروجی<small>json</small>
            </span>
          </button>
        </div>
        {nodes.length > 0 && (
          <button
            className={`graph-health ${hasErrorIssue ? "has-error" : totalIssueCount ? "has-warning" : "healthy"}`}
            onClick={() => setPanel("issues")}
          >
            {totalIssueCount ? <AlertTriangle /> : <CheckCircle2 />}
            <span>
              <strong>
                {totalIssueCount
                  ? `${totalIssueCount} مورد برای بررسی`
                  : "مسیر آماده است"}
              </strong>
            </span>
          </button>
        )}
        {rejected && (
          <section className="connection-reject" role="alert">
            <AlertTriangle />
            <div>
              <strong>این دو نود مستقیماً متصل نمی‌شوند</strong>
              <p>{rejected.check.reason}</p>
              <details>
                <summary>دلیل فنی</summary>
                <code>{rejected.check.technical}</code>
              </details>
            </div>
            {rejected.check.suggestedAdapter && (
              <button
                className="primary-button"
                onClick={insertSuggestedAdapter}
              >
                <WandSparkles /> درج خودکار {rejected.check.suggestedAdapter}
              </button>
            )}
            {!rejected.check.suggestedAdapter && rejected.check.actionLabel && (
              <button
                className="secondary-button"
                onClick={handleRejectedAction}
              >
                {rejected.check.actionLabel}
              </button>
            )}
            <button
              className="dismiss-reject"
              aria-label="بستن هشدار"
              onClick={() => setRejected(undefined)}
            >
              ×
            </button>
          </section>
        )}
        {message && (
          <div
            className={`toast ${message.kind}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            <span>
              {message.kind === "error" ? <AlertTriangle /> : <CheckCircle2 />}
            </span>
            <div>
              <strong>{message.text}</strong>
              {message.technical && (
                <details>
                  <summary>دلیل فنی</summary>
                  <code>{message.technical}</code>
                </details>
              )}
            </div>
            <button onClick={() => setMessage(undefined)}>×</button>
          </div>
        )}
      </section>
      <aside className="side-panel inspector-panel">
        <button
          className="panel-collapse"
          onClick={() => setRightOpen(false)}
          aria-label="بستن تنظیمات نود"
        >
          <PanelLeftClose />
        </button>
        <Inspector
          node={selectedNode}
          nodes={nodes}
          issues={issues}
          advanced={advanced}
          onChange={updateNode}
          onDelete={deleteNode}
          onAutoFixAdapter={autoFixNodeAdapter}
        />
      </aside>
      <nav className="mobile-dock" aria-label="ابزارهای بوم">
        <button
          onClick={() => (nodes.length ? setPanel("palette") : openAdd())}
          className={panel === "palette" ? "active" : ""}
        >
          <Plus />
          <span>افزودن</span>
        </button>
        <button
          onClick={() => setPanel("inspector")}
          className={panel === "inspector" ? "active" : ""}
        >
          <Settings2 />
          <span>تنظیمات</span>
        </button>
        <button
          onClick={() => setPanel("issues")}
          className={panel === "issues" ? "active" : ""}
        >
          <ListChecks />
          <span>بررسی</span>
          {totalIssueCount > 0 && <b>{totalIssueCount}</b>}
        </button>
        {/* "عبور" is gone: the same simulator opens from «بررسی مسیر» on the
            canvas, and two doors to one panel only crowded the dock. */}
        <button
          onClick={() => setPanel("tools")}
          className={panel === "tools" ? "active" : ""}
        >
          <Wrench />
          <span>ابزارها</span>
        </button>
      </nav>

      {pendingAdd?.anchor && !quickAddExpanded && (
        <QuickNodePicker
          suggestions={suggestions}
          anchor={pendingAdd.anchor}
          onPick={pickNode}
          onShowAll={() => {
            setQuickAddExpanded(true);
            setPanel("palette");
          }}
          onClose={() => setPendingAdd(undefined)}
        />
      )}
      <Sheet
        open={Boolean(pendingAdd) && (!pendingAdd?.anchor || quickAddExpanded)}
        title={
          pendingAdd?.edgeId ? "درج نود میان اتصال" : "نود بعدی را انتخاب کنید"
        }
        onClose={() => {
          setPendingAdd(undefined);
          setQuickAddExpanded(false);
        }}
        className="picker-sheet"
      >
        <NodePicker
          suggestions={suggestions}
          advanced={advanced}
          onPick={pickNode}
        />
      </Sheet>
      {showWizard && (
        <WizardModal
          project={project}
          onApplyScenario={(nextProj) => {
            snapshot();
            setProject(nextProj);
            setMessage({
              kind: "success",
              text: `الگو با موفقیت اعمال شد. کانفیگ آماده است.`,
            });
          }}
          onClose={() => setShowWizard(false)}
        />
      )}
      {showHotkeys && (
        <div className="modal-overlay" onClick={() => setShowHotkeys(false)}>
          <div
            className="wizard-modal-box hotkeys-modal"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <header className="modal-header">
              <div className="title-with-icon">
                <Keyboard className="icon-accent" />
                <div>
                  <h3>کلیدهای میانبر محیط طراحی (IDE Hotkeys)</h3>
                  <small>سرعت طراحی توپولوژی خود را افزایش دهید</small>
                </div>
              </div>
              <button
                className="icon-button close-btn"
                onClick={() => setShowHotkeys(false)}
              >
                ✕
              </button>
            </header>
            <div className="hotkeys-grid">
              <div className="hotkey-row">
                <kbd>Ctrl</kbd> + <kbd>Z</kbd>
                <span>واگرد آخرین تغییر (Undo)</span>
              </div>
              <div className="hotkey-row">
                <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Shift</kbd>+
                <kbd>Ctrl</kbd>+<kbd>Z</kbd>
                <span>بازانجام تغییر (Redo)</span>
              </div>
              <div className="hotkey-row">
                <kbd>Ctrl</kbd> + <kbd>K</kbd>
                <span>باز کردن پالت و جستجوی هوشمند نودها</span>
              </div>
              <div className="hotkey-row">
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
                <span>باز کردن بخش ورود/خروجی و دانلود پکیج</span>
              </div>
              <div className="hotkey-row">
                <kbd>Ctrl</kbd> + <kbd>D</kbd>
                <span>تکثیر نود انتخاب شده</span>
              </div>
              <div className="hotkey-row">
                <kbd>Delete</kbd> / <kbd>Backspace</kbd>
                <span>حذف نود یا اتصال انتخاب شده</span>
              </div>
            </div>
          </div>
        </div>
      )}
      <Sheet
        open={panel === "scenarios"}
        title="سناریوهای آماده"
        onClose={() => setPanel(null)}
        className="wide-sheet"
      >
        <ScenarioLibrary onLoad={loadScenario} />
      </Sheet>
      <Sheet
        open={panel === "json"}
        title={`JSON زنده · سرور ${project.activeServer === "iran" ? "ایران" : "خارج"}`}
        onClose={() => setPanel(null)}
        className="wide-sheet"
      >
        <LiveJson
          graph={graph}
          servers={project.servers}
          activeServer={project.activeServer}
          onApply={(next) => {
            snapshot();
            updateGraph(next);
            setMessage({ kind: "success", text: "JSON روی بوم اعمال شد." });
          }}
        />
      </Sheet>
      <Sheet
        open={panel === "variables"}
        title="متغیرهای کانفیگ"
        onClose={() => setPanel(null)}
      >
        <VariablesPanel
          graph={graph}
          onChange={(variables) => {
            snapshot();
            updateGraph((current) => ({ ...current, variables }));
          }}
        />
      </Sheet>
      <Sheet
        open={panel === "issues"}
        title={`بررسی گراف · ${totalIssueCount} مورد`}
        onClose={() => setPanel(null)}
      >
        <IssuesPanel
          issues={issues}
          pairIssues={pairIssues}
          onAction={applyIssue}
        />
      </Sheet>
      <Sheet
        open={panel === "simulator"}
        title="نمایش عبور ترافیک"
        onClose={() => setPanel(null)}
        className="wide-sheet"
      >
        <Simulator
          nodes={nodes}
          edges={edges}
          blocked={hasBlockingIssues(issues)}
          incomplete={hasIncompleteIssues(issues)}
          onActiveChange={setActiveStep}
        />
        {selectedEdge && (
          <EdgeInspector edge={selectedEdge} nodes={nodes} step={activeStep} />
        )}
      </Sheet>
      <Sheet
        open={panel === "io"}
        title="ورود و خروجی پروژه"
        onClose={() => setPanel(null)}
        className="wide-sheet"
      >
        <ImportExport
          project={project}
          issues={issues}
          onImport={(next) => {
            snapshot();
            if ("servers" in next) {
              setProject({
                ...next,
                activeServer:
                  next.activeServer === "kharej" ? "kharej" : "iran",
                migrationNotes: next.migrationNotes ?? [],
                updatedAt: new Date().toISOString(),
              });
            } else {
              updateGraph(next);
            }
          }}
          onClose={() => setPanel(null)}
        />
      </Sheet>
      <div
        className={`mobile-sheet-host ${panel === "palette" || panel === "inspector" || panel === "tools" ? "open" : ""}`}
      >
        <div className="mobile-sheet-header">
          <span className="sheet-grab" />
          <button className="sheet-close" onClick={() => setPanel(null)}>
            <ChevronDown /> بستن
          </button>
        </div>
        {panel === "palette" ? (
          pendingAdd ? (
            <NodePicker
              suggestions={suggestions}
              advanced={advanced}
              onPick={pickNode}
            />
          ) : (
            <Palette
              advanced={advanced}
              onAdd={(type) => {
                const definition = getDefinition(type);
                const id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
                const count =
                  nodes.filter((n) => n.data.type === type).length + 1;
                const friendlyName = `${type}_${count}`;
                snapshot();
                updateGraph((current) => ({
                  ...current,
                  nodes: [
                    ...current.nodes,
                    {
                      id,
                      type: "waterwall",
                      position: nextLooseNodePosition(current.nodes),
                      data: {
                        type,
                        name: friendlyName,
                        settings: {},
                        definition,
                      },
                    },
                  ],
                }));
                // Adding is a completed action: the sheet closes so the new
                // node is actually visible on the board behind it.
                setPanel(null);
                setSelectedNodeId(id);
                focusAddedNodes([id]);
                setMessage({
                  kind: "success",
                  text: `${friendlyName} جدا روی بوم اضافه شد.`,
                });
              }}
            />
          )
        ) : panel === "inspector" ? (
          <Inspector
            node={selectedNode}
            nodes={nodes}
            issues={issues}
            advanced={advanced}
            onChange={updateNode}
            onDelete={deleteNode}
            onAutoFixAdapter={autoFixNodeAdapter}
          />
        ) : panel === "tools" ? (
          <div className="mobile-tools">
            <button onClick={() => setPanel("scenarios")}>
              <BookOpen />
              <span>
                <strong>سناریوهای آماده</strong>
                <small>ساخت هم‌زمان ایران و خارج</small>
              </span>
            </button>
            <button onClick={() => setPanel("json")}>
              <Braces />
              <span>
                <strong>JSON زنده</strong>
                <small>مشاهده و اعمال روی بوم</small>
              </span>
            </button>
            <button onClick={arrangeGraph} disabled={!nodes.length}>
              <LayoutGrid />
              <span>
                <strong>چیدمان خودکار</strong>
                <small>مرتب‌سازی بر اساس جریان</small>
              </span>
            </button>
            <button onClick={() => setPanel("io")}>
              <FileUp />
              <span>
                <strong>ورود و خروجی</strong>
                <small>فایل، ZIP و QR واقعی</small>
              </span>
            </button>
            <button onClick={() => setPanel("variables")}>
              <Variable />
              <span>
                <strong>متغیرها</strong>
                <small>مقدارهای مشترک بین نودها</small>
              </span>
            </button>
            <button onClick={() => setAdvanced(!advanced)}>
              <Braces />
              <span>
                <strong>{advanced ? "حالت ساده" : "حالت حرفه‌ای"}</strong>
                <small>
                  {advanced
                    ? "نمایش گزینه‌های ضروری"
                    : "نمایش همه گزینه‌های نودها"}
                </small>
              </span>
            </button>
            <button
              className="danger-tool"
              onClick={() => setConfirmClear(true)}
              disabled={!nodes.length}
            >
              <Trash2 />
              <span>
                <strong>پاک‌کردن بوم فعال</strong>
                <small>با Undo قابل بازگشت است</small>
              </span>
            </button>
          </div>
        ) : null}
      </div>
      {replace && (
        <div className="dialog-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replace-title"
          >
            <AlertTriangle />
            <h2 id="replace-title">خروجی پُر است</h2>
            <p>
              این پورت فقط یک اتصال می‌پذیرد. اتصال فعلی حذف و اتصال جدید
              جایگزین شود؟
            </p>
            <code>
              {replace.edge.source} → {replace.edge.target}
            </code>
            <div>
              <button
                className="secondary-button"
                onClick={() => setReplace(undefined)}
              >
                انصراف
              </button>
              <button className="danger-button" onClick={confirmReplace}>
                جایگزینی اتصال
              </button>
            </div>
          </section>
        </div>
      )}
      {confirmClear && (
        <div className="dialog-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <Trash2 />
            <h2 id="clear-title">بوم سرور فعال پاک شود؟</h2>
            <p>
              فقط نودهای سرور{" "}
              {project.activeServer === "iran" ? "ایران" : "خارج"} حذف می‌شوند و
              با Undo قابل بازیابی‌اند.
            </p>
            <div>
              <button
                className="secondary-button"
                onClick={() => setConfirmClear(false)}
              >
                انصراف
              </button>
              <button className="danger-button" onClick={clearActiveGraph}>
                پاک‌کردن
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

/**
 * A port declares a layer that may be "any"; the solver works out what it
 * actually resolves to on this graph. Empty means undetermined — draw nothing
 * rather than guess.
 */
function layerBadge(resolved?: { prev: number; next: number }) {
  if (!resolved) return undefined;
  const label = (domain: number) =>
    domain === L3 ? "L3" : domain === L4 ? "L4" : undefined;
  const prev = label(resolved.prev);
  const next = label(resolved.next);
  return prev || next ? { prev, next } : undefined;
}

function nodeCategoryIcon(category: string) {
  if (category === "transport") return <Cable />;
  if (category === "protocol") return <Network />;
  if (category === "security") return <ShieldCheck />;
  if (category === "routing") return <Route />;
  if (category === "adapter") return <Shuffle />;
  return <Wrench />;
}

function Palette({
  advanced,
  onAdd,
}: {
  advanced: boolean;
  onAdd: (type: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [recentlyAdded, setRecentlyAdded] = useState<string>();
  const feedbackTimer = useRef<number | undefined>(undefined);
  const [activeCategory, setCategory] =
    useState<(typeof NODE_CATEGORIES)[number]["id"]>("transport");
  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const addWithFeedback = (type: string) => {
    onAdd(type);
    setRecentlyAdded(type);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(
      () => setRecentlyAdded(undefined),
      1400,
    );
  };
  /**
   * Simple mode sorts, it does not hide. Unreal Blueprints filters by pin type
   * — by context — never by how experienced it thinks you are, and a palette
   * that silently omits 41 of 73 nodes leaves a beginner unable to build the
   * topology they were told to build. Everything is present; the approachable
   * ones lead.
   */
  const availableNodes = advanced
    ? schema.nodes
    : [...schema.nodes].sort((a, b) => {
        const rank = (type: string) => (SIMPLE_NODE_TYPES.has(type) ? 0 : 1);
        return rank(a.type) - rank(b.type) || a.type.localeCompare(b.type);
      });
  const items = availableNodes.filter(
    (node) =>
      (activeCategory === "all" ||
        nodeCategory(node.type) === activeCategory) &&
      `${node.type} ${node.descriptionFa}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const groups = items.reduce<Map<string, typeof items>>((map, item) => {
    const group = nodeCategory(item.type);
    map.set(group, [...(map.get(group) ?? []), item]);
    return map;
  }, new Map());
  return (
    <div className="palette">
      <div className="panel-heading">
        <div>
          <h2>نودها</h2>
          <small>
            {advanced ? "فهرست کامل schema" : "گزینه‌های مناسب برای شروع"}
          </small>
        </div>
      </div>
      <label className="search-field">
        <Search />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value) setCategory("all");
          }}
          placeholder="نام یا کاربرد نود…"
        />
        <span className="sr-only">جستجوی نود</span>
      </label>
      <div className="category-chips" role="list" aria-label="دسته‌بندی نودها">
        {NODE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            className={activeCategory === item.id ? "active" : ""}
            onClick={() => setCategory(item.id)}
          >
            <span className="category-chip-icon" aria-hidden="true">
              {item.id === "all" ? <Boxes /> : nodeCategoryIcon(item.id)}
            </span>
            <span className="category-chip-label">{item.short}</span>
            <b>
              {item.id === "all"
                ? availableNodes.length
                : availableNodes.filter(
                    (node) => nodeCategory(node.type) === item.id,
                  ).length}
            </b>
          </button>
        ))}
      </div>
      {NODE_CATEGORIES.filter((item) => item.id !== "all").map((item) => {
        const groupNodes = groups.get(item.id) ?? [];
        if (!groupNodes.length) return null;
        return (
          <section key={item.id}>
            <h3>
              {categoryLabel(item.id)} <span>{groupNodes.length}</span>
            </h3>
            {groupNodes
              .slice(0, advanced || activeCategory !== "all" ? 100 : 5)
              .map((node) => {
                const exp = nodeExperience(node);
                const category = nodeCategory(node.type);
                return (
                  <button
                    className="palette-node"
                    key={node.type}
                    onClick={() => addWithFeedback(node.type)}
                  >
                    <span className={`palette-kind kind-${category}`}>
                      {nodeCategoryIcon(category)}
                      <i
                        className={`layer-${node.outputs[0]?.layer ?? node.inputs[0]?.layer ?? "any"}`}
                      />
                    </span>
                    <span className="palette-node-text">
                      <strong>{node.type}</strong>
                      <small title={exp.purpose || node.descriptionFa}>
                        {exp.purpose || node.descriptionFa}
                      </small>
                    </span>
                    <span
                      className={`palette-add-btn ${recentlyAdded === node.type ? "is-added" : ""}`}
                      aria-live="polite"
                    >
                      {recentlyAdded === node.type ? (
                        <>
                          <CheckCircle2 />
                          <span className="sr-only">اضافه شد</span>
                        </>
                      ) : (
                        <Plus />
                      )}
                    </span>
                  </button>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
function EdgeInspector({
  edge,
  nodes,
  step,
}: {
  edge: StudioEdge;
  nodes: StudioNode[];
  step?: SimulationStep;
}) {
  const source = nodes.find((node) => node.id === edge.source),
    target = nodes.find((node) => node.id === edge.target),
    matches = step?.edgeId === edge.id;
  const sourceDefinition = getDefinition(source?.data.type ?? "");
  const output = sourceDefinition.outputs.find(
    (port) => port.id === (edge.sourceHandle ?? "next"),
  );
  const experience = nodeExperience(sourceDefinition);
  const direction =
    edge.sourceHandle === "up"
      ? "رفت (up)"
      : edge.sourceHandle === "down"
        ? "برگشت (down)"
        : "ادامه مسیر";
  return (
    <section className="edge-inspector">
      <h3>بازرس اتصال</h3>
      <div className="edge-route">
        <code>{source?.data.name}</code>
        <span>→ {edge.sourceHandle ?? "next"} →</span>
        <code>{target?.data.name}</code>
      </div>
      <div className="edge-facts">
        <span>
          <small>جهت</small>
          <strong>{direction}</strong>
        </span>
        <span>
          <small>لایه</small>
          <strong>{portLabel(output?.layer ?? "any")}</strong>
        </span>
        <span>
          <small>رخداد</small>
          <strong>{matches ? step.event : "در انتظار اجرا"}</strong>
        </span>
        <span>
          <small>عملیات نود قبلی</small>
          <strong>{experience.role}</strong>
        </span>
      </div>
      <p className="edge-operation">{experience.purpose}</p>
      {matches ? (
        <div className="before-after">
          <pre>{JSON.stringify(step.before, null, 2)}</pre>
          <span>→</span>
          <pre>{JSON.stringify(step.after, null, 2)}</pre>
        </div>
      ) : (
        <p>
          مشخصات مسیر همین حالا قابل مشاهده است؛ برای دیدن داده قبل و بعد،
          شبیه‌ساز را تا این اتصال اجرا کنید.
        </p>
      )}
    </section>
  );
}
function midpoint(a?: StudioNode, b?: StudioNode) {
  return {
    x: ((a?.position.x ?? 0) + (b?.position.x ?? 360)) / 2,
    y: ((a?.position.y ?? 0) + (b?.position.y ?? 180)) / 2,
  };
}
function nextLooseNodePosition(nodes: StudioNode[]) {
  if (!nodes.length) return { x: 120, y: 100 };
  const rightmost = nodes.reduce((best, node) =>
    node.position.x > best.position.x ? node : best,
  );
  return { x: rightmost.position.x + 300, y: rightmost.position.y };
}
function canInsert(
  item: RankedSuggestion,
  edge: StudioEdge | undefined,
  nodes: StudioNode[],
  edges: StudioEdge[],
) {
  if (!edge) return false;
  const source = nodes.find((n) => n.id === edge.source),
    target = nodes.find((n) => n.id === edge.target);
  if (
    !source ||
    !target ||
    !item.definition.inputs[0] ||
    !item.definition.outputs[0]
  )
    return false;
  const probe: StudioNode = {
    id: "__probe__",
    type: "waterwall",
    position: { x: 0, y: 0 },
    data: {
      type: item.definition.type,
      name: "probe",
      settings: {},
      definition: item.definition,
    },
  };
  const without = edges.filter((e) => e.id !== edge.id);
  return (
    checkConnection(
      {
        source: source.id,
        target: probe.id,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: item.definition.inputs[0].id,
      },
      [...nodes, probe],
      without,
    ).valid &&
    checkConnection(
      {
        source: probe.id,
        target: target.id,
        sourceHandle: item.definition.outputs[0].id,
        targetHandle: edge.targetHandle ?? null,
      },
      [...nodes, probe],
      without,
    ).valid
  );
}
