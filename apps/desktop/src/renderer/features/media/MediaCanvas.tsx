import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import type { ConfiguredModelSummary, MediaAsset, MediaCropRect, MediaImageParameters, MediaInlineImage, MediaOperation, MediaOperationKind, MediaProject, MediaViewAngle } from "@wordless/domain";
import { ArrowLeft, Check, ChevronLeft, Copy, Download, Expand, Eye, Hand, ImagePlus, LoaderCircle, Maximize2, Minimize2, MousePointer2, Plus, RefreshCw, Send, Trash2, Upload, Video, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import type { MessageKey } from "../../shared/i18n";
import { useRuntime } from "../../shared/runtime";
import { ImageCropEditor, ImageMaskEditor, ImagePreviewDialog, MultiViewPanel } from "./MediaEditors";
import { MediaAssetDock } from "./MediaAssetDock";
import { MediaComposer, type ComposerValue } from "./MediaComposer";
import { mediaOperationDefinition, mediaOperationDefinitions, mediaOperationUnavailableReason, type MediaOperationDefinition } from "./media-operations";
import { ProviderIcon } from "../settings/provider-icons";

type Locale = "zh-CN" | "en-US";
type AssetAction = Exclude<MediaOperationKind, "upload" | "generate">;
const assetOperationDefinitions = mediaOperationDefinitions.filter((definition): definition is MediaOperationDefinition & { id: AssetAction } => definition.id !== "generate");

type AssetNodeData = {
  asset: MediaAsset;
  isCover: boolean;
  locale: Locale;
  multiViewOpen: boolean;
  operation: MediaOperation;
  models: ConfiguredModelSummary[];
  preferredActionModelKey: string;
  initialPromptValue: ComposerValue;
  pendingAction: AssetAction | null;
  promptBusy: boolean;
  onAction: (action: AssetAction) => void;
  onCancelAction: () => void;
  onCreateFromReference: () => void;
  onModelChange: (modelKey: string) => void;
  onOpenModels: () => void;
  onSelectActionModel: (modelKey: string) => void;
  onSubmitPrompt: (value: ComposerValue) => void;
  onDownload: () => void;
  onCloseMultiView: () => void;
  onConfirmMultiView: (views: MediaViewAngle[], prompt: string) => void;
  onImageLoad: (assetId: string, pixelWidth: number, pixelHeight: number) => void;
  onPreview: () => void;
  onSetCover: () => void;
};

type AssetFlowNode = Node<AssetNodeData, "asset">;
type ReferenceComposerData = { asset: MediaAsset; busy: boolean; initialValue: ComposerValue; locale: Locale; models: ConfiguredModelSummary[]; onCancel: () => void; onModelChange: (modelKey: string) => void; onOpenModels: () => void; onSubmit: (value: ComposerValue) => void; onUpload: () => void };
type ReferenceComposerFlowNode = Node<ReferenceComposerData, "reference-composer">;
type CanvasNode = AssetFlowNode | ReferenceComposerFlowNode;
type RelationEdge = Edge<{ kind: MediaOperationKind; label: string }>;
type ReferenceComposerState = { assetId: string; id: string; position: { x: number; y: number } };

type MediaNodeContextMenu = {
  asset: MediaAsset;
  x: number;
  y: number;
};

type EditorState =
  | { type: "crop"; asset: MediaAsset }
  | { type: "local-edit" | "remove-object"; asset: MediaAsset }
  | { type: "multi-view"; asset: MediaAsset }
  | null;

type MediaCanvasProps = { fullscreen: boolean; leftOpen: boolean; onBackToLibrary: () => void; onOpenModels: () => void; onToggleFullscreen: () => void; onToggleLeft: () => void; sessionId: string };

const nodeTypes = { asset: ImageAssetNode, "reference-composer": ReferenceImageComposerNode };
const edgeTypes = { relation: MediaRelationEdge };
const emptyComposerValue: ComposerValue = { prompt: "", modelKey: "", ratio: "16:9", outputCount: 1 };

export function MediaCanvas({ fullscreen, leftOpen, onBackToLibrary, onOpenModels, onToggleFullscreen, onToggleLeft, sessionId }: MediaCanvasProps) {
  const { client, snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const [project, setProject] = useState<MediaProject | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [pendingAction, setPendingAction] = useState<{ assetId: string; action: AssetAction } | null>(null);
  const [referenceComposers, setReferenceComposers] = useState<ReferenceComposerState[]>([]);
  const [selectedReferenceComposerId, setSelectedReferenceComposerId] = useState<string | null>(null);
  const [promptSubmittingAssetId, setPromptSubmittingAssetId] = useState<string | null>(null);
  const [standaloneComposerOpen, setStandaloneComposerOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [cropSource, setCropSource] = useState<MediaInlineImage | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [mediaContextMenu, setMediaContextMenu] = useState<MediaNodeContextMenu | null>(null);
  const [copiedAssetId, setCopiedAssetId] = useState<string | null>(null);
  const [renamingProjectTitle, setRenamingProjectTitle] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, RelationEdge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges] = useEdgesState<RelationEdge>([]);
  const [interactionMode, setInteractionMode] = useState<"select" | "pan">("select");
  const [zoomPercent, setZoomPercent] = useState(78);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<MediaProject | null>(null);
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const lastCanvasPositionRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 0.78 });
  const nodesRef = useRef<CanvasNode[]>([]);
  const viewportSaveTimerRef = useRef<number | null>(null);
  const viewportSaveVersionRef = useRef(0);
  const layoutSaveVersionRef = useRef(0);
  const imageModels = useMemo(() => snapshot?.modelConfiguration.models.filter((model) => model.kind === "image" && model.enabled) ?? [], [snapshot?.modelConfiguration.models]);
  const selectedModel = imageModels.find((model) => `${model.providerId}:${model.modelId}` === selectedModelKey);

  const loadProject = useCallback(async () => {
    if (!client) return;
    const next = await client.getMediaProject(sessionId);
    projectRef.current = next;
    setProject(next);
    viewportRef.current = next.viewport;
    setZoomPercent(Math.round(next.viewport.zoom * 100));
  }, [client, sessionId]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => { void loadProject().catch((cause) => setError(errorMessage(cause))); }, [loadProject]);
  useEffect(() => {
    if (!renamingProjectTitle) return;
    const frame = window.requestAnimationFrame(() => {
      projectTitleInputRef.current?.focus();
      projectTitleInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renamingProjectTitle]);
  useEffect(() => {
    const close = () => setMediaContextMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!client) return;
    return client.subscribe((event) => {
      if (event.event.type === "media.project.changed" && event.event.sessionId === sessionId && event.event.source !== "viewport") void loadProject().catch((cause) => setError(errorMessage(cause)));
    });
  }, [client, loadProject, sessionId]);
  useEffect(() => {
    let disposed = false;
    if (!client || editor?.type !== "crop") {
      setCropSource(null);
      return;
    }
    setCropSource(null);
    void client.readMediaAssetData(sessionId, editor.asset.id).then((image) => {
      if (!disposed) setCropSource(image);
    }).catch((cause) => {
      if (!disposed) setError(errorMessage(cause));
    });
    return () => { disposed = true; };
  }, [client, editor, sessionId]);

  const beginProjectRename = useCallback(() => {
    if (!project) return;
    setProjectTitle(project.title);
    setRenamingProjectTitle(true);
  }, [project]);

  const saveProjectRename = useCallback(async () => {
    const title = projectTitle.trim();
    if (!title) {
      setError(t("mediaCanvasNameRequired"));
      return;
    }
    if (!client) return;
    try {
      await client.renameSession(sessionId, title);
      await loadProject();
      setRenamingProjectTitle(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [client, loadProject, locale, projectTitle, sessionId]);

  const submitIndependentPrompt = useCallback(async (asset: MediaAsset, value: ComposerValue) => {
    if (!client) return;
    const model = imageModels.find((candidate) => `${candidate.providerId}:${candidate.modelId}` === value.modelKey);
    if (!model) { onOpenModels(); return; }
    const unavailable = mediaOperationUnavailableReason(mediaOperationDefinition("generate"), model, locale);
    if (unavailable) { setError(unavailable); return; }
    setSelectedModelKey(`${model.providerId}:${model.modelId}`);
    setError(null);
    setPromptSubmittingAssetId(asset.id);
    try {
      const next = await client.startMediaOperation({ sessionId, action: "generate", parentAssetIds: [], referenceAssetIds: [], providerId: model.providerId, modelId: model.modelId, prompt: value.prompt, ratio: value.ratio, outputCount: value.outputCount, ...(value.imageParameters ? { imageParameters: value.imageParameters } : {}), targetPosition: independentPosition(asset) });
      setProject(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPromptSubmittingAssetId((current) => current === asset.id ? null : current);
    }
  }, [client, imageModels, locale, onOpenModels, sessionId]);

  const submitReferencedPrompt = useCallback(async (asset: MediaAsset, draft: ReferenceComposerState | undefined, value: ComposerValue) => {
    if (!client) return;
    const model = imageModels.find((candidate) => `${candidate.providerId}:${candidate.modelId}` === value.modelKey);
    if (!model) { onOpenModels(); return; }
    const unavailable = mediaOperationUnavailableReason(mediaOperationDefinition("generate"), model, locale);
    if (unavailable) { setError(unavailable); return; }
    setSelectedModelKey(`${model.providerId}:${model.modelId}`);
    setError(null);
    setPromptSubmittingAssetId(asset.id);
    try {
      const existingAssetIds = new Set(projectRef.current?.assets.map((candidate) => candidate.id) ?? []);
      const next = await client.startMediaOperation({ sessionId, action: "generate", parentAssetIds: [], referenceAssetIds: [asset.id], providerId: model.providerId, modelId: model.modelId, prompt: value.prompt, ratio: value.ratio, outputCount: value.outputCount, ...(value.imageParameters ? { imageParameters: value.imageParameters } : {}), targetPosition: draft?.position ?? childPosition(asset) });
      setProject(next);
      if (draft) {
        const generatedAsset = next.assets.find((candidate) => !existingAssetIds.has(candidate.id));
        setReferenceComposers((current) => current.filter((candidate) => candidate.id !== draft.id));
        setSelectedReferenceComposerId((current) => current === draft.id ? null : current);
        setSelectedAssetId(generatedAsset?.id ?? null);
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPromptSubmittingAssetId((current) => current === asset.id ? null : current);
    }
  }, [client, imageModels, locale, onOpenModels, sessionId]);

  const submitStandalonePrompt = useCallback(async (value: ComposerValue) => {
    if (!client) return;
    const model = imageModels.find((candidate) => `${candidate.providerId}:${candidate.modelId}` === value.modelKey);
    if (!model) { onOpenModels(); return; }
    const unavailable = mediaOperationUnavailableReason(mediaOperationDefinition("generate"), model, locale);
    if (unavailable) { setError(unavailable); return; }
    const target = flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 120, y: 110 };
    setSelectedModelKey(`${model.providerId}:${model.modelId}`);
    setError(null);
    try {
      const next = await client.startMediaOperation({ sessionId, action: "generate", parentAssetIds: [], referenceAssetIds: [], providerId: model.providerId, modelId: model.modelId, prompt: value.prompt, ratio: value.ratio, outputCount: value.outputCount, ...(value.imageParameters ? { imageParameters: value.imageParameters } : {}), targetPosition: target });
      setProject(next);
      setStandaloneComposerOpen(false);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, flow, imageModels, locale, onOpenModels, sessionId]);

  const runMaskOperation = useCallback(async (action: "local-edit" | "remove-object", asset: MediaAsset, mask: MediaInlineImage, prompt: string) => {
    if (!client || !selectedModel) { onOpenModels(); return; }
    const unavailable = mediaOperationUnavailableReason(mediaOperationDefinition(action), selectedModel, locale);
    if (unavailable) { setError(unavailable); return; }
    try {
      await client.startMediaOperation({ sessionId, action, parentAssetIds: [asset.id], referenceAssetIds: [], providerId: selectedModel.providerId, modelId: selectedModel.modelId, prompt: prompt.trim() || mediaOperationDefinition(action).defaultPrompt[locale], ratio: ratioForAsset(asset), outputCount: 1, targetPosition: childPosition(asset), mask });
      setEditor(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, locale, onOpenModels, selectedModel, sessionId]);

  const runMultiView = useCallback(async (asset: MediaAsset, views: MediaViewAngle[], prompt: string) => {
    if (!client || !selectedModel) { onOpenModels(); return; }
    try {
      await client.startMediaOperation({ sessionId, action: "multi-view", parentAssetIds: [asset.id], referenceAssetIds: [], providerId: selectedModel.providerId, modelId: selectedModel.modelId, prompt: prompt.trim() || mediaOperationDefinition("multi-view").defaultPrompt[locale], ratio: ratioForAsset(asset), outputCount: 1, targetPosition: childPosition(asset), views });
      setEditor(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, locale, onOpenModels, selectedModel, sessionId]);

  const runCrop = useCallback(async (asset: MediaAsset, crop: MediaCropRect, image: MediaInlineImage) => {
    if (!client) return;
    try {
      const next = await client.startMediaOperation({ sessionId, action: "crop", sourceAssetId: asset.id, crop, image, targetPosition: childPosition(asset) });
      setProject(next);
      setCropSource(null);
      setEditor(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, sessionId]);

  const handleAssetAction = useCallback((asset: MediaAsset, action: AssetAction) => {
    if (action === "crop") { setCropSource(null); setEditor({ type: "crop", asset }); return; }
    if (action === "local-edit" || action === "remove-object" || action === "multi-view") {
      const sourceOperation = project?.operations.find((operation) => operation.id === asset.operationId);
      const sourceModelKey = sourceOperation?.providerId && sourceOperation.modelId
        ? `${sourceOperation.providerId}:${sourceOperation.modelId}`
        : "";
      const sourceModel = imageModels.find((model) => `${model.providerId}:${model.modelId}` === sourceModelKey);
      if (sourceModel && mediaOperationUnavailableReason(mediaOperationDefinition(action), sourceModel, locale) === null) {
        setSelectedModelKey(sourceModelKey);
        setPendingAction(null);
        setError(null);
        setEditor({ type: action === "multi-view" ? "multi-view" : action, asset });
        return;
      }
    }
    setPendingAction({ assetId: asset.id, action });
    setError(null);
  }, [imageModels, locale, project]);

  const selectActionModel = useCallback(async (asset: MediaAsset, action: AssetAction, modelKey: string) => {
    const model = imageModels.find((candidate) => `${candidate.providerId}:${candidate.modelId}` === modelKey);
    if (!model || !client) return;
    const unavailable = mediaOperationUnavailableReason(mediaOperationDefinition(action), model, locale);
    if (unavailable) { setError(unavailable); return; }
    setSelectedModelKey(modelKey);
    setPendingAction(null);
    if (action === "local-edit" || action === "remove-object") { setEditor({ type: action, asset }); return; }
    if (action === "multi-view") { setEditor({ type: "multi-view", asset }); return; }
    if (action === "crop") return;
    try {
      const next = action === "remove-background"
        ? await client.startMediaOperation({ sessionId, action, parentAssetIds: [asset.id], referenceAssetIds: [], providerId: model.providerId, modelId: model.modelId, prompt: mediaOperationDefinition(action).defaultPrompt[locale], ratio: ratioForAsset(asset), outputCount: 1, targetPosition: childPosition(asset), preserveSubject: "object" })
        : await client.startMediaOperation({ sessionId, action, parentAssetIds: [asset.id], referenceAssetIds: [], providerId: model.providerId, modelId: model.modelId, prompt: mediaOperationDefinition(action).defaultPrompt[locale], ratio: ratioForAsset(asset), outputCount: 1, targetPosition: childPosition(asset) });
      setProject(next);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, imageModels, locale, sessionId]);

  const importFiles = useCallback(async (files: File[], position?: { x: number; y: number }) => {
    if (!client || files.length === 0) return;
    const target = position ?? flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 80, y: 80 };
    try {
      const next = await client.importMediaImages(sessionId, files, target);
      setProject(next);
      setSelectedAssetId(next.assets[next.assets.length - 1]?.id ?? null);
      setPendingAction(null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, flow, sessionId]);

  const openCanvasImportPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const downloadMediaAsset = useCallback(async (assetId: string) => {
    if (!client) return;
    try {
      await client.downloadMediaAsset(sessionId, assetId);
      setDownloadNotice(t("mediaImageDownloaded"));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, locale, sessionId]);

  useEffect(() => {
    if (!downloadNotice) return;
    const timeout = window.setTimeout(() => setDownloadNotice(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [downloadNotice]);

  const copyMediaNode = useCallback((assetId: string) => {
    if (project?.assets.find((asset) => asset.id === assetId)?.status !== "ready") {
      setError(t("mediaOnlyCopyCompleted"));
      return;
    }
    setCopiedAssetId(assetId);
    setMediaContextMenu(null);
  }, [locale, project]);

  const pasteCopiedMediaNode = useCallback(async () => {
    if (!client || !copiedAssetId) return;
    const target = lastCanvasPositionRef.current ?? flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 80, y: 80 };
    try {
      const next = await client.duplicateMediaAsset(sessionId, copiedAssetId, target);
      setProject(next);
      setSelectedAssetId(next.assets[next.assets.length - 1]?.id ?? null);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, copiedAssetId, flow, sessionId]);

  const deleteMediaNode = useCallback(async (assetId: string) => {
    if (!client) return;
    setMediaContextMenu(null);
    try {
      const next = await client.deleteMediaAsset(sessionId, assetId);
      setProject(next);
      setSelectedAssetId((current) => current === assetId ? null : current);
      setCopiedAssetId((current) => current === assetId ? null : current);
      setEditor((current) => current?.asset.id === assetId ? null : current);
      setPreviewAsset((current) => current?.id === assetId ? null : current);
      setPendingAction((current) => current?.assetId === assetId ? null : current);
      setReferenceComposers((current) => current.filter((draft) => draft.assetId !== assetId));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, sessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true']"))) return;
      const key = event.key.toLowerCase();
      if (key === "c" && selectedAssetId) {
        event.preventDefault();
        copyMediaNode(selectedAssetId);
      }
      if (key === "v" && copiedAssetId) {
        event.preventDefault();
        void pasteCopiedMediaNode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copiedAssetId, copyMediaNode, pasteCopiedMediaNode, selectedAssetId]);

  const resizeAssetToImage = useCallback((assetId: string, pixelWidth: number, pixelHeight: number) => {
    if (!client || pixelWidth < 1 || pixelHeight < 1) return;
    const currentProject = projectRef.current;
    const asset = currentProject?.assets.find((candidate) => candidate.id === assetId);
    if (!currentProject || !asset) return;
    const size = imageNodeSize(pixelWidth, pixelHeight);
    if (asset.width === size.width && asset.height === size.height) return;
    const assets = currentProject.assets.map((candidate) => candidate.id === assetId ? { ...candidate, ...size } : candidate);
    const nextProject = { ...currentProject, assets };
    projectRef.current = nextProject;
    setProject(nextProject);
    void client.updateMediaLayout({ sessionId, assets: [{ id: asset.id, x: asset.x, y: asset.y, ...size }] }).catch((cause) => {
      setError(errorMessage(cause));
      void loadProject().catch((reloadCause) => setError(errorMessage(reloadCause)));
    });
  }, [client, loadProject, sessionId]);

  const buildFlow = useCallback((value: MediaProject): { nodes: CanvasNode[]; edges: RelationEdge[] } => {
    const flowNodes: CanvasNode[] = value.assets.map((asset): AssetFlowNode => {
      const operation = value.operations.find((candidate) => candidate.id === asset.operationId) ?? fallbackOperation(asset);
      const storedPromptValue = promptValueForAsset(operation, imageModels, selectedModelKey, asset.origin === "uploaded");
      const sourceModelKey = operation.providerId && operation.modelId ? `${operation.providerId}:${operation.modelId}` : "";
      const preferredActionModelKey = imageModels.some((model) => `${model.providerId}:${model.modelId}` === selectedModelKey) ? selectedModelKey : sourceModelKey;
      return { id: asset.id, type: "asset", position: { x: asset.x, y: asset.y }, selected: selectedAssetId === asset.id, style: { width: asset.width, height: asset.height + 23 }, data: { asset, isCover: value.coverAssetId === asset.id, locale, multiViewOpen: editor?.type === "multi-view" && editor.asset.id === asset.id, operation, models: imageModels, preferredActionModelKey, initialPromptValue: storedPromptValue, pendingAction: pendingAction?.assetId === asset.id ? pendingAction.action : null, promptBusy: promptSubmittingAssetId === asset.id, onAction: (action) => handleAssetAction(asset, action), onCancelAction: () => setPendingAction(null), onCreateFromReference: () => { const id = crypto.randomUUID(); setPendingAction(null); setReferenceComposers((current) => [...current, { assetId: asset.id, id, position: childPosition(asset) }]); }, onModelChange: setSelectedModelKey, onOpenModels, onSelectActionModel: (modelKey) => void selectActionModel(asset, pendingAction?.assetId === asset.id ? pendingAction.action : "regenerate", modelKey), onSubmitPrompt: (value_) => void submitIndependentPrompt(asset, value_), onDownload: () => void downloadMediaAsset(asset.id), onCloseMultiView: () => setEditor(null), onConfirmMultiView: (views, prompt) => void runMultiView(asset, views, prompt), onImageLoad: resizeAssetToImage, onPreview: () => setPreviewAsset(asset), onSetCover: () => { if (client) void client.setMediaCoverAsset(sessionId, asset.id).catch((cause) => setError(errorMessage(cause))); } } };
    });
    const flowEdges: RelationEdge[] = [];
    for (const referenceComposer of referenceComposers) {
      const sourceAsset = value.assets.find((asset) => asset.id === referenceComposer.assetId);
      if (sourceAsset) {
        const sourceOperation = value.operations.find((operation) => operation.id === sourceAsset.operationId) ?? fallbackOperation(sourceAsset);
        const sourceValue = promptValueForAsset(sourceOperation, imageModels, selectedModelKey, sourceAsset.origin === "uploaded");
        const selected = selectedReferenceComposerId === referenceComposer.id;
        flowNodes.push({ dragHandle: ".reference-composer-drag-surface", draggable: true, id: referenceComposer.id, type: "reference-composer", position: referenceComposer.position, selected, style: { width: 600, height: selected ? 526 : 220 }, data: { asset: sourceAsset, busy: promptSubmittingAssetId === sourceAsset.id, initialValue: { ...sourceValue, prompt: "", ratio: ratioForAsset(sourceAsset), outputCount: 1, imageParameters: undefined }, locale, models: imageModels, onCancel: () => { setSelectedReferenceComposerId((current) => current === referenceComposer.id ? null : current); setReferenceComposers((current) => current.filter((draft) => draft.id !== referenceComposer.id)); }, onModelChange: setSelectedModelKey, onOpenModels, onSubmit: (value_) => void submitReferencedPrompt(sourceAsset, referenceComposer, value_), onUpload: openCanvasImportPicker } });
        flowEdges.push({ id: `reference-draft:${sourceAsset.id}:${referenceComposer.id}`, source: sourceAsset.id, target: referenceComposer.id, type: "relation", data: { kind: "generate", label: "" }, style: { stroke: "#8f9a73", strokeWidth: 1.3, strokeDasharray: "5 5" } });
      }
    }
    for (const operation of value.operations) {
      for (const input of operation.inputs) {
        for (const target of operation.outputAssetIds) {
          if (!value.assets.some((asset) => asset.id === input.assetId) || !value.assets.some((asset) => asset.id === target)) continue;
          flowEdges.push({ id: `${operation.id}:${input.assetId}:${target}`, source: input.assetId, target, type: "relation", data: { kind: operation.kind, label: operationLabel(operation.kind, locale, t) }, style: { stroke: input.role === "parent" ? "#8f9a73" : "#6d7d86", strokeWidth: 1.3, strokeDasharray: input.role === "reference" ? "5 5" : undefined } });
        }
      }
    }
    return { nodes: flowNodes, edges: flowEdges };
  }, [client, downloadMediaAsset, editor, handleAssetAction, imageModels, locale, pendingAction, promptSubmittingAssetId, referenceComposers, resizeAssetToImage, runMultiView, selectedAssetId, selectedModelKey, selectedReferenceComposerId, selectActionModel, sessionId, submitIndependentPrompt, submitReferencedPrompt]);

  useEffect(() => {
    if (!project) return;
    nodesRef.current = nodes;
  }, [nodes, project]);

  useEffect(() => () => {
    if (viewportSaveTimerRef.current !== null) window.clearTimeout(viewportSaveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!project) return;
    const next = buildFlow(project);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [buildFlow, project, setEdges, setNodes]);

  const persistLayout = useCallback(async (nextNodes: CanvasNode[]) => {
    if (!client || !project) return;
    const version = ++layoutSaveVersionRef.current;
    const assets = nextNodes.filter((node): node is AssetFlowNode => node.type === "asset").map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: node.data.asset.width, height: node.data.asset.height }));
    try {
      const nextProject = await client.updateMediaLayout({ sessionId, assets });
      if (version !== layoutSaveVersionRef.current) return;
      projectRef.current = nextProject;
      setProject(nextProject);
    } catch (cause) {
      if (version === layoutSaveVersionRef.current) setError(errorMessage(cause));
    }
  }, [client, project, sessionId]);

  const scheduleViewportSave = useCallback((viewport: Viewport) => {
    viewportRef.current = viewport;
    if (!client) return;
    if (viewportSaveTimerRef.current !== null) window.clearTimeout(viewportSaveTimerRef.current);
    const version = ++viewportSaveVersionRef.current;
    viewportSaveTimerRef.current = window.setTimeout(() => {
      viewportSaveTimerRef.current = null;
      const value = viewportRef.current;
      void client.updateMediaViewport({ sessionId, viewport: value }).catch((cause) => {
        if (version === viewportSaveVersionRef.current) setError(errorMessage(cause));
      });
    }, 400);
  }, [client, sessionId]);

  const handleNodeDragStop: OnNodeDrag<CanvasNode> = useCallback((_event, node, nextNodes) => {
    if (node.type === "reference-composer") setReferenceComposers((current) => current.map((draft) => draft.id === node.id ? { ...draft, position: node.position } : draft));
    void persistLayout(nextNodes);
  }, [persistLayout]);

  if (!project) return <div className="grid min-h-0 flex-1 place-items-center bg-background"><LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const empty = project.assets.length === 0;
  return <section className="relative flex min-w-0 flex-1 overflow-hidden bg-background">
    <header className="absolute inset-x-0 top-0 z-40 flex h-11 items-center justify-between border-b border-border/65 bg-background/92 px-3 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-1.5"><Tooltip><TooltipTrigger asChild><button aria-label={t("mediaBackToCanvasList")} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onBackToLibrary} type="button"><ArrowLeft className="h-4 w-4" /></button></TooltipTrigger><TooltipContent>{t("mediaBackToCanvasList")}</TooltipContent></Tooltip>{!leftOpen ? <button aria-label="Expand sidebar" className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" onClick={onToggleLeft} type="button"><ChevronLeft className="h-4 w-4" /></button> : null}{renamingProjectTitle ? <input aria-label={t("mediaCanvasName")} className="h-7 w-[min(240px,45vw)] rounded-[4px] border border-border bg-card px-2 text-[12px] font-semibold text-foreground outline-none focus:border-[#9cac70] focus:ring-2 focus:ring-[#e5eec8]" maxLength={120} onBlur={() => void saveProjectRename()} onChange={(event) => setProjectTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); setRenamingProjectTitle(false); } }} ref={projectTitleInputRef} value={projectTitle} /> : <button className="min-w-0 truncate rounded-[4px] px-1 text-left text-[12px] font-semibold text-foreground hover:bg-muted" onDoubleClick={beginProjectRename} title={t("mediaDoubleClickRename")} type="button">{project.title}</button>}</div>
      <div className="flex items-center gap-1"><CanvasButton icon={<RefreshCw className="h-3.5 w-3.5" />} label={t("mediaRefresh")} onClick={() => void loadProject()} /><CanvasButton icon={fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} label={fullscreen ? t("mediaExitFullscreen") : t("mediaEnterFullscreen")} onClick={onToggleFullscreen} /><CanvasButton icon={<Expand className="h-3.5 w-3.5" />} label={t("mediaFitCanvas")} onClick={() => void flow?.fitView({ duration: 180, padding: 0.18 })} /></div>
    </header>
    <div className="relative min-w-0 flex-1 pt-11" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const position = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }); void importFiles([...event.dataTransfer.files], position); }} onMouseMove={(event) => { const position = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }); if (position) lastCanvasPositionRef.current = position; }}>
      <ReactFlow className="media-flow bg-[#f3f3ef] dark:bg-[#11120f]" defaultViewport={project.viewport} edgeTypes={edgeTypes} edges={edges} elementsSelectable={interactionMode === "select"} maxZoom={2.2} minZoom={0.24} nodeTypes={nodeTypes} nodes={nodes} nodesDraggable={interactionMode === "select"} onInit={setFlow} onMove={(_event, viewport) => { viewportRef.current = viewport; setZoomPercent(Math.round(viewport.zoom * 100)); }} onMoveEnd={(_event, viewport) => { setZoomPercent(Math.round(viewport.zoom * 100)); scheduleViewportSave(viewport); }} onNodeClick={(_event, node) => { if (node.type === "asset") { setSelectedAssetId(node.id); setSelectedReferenceComposerId(null); setPendingAction(null); } else { setSelectedAssetId(null); setSelectedReferenceComposerId(node.id); } }} onNodeContextMenu={(event, node) => { event.preventDefault(); if (node.type === "asset") { setSelectedAssetId(node.id); setSelectedReferenceComposerId(null); setPendingAction(null); setMediaContextMenu({ asset: node.data.asset, x: event.clientX, y: event.clientY }); } }} onNodeDragStop={handleNodeDragStop} onNodesChange={onNodesChange} onPaneClick={() => { setSelectedAssetId(null); setSelectedReferenceComposerId(null); setPendingAction(null); setMediaContextMenu(null); }} panOnDrag={interactionMode === "pan" ? true : [1]} proOptions={{ hideAttribution: true }}>
        <Background className="text-[#c7c7c0] dark:text-[#3d4037]" color="currentColor" gap={18} size={1.35} variant={BackgroundVariant.Dots} />
      </ReactFlow>
      {empty ? <EmptyCanvas locale={locale} models={imageModels} onImport={openCanvasImportPicker} onModelChange={setSelectedModelKey} onOpenModels={onOpenModels} onSubmit={submitStandalonePrompt} selectedModelKey={selectedModelKey} /> : null}
      {standaloneComposerOpen && !empty ? <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center px-8"><div className="pointer-events-auto"><MediaComposer action="generate" initialValue={{ ...emptyComposerValue, modelKey: selectedModelKey }} locale={locale} models={imageModels} onCancel={() => setStandaloneComposerOpen(false)} onModelChange={setSelectedModelKey} onOpenModels={onOpenModels} onRemoveReference={() => undefined} onSubmit={submitStandalonePrompt} references={[]} variant="root" /></div></div> : null}
      <CanvasActionRail interactionMode={interactionMode} locale={locale} onAddImage={() => setStandaloneComposerOpen(true)} onFit={() => void flow?.fitView({ duration: 180, padding: 0.18 })} onImport={openCanvasImportPicker} onInteractionMode={setInteractionMode} />
      <MediaAssetDock assets={project.assets} locale={locale} onSelect={(assetId) => { setSelectedAssetId(assetId); setPendingAction(null); const asset = project.assets.find((candidate) => candidate.id === assetId); if (asset && flow) void flow.setCenter(asset.x + asset.width / 2, asset.y + asset.height / 2, { duration: 180, zoom: Math.max(flow.getZoom(), 0.72) }); }} operations={project.operations} selectedAssetId={selectedAssetId} />
      <CanvasZoomControl locale={locale} percent={zoomPercent} onDecrease={() => void flow?.zoomOut({ duration: 120 })} onIncrease={() => void flow?.zoomIn({ duration: 120 })} />
      <input accept="image/png,image/jpeg,image/webp" className="hidden" multiple onChange={(event) => { void importFiles([...event.target.files ?? []]); event.target.value = ""; }} ref={fileInputRef} type="file" />
      {mediaContextMenu ? <div className="fixed z-[100] w-[136px] rounded-[7px] border border-border bg-card py-1 text-[11px] text-foreground shadow-[0_8px_18px_rgba(0,0,0,.16)]" onPointerDown={(event) => event.stopPropagation()} style={{ left: mediaContextMenu.x, top: mediaContextMenu.y }}><button className="flex h-7 w-full items-center gap-2 px-2.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40" disabled={mediaContextMenu.asset.status !== "ready"} onClick={() => copyMediaNode(mediaContextMenu.asset.id)} type="button"><Copy className="h-3.5 w-3.5" />{t("mediaCopyNode")}</button><button className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300" disabled={mediaContextMenu.asset.status === "rendering"} onClick={() => void deleteMediaNode(mediaContextMenu.asset.id)} type="button"><Trash2 className="h-3.5 w-3.5" />{t("mediaDeleteNode")}</button></div> : null}
      {error ? <div className="absolute bottom-4 left-4 z-50 flex max-w-[420px] items-start gap-2 rounded-[7px] border border-red-500/25 bg-card px-3 py-2 text-[10px] leading-4 text-red-600 shadow-lg dark:text-red-300"><span className="min-w-0 flex-1">{error}</span><button aria-label="Dismiss" onClick={() => setError(null)} type="button"><X className="h-3.5 w-3.5" /></button></div> : null}
      {downloadNotice ? <DownloadNotice locale={locale} onDismiss={() => setDownloadNotice(null)} /> : null}
      {editor?.type === "crop" && cropSource ? <ImageCropEditor asset={editor.asset} locale={locale} onCancel={() => { setCropSource(null); setEditor(null); }} onConfirm={(crop, image) => void runCrop(editor.asset, crop, image)} source={cropSource} /> : null}
      {editor?.type === "crop" && !cropSource ? <div className="absolute inset-0 z-[100] grid place-items-center bg-[#11120f]/95"><LoaderCircle className="h-5 w-5 animate-spin text-[#ccf257]" /></div> : null}
      {editor?.type === "local-edit" || editor?.type === "remove-object" ? <ImageMaskEditor action={editor.type} asset={editor.asset} initialPrompt={editor.type === "remove-object" ? "" : mediaOperationDefinition(editor.type).defaultPrompt[locale]} locale={locale} onCancel={() => setEditor(null)} onConfirm={(mask, prompt) => void runMaskOperation(editor.type, editor.asset, mask, prompt)} title={mediaOperationDefinition(editor.type).label[locale]} /> : null}
      <ImagePreviewDialog asset={previewAsset} onOpenChange={(open) => { if (!open) setPreviewAsset(null); }} open={previewAsset !== null} />
    </div>
  </section>;
}

function DownloadNotice({ locale, onDismiss }: { locale: Locale; onDismiss: () => void }) {
  const { t } = usePreferences();
  return <div aria-live="polite" className="absolute right-4 top-4 z-50 flex w-[min(292px,calc(100%-2rem))] items-start gap-2.5 rounded-[8px] border border-[#a7bd68]/55 bg-card/95 px-3 py-2.5 text-foreground shadow-[0_12px_28px_rgba(32,38,22,.18)] backdrop-blur-sm">
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#edf3df] text-[#657b3e] dark:bg-[#2c3820] dark:text-[#c8e976]"><Check className="h-3.5 w-3.5" strokeWidth={2.4} /></span>
    <div className="min-w-0 flex-1 pt-px"><p className="text-[11px] font-semibold leading-4">{t("mediaDownloadComplete")}</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{t("mediaDownloadSaved")}</p></div>
    <button aria-label={t("mediaDismissDownload")} className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onDismiss} type="button"><X className="h-3.5 w-3.5" /></button>
  </div>;
}

function ImageAssetNode({ data, selected }: NodeProps<AssetFlowNode>) {
  const { t } = usePreferences();
  const { asset, locale, operation } = data;
  const ready = asset.status === "ready";
  const pendingDefinition = data.pendingAction ? mediaOperationDefinition(data.pendingAction) : null;
  const compatibleModels = pendingDefinition ? data.models.filter((model) => mediaOperationUnavailableReason(pendingDefinition, model, locale) === null) : [];
  return <article className="group relative h-full w-full overflow-visible">
    <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Left} type="target" />
    <Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Right} type="source" />
    {selected && ready ? <div className="nodrag nopan absolute -top-11 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[7px] border border-border bg-card p-1 shadow-[0_8px_22px_rgba(0,0,0,.16)]">{assetOperationDefinitions.map((definition) => { const hasCompatibleModel = definition.id === "crop" || data.models.some((model) => mediaOperationUnavailableReason(definition, model, locale) === null); const disabled = !hasCompatibleModel; const label = disabled ? data.models.length ? `${t("mediaNoModelSupports")}${definition.label[locale]}` : t("mediaConfigureModelFirst") : definition.label[locale]; const Icon = definition.icon; return <Tooltip key={definition.id}><TooltipTrigger asChild><button aria-label={definition.label[locale]} className="grid h-7 w-7 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35" disabled={disabled} onClick={(event) => { event.stopPropagation(); data.onAction(definition.id); }} type="button"><Icon className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>; })}<span className="mx-0.5 h-3 w-px bg-border" /><NodeAction icon={<Eye className="h-3.5 w-3.5" />} label={t("mediaPreview")} onClick={data.onPreview} /><NodeAction icon={<Download className="h-3.5 w-3.5" />} label={t("mediaDownload")} onClick={data.onDownload} /><NodeAction disabled={data.isCover} icon={<Check className="h-3.5 w-3.5" />} label={t("mediaSetCover")} onClick={data.onSetCover} /></div> : null}
    <div className={`relative h-[calc(100%-23px)] overflow-hidden rounded-[8px] border bg-muted transition-[border-color,box-shadow] ${selected ? "border-[#a7bd68] shadow-[0_0_0_2px_rgba(188,218,107,.2),0_12px_32px_rgba(0,0,0,.12)]" : "border-border hover:border-muted-foreground/55"}`}>{asset.url && ready ? <img alt={asset.name} className="h-full w-full object-contain" draggable={false} onLoad={(event) => data.onImageLoad(asset.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} src={asset.url} /> : asset.status === "rendering" ? <GeneratingNode asset={asset} operation={operation} /> : <FailedNode message={asset.errorMessage} />}{data.isCover ? <span className="absolute left-2 top-2 rounded-[4px] bg-black/75 px-1.5 py-0.5 font-mono text-[8px] tracking-[.08em] text-[#d8f478]">COVER</span> : null}<button aria-label={asset.name} className="absolute inset-0" type="button" /></div>
    <div className="mt-1.5 flex items-center justify-between gap-2 px-0.5 font-mono text-[8px] text-muted-foreground"><span className="min-w-0 truncate">{asset.name}</span><span className="shrink-0">{operation.modelId ?? (asset.origin === "uploaded" ? "UPLOAD" : "LOCAL")}</span></div>
    {selected && ready ? <Tooltip><TooltipTrigger asChild><button aria-label={t("mediaGenerateReference")} className="nodrag nopan absolute -right-12 top-[calc(50%-22px)] grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md hover:border-[#a8bd69] hover:text-foreground" onClick={(event) => { event.stopPropagation(); data.onCreateFromReference(); }} type="button"><Plus className="h-4 w-4" /></button></TooltipTrigger><TooltipContent>{t("mediaGenerateReference")}</TooltipContent></Tooltip> : null}
    {selected && ready && data.multiViewOpen ? <div className="nodrag nopan absolute left-1/2 top-[calc(100%+10px)] z-[90] -translate-x-1/2"><MultiViewPanel asset={asset} locale={locale} onCancel={data.onCloseMultiView} onConfirm={data.onConfirmMultiView} /></div> : selected && ready && data.pendingAction && pendingDefinition ? <div className="nodrag nopan absolute left-1/2 top-[calc(100%+10px)] z-[90] -translate-x-1/2"><NodeActionModelPicker definition={pendingDefinition} key={`${asset.id}:${data.pendingAction}`} locale={locale} models={compatibleModels} onCancel={data.onCancelAction} onSelect={data.onSelectActionModel} preferredModelKey={data.preferredActionModelKey} /></div> : selected && ready ? <div className="nodrag nopan absolute left-1/2 top-[calc(100%+10px)] z-[90] -translate-x-1/2"><MediaComposer action="generate" busy={data.promptBusy} initialValue={data.initialPromptValue} key={`${asset.id}:${operation.id}`} locale={locale} models={data.models} onModelChange={data.onModelChange} onOpenModels={data.onOpenModels} onRemoveReference={() => undefined} onSubmit={data.onSubmitPrompt} references={[]} variant="inline" /></div> : null}
  </article>;
}

function ReferenceImageComposerNode({ data, selected }: NodeProps<ReferenceComposerFlowNode>) {
  const { t } = usePreferences();
  return <div className="relative"><Handle className="!h-px !w-px !border-0 !bg-transparent" position={Position.Left} type="target" /><div className={`reference-composer-drag-surface relative flex h-[220px] cursor-grab items-center justify-center overflow-hidden rounded-[8px] border border-dashed bg-card/70 text-muted-foreground shadow-[0_10px_28px_rgba(0,0,0,.1)] active:cursor-grabbing dark:bg-card/40 ${selected ? "border-[#a7bd68] shadow-[0_0_0_2px_rgba(188,218,107,.2),0_10px_28px_rgba(0,0,0,.1)]" : "border-muted-foreground/45"}`}><button aria-label={t("mediaUploadAsset")} className="nodrag nopan flex h-10 items-center gap-2 rounded-[6px] border border-border bg-background px-3 text-[11px] font-medium text-foreground shadow-sm transition-colors hover:border-[#a8bd69] hover:bg-muted" onClick={data.onUpload} type="button"><Upload className="h-4 w-4 text-[#829553]" />{t("mediaUploadAsset")}</button></div>{selected ? <div className="mt-2"><MediaComposer action="generate" busy={data.busy} initialValue={data.initialValue} locale={data.locale} models={data.models} onCancel={data.onCancel} onModelChange={data.onModelChange} onOpenModels={data.onOpenModels} onRemoveReference={data.onCancel} onSubmit={data.onSubmit} references={[data.asset]} variant="inline" /></div> : null}</div>;
}

function NodeActionModelPicker({ definition, locale, models, onCancel, onSelect, preferredModelKey }: { definition: MediaOperationDefinition; locale: Locale; models: ConfiguredModelSummary[]; onCancel: () => void; onSelect: (modelKey: string) => void; preferredModelKey: string }) {
  const { t } = usePreferences();
  const Icon = definition.icon;
  const [modelKey, setModelKey] = useState(() => models.some((model) => `${model.providerId}:${model.modelId}` === preferredModelKey) ? preferredModelKey : models[0] ? `${models[0].providerId}:${models[0].modelId}` : "");
  return <section className="w-[310px] rounded-[8px] border border-[#575b51] bg-card p-2.5 text-card-foreground shadow-[0_16px_42px_rgba(0,0,0,.18)] dark:border-[#54584e]" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-[12px] font-medium"><Icon className="h-3.5 w-3.5 text-muted-foreground" /><span className="truncate">{definition.label[locale]}</span></span><button aria-label={t("mediaCancel")} className="grid h-6 w-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onCancel} type="button"><X className="h-3.5 w-3.5" /></button></div>{models.length ? <div className="flex gap-1.5"><Select onValueChange={setModelKey} value={modelKey || undefined}><SelectTrigger aria-label={t("mediaSelectModel")} className="h-8 min-w-0 flex-1 border-input bg-background px-2 text-[11px] shadow-none"><SelectValue placeholder={t("mediaSelectModel")} /></SelectTrigger><SelectContent className="max-h-64">{models.map((model) => <SelectItem key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}><span className="flex min-w-0 items-center gap-2"><ProviderIcon avatarId={model.providerAvatarId} className="h-3.5 w-3.5 shrink-0 object-contain" providerId={model.providerId} /><span className="min-w-0 truncate">{model.displayName}</span></span></SelectItem>)}</SelectContent></Select><button aria-label={definition.label[locale]} className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] bg-accent text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40" disabled={!modelKey} onClick={() => onSelect(modelKey)} title={definition.label[locale]} type="button"><Send className="h-3.5 w-3.5" /></button></div> : <p className="rounded-[5px] bg-muted px-2.5 py-2 text-[10px] leading-4 text-muted-foreground">{t("mediaNoModelForAction")}</p>}</section>;
}

function MediaRelationEdge(props: EdgeProps<RelationEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition, targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition, curvature: 0.34 });
  return <><BaseEdge id={props.id} path={path} style={props.style} /><path className="wordless-media-edge-glow-tail" d={path} fill="none" pathLength={1} /><path className="wordless-media-edge-glow-flow" d={path} fill="none" pathLength={1} /><path className="wordless-media-edge-glow-sheen" d={path} fill="none" pathLength={1} />{props.data?.kind !== "generate" ? <EdgeLabelRenderer><span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[4px] border border-border bg-card/92 px-1.5 py-0.5 font-mono text-[8px] text-muted-foreground shadow-sm" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{props.data?.label}</span></EdgeLabelRenderer> : null}</>;
}

function EmptyCanvas({ locale, models, onImport, onModelChange, onOpenModels, onSubmit, selectedModelKey }: { locale: Locale; models: ConfiguredModelSummary[]; onImport: () => void; onModelChange: (modelKey: string) => void; onOpenModels: () => void; onSubmit: (value: ComposerValue) => void; selectedModelKey: string }) {
  const { t } = usePreferences();
  return <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 px-8 pb-8"><button className="pointer-events-auto flex h-[180px] w-[min(560px,calc(100vw-7rem))] flex-col items-center justify-center rounded-[10px] border border-dashed border-muted-foreground/45 bg-card/45 text-center transition-colors hover:border-[#a9bf67] hover:bg-card/70" onClick={onImport} type="button"><span className="grid h-10 w-10 place-items-center rounded-[8px] border border-border bg-card text-[#7e9048]"><Upload className="h-4 w-4" /></span><p className="mt-4 text-[13px] font-semibold">{t("mediaUploadReference")}</p><p className="mt-1.5 text-[10px] text-muted-foreground">PNG, JPEG, WEBP · {t("mediaDropHint")}</p></button><div className="pointer-events-auto"><MediaComposer action="generate" initialValue={{ ...emptyComposerValue, modelKey: selectedModelKey }} locale={locale} models={models} onModelChange={onModelChange} onOpenModels={onOpenModels} onRemoveReference={() => undefined} onSubmit={onSubmit} references={[]} variant="root" /></div></div>;
}

function CanvasActionRail({ interactionMode, locale, onAddImage, onFit, onImport, onInteractionMode }: { interactionMode: "select" | "pan"; locale: Locale; onAddImage: () => void; onFit: () => void; onImport: () => void; onInteractionMode: (mode: "select" | "pan") => void }) {
  const { t } = usePreferences();
  return <div className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-[8px] border border-border bg-card p-1 shadow-[0_12px_30px_rgba(0,0,0,.16)]"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label={t("mediaAdd")} className="grid h-8 w-8 place-items-center rounded-[5px] bg-accent text-accent-foreground" type="button"><Plus className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" side="left" className="w-36"><DropdownMenuItem onClick={onAddImage}><ImagePlus className="h-3.5 w-3.5" />{t("mediaAddImage")}</DropdownMenuItem><DropdownMenuItem disabled><Video className="h-3.5 w-3.5" />{t("mediaAddVideo")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={onImport}><Upload className="h-3.5 w-3.5" />{t("mediaUpload")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu><span className="mx-1 my-0.5 h-px bg-border" /><CanvasButton active={interactionMode === "select"} icon={<MousePointer2 className="h-3.5 w-3.5" />} label={t("mediaSelectTool")} onClick={() => onInteractionMode("select")} /><CanvasButton active={interactionMode === "pan"} icon={<Hand className="h-3.5 w-3.5" />} label={t("mediaPanTool")} onClick={() => onInteractionMode("pan")} /><CanvasButton icon={<Expand className="h-3.5 w-3.5" />} label={t("mediaFitCanvas")} onClick={onFit} /></div>;
}

function CanvasZoomControl({ locale, onDecrease, onIncrease, percent }: { locale: Locale; onDecrease: () => void; onIncrease: () => void; percent: number }) {
  const { t } = usePreferences();
  return <div className="absolute bottom-4 left-1/2 z-30 flex h-8 -translate-x-1/2 items-center rounded-full border border-border bg-card/95 p-0.5 font-mono text-[10px] shadow-[0_8px_22px_rgba(0,0,0,.14)] backdrop-blur-sm"><button aria-label={t("mediaZoomOut")} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onDecrease} type="button"><span className="text-[15px] leading-none">−</span></button><span aria-label={t("mediaZoomCurrent")} className="min-w-[52px] px-1 text-center font-semibold text-foreground">{percent}%</span><button aria-label={t("mediaZoomIn")} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onIncrease} type="button"><Plus className="h-3.5 w-3.5" /></button></div>;
}

function CanvasButton({ active, icon, label, onClick }: { active?: boolean; icon: ReactNode; label: string; onClick: () => void }) { return <Tooltip><TooltipTrigger asChild><button aria-label={label} className={`grid h-8 w-8 place-items-center rounded-[5px] ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={onClick} type="button">{icon}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>; }
function NodeAction({ disabled, icon, label, onClick }: { disabled?: boolean; icon: ReactNode; label: string; onClick: () => void }) { return <Tooltip><TooltipTrigger asChild><button aria-label={label} className="grid h-7 w-7 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35" disabled={disabled} onClick={(event) => { event.stopPropagation(); onClick(); }} type="button">{icon}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>; }
function GeneratingNode({ asset, operation }: { asset: MediaAsset; operation: MediaOperation }) { const progress = Math.max(8, Math.round((operation.outputCount / operation.outputTotal) * 100)); return <div className="flex h-full flex-col justify-between p-4"><div className="flex justify-between font-mono text-[9px] text-muted-foreground"><span>GENERATING</span><span>{progress}%</span></div><div><div className="h-1 overflow-hidden rounded-full bg-border"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div><p className="mt-2 truncate font-mono text-[8px] text-muted-foreground">{asset.name} · {operation.modelId}</p></div></div>; }
function FailedNode({ message }: { message: string | null }) { return <div className="grid h-full place-items-center p-5 text-center text-red-500"><span><X className="mx-auto h-5 w-5" /><span className="mt-2 block line-clamp-3 font-mono text-[9px] leading-4">{message ?? "Generation failed"}</span></span></div>; }
function imageNodeSize(pixelWidth: number, pixelHeight: number) { const scale = 320 / Math.max(pixelWidth, pixelHeight); return { width: Math.round(Math.min(720, Math.max(160, pixelWidth * scale))), height: Math.round(Math.min(720, Math.max(120, pixelHeight * scale))) }; }
function ratioForAsset(asset: MediaAsset): string { const ratio = asset.width / asset.height; if (ratio > 1.6) return "16:9"; if (ratio > 1.15) return "4:3"; if (ratio < 0.78) return "9:16"; return "1:1"; }
function childPosition(asset: MediaAsset) { return { x: asset.x + asset.width + 160, y: asset.y }; }
function independentPosition(asset: MediaAsset) { return { x: asset.x + asset.width + 72, y: asset.y + asset.height + 72 }; }
function modelKeyForOperation(operation: MediaOperation, models: ConfiguredModelSummary[], fallbackKey: string) { const modelKey = operation.providerId && operation.modelId ? `${operation.providerId}:${operation.modelId}` : ""; return models.some((model) => `${model.providerId}:${model.modelId}` === modelKey) ? modelKey : fallbackKey; }
function imageParametersFromOperation(operation: MediaOperation): MediaImageParameters | undefined { const value = operation.parameters.imageParameters; return value && typeof value === "object" && !Array.isArray(value) ? value as MediaImageParameters : undefined; }
function promptValueForAsset(operation: MediaOperation, models: ConfiguredModelSummary[], selectedModelKey: string, useFirstModelFallback = false): ComposerValue { const fallbackModelKey = selectedModelKey || (useFirstModelFallback && models[0] ? `${models[0].providerId}:${models[0].modelId}` : ""); return { prompt: operation.prompt ?? "", modelKey: modelKeyForOperation(operation, models, fallbackModelKey), ratio: operation.ratio === "source" ? "16:9" : operation.ratio, outputCount: Math.max(1, operation.outputTotal || operation.outputCount || 1), imageParameters: imageParametersFromOperation(operation) }; }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function operationLabel(kind: MediaOperationKind, locale: Locale, t: (key: MessageKey) => string): string { return kind === "upload" ? t("mediaUpload") : mediaOperationDefinition(kind).label[locale]; }
function fallbackOperation(asset: MediaAsset): MediaOperation { return { id: asset.operationId, kind: asset.origin === "uploaded" ? "upload" : "generate", inputs: [], outputAssetIds: [asset.id], prompt: null, ratio: "source", outputCount: asset.status === "ready" ? 1 : 0, outputTotal: 1, providerId: null, modelId: null, parameters: {}, status: asset.status === "ready" ? "ready" : asset.status === "rendering" ? "rendering" : "failed", errorMessage: asset.errorMessage, createdAt: asset.createdAt, updatedAt: asset.updatedAt }; }
