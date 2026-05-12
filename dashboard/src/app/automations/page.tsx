"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  getAutomations,
  createAutomation,
  deleteAutomation,
  toggleAutomation,
  triggerAutomation,
  type AutomationRule,
  type AutomationCondition,
  type AutomationAction,
  type TriggerType,
  type ActionType,
} from "@/lib/api";
import {
  Lightning,
  DownloadSimple,
  Eye,
  Clock,
  WarningCircle,
  XCircle,
  ClosedCaptioning,
  Globe,
  Pause,
  Trash,
  Plus,
  X,
  CaretRight,
  Check,
  Play,
} from "@phosphor-icons/react";

// ── Label Maps ──────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  "torrent:completed": "Torrent Completes",
  "torrent:added": "Torrent Added",
  "torrent:error": "Torrent Error",
  "torrent:stalled": "Torrent Stalled",
  "watchlist:match": "Watchlist Match",
  "watchlist:search": "Watchlist Search",
  "subtitle:downloaded": "Subtitle Downloaded",
  "subtitle:translated": "Subtitle Translated",
  "schedule": "On Schedule",
};

const ACTION_LABELS: Record<ActionType, string> = {
  add_torrent: "Add Torrent",
  pause_torrent: "Pause Torrent",
  remove_torrent: "Remove Torrent",
  resume_torrent: "Resume Torrent",
  fetch_subtitles: "Fetch Subtitles",
  translate_subtitles: "Translate Subtitles",
  notify_webhook: "Send Webhook",
};

function triggerIcon(type: TriggerType) {
  switch (type) {
    case "torrent:completed":
    case "torrent:added":
    case "torrent:error":
    case "torrent:stalled":
      return DownloadSimple;
    case "watchlist:match":
    case "watchlist:search":
      return Eye;
    case "subtitle:downloaded":
    case "subtitle:translated":
      return ClosedCaptioning;
    case "schedule":
      return Clock;
    default:
      return Lightning;
  }
}

function actionIcon(type: ActionType) {
  switch (type) {
    case "add_torrent":
    case "resume_torrent":
      return DownloadSimple;
    case "pause_torrent":
      return Pause;
    case "remove_torrent":
      return Trash;
    case "fetch_subtitles":
      return ClosedCaptioning;
    case "translate_subtitles":
      return Globe;
    case "notify_webhook":
      return Lightning;
    default:
      return Lightning;
  }
}

const TRIGGER_OPTIONS: { type: TriggerType; label: string; description: string }[] = [
  { type: "torrent:completed", label: "Torrent Completes", description: "When a torrent finishes downloading" },
  { type: "torrent:added", label: "Torrent Added", description: "When a new torrent is added" },
  { type: "torrent:error", label: "Torrent Error", description: "When a torrent encounters an error" },
  { type: "torrent:stalled", label: "Torrent Stalled", description: "When a torrent stops making progress" },
  { type: "watchlist:match", label: "Watchlist Match", description: "When a watchlist entry finds a match" },
  { type: "watchlist:search", label: "Watchlist Search", description: "When a watchlist search runs" },
  { type: "subtitle:downloaded", label: "Subtitle Downloaded", description: "When subtitles are fetched" },
  { type: "subtitle:translated", label: "Subtitle Translated", description: "When subtitles are translated" },
  { type: "schedule", label: "On Schedule", description: "Run on a time-based schedule" },
];

const ACTION_OPTIONS: { type: ActionType; label: string; description: string }[] = [
  { type: "fetch_subtitles", label: "Fetch Subtitles", description: "Download subtitles for the torrent" },
  { type: "translate_subtitles", label: "Translate Subtitles", description: "Translate subtitles to another language" },
  { type: "pause_torrent", label: "Pause Torrent", description: "Pause the current torrent" },
  { type: "remove_torrent", label: "Remove Torrent", description: "Remove the torrent from the queue" },
  { type: "add_torrent", label: "Add Torrent", description: "Add a new torrent automatically" },
  { type: "resume_torrent", label: "Resume Torrent", description: "Resume a paused torrent" },
  { type: "notify_webhook", label: "Send Webhook", description: "Send a notification to a URL" },
];

const CONDITION_FIELDS = ["name", "size", "quality", "seeders", "mediaType"];
const CONDITION_OPERATORS = ["equals", "contains", "greater than", "less than"];

function formatTime(ts?: number): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

// ── Main Page ───────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await getAutomations();
      if (mountedRef.current) {
        setRules(res.rules);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error).message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const id = setInterval(fetchData, 10000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData]);

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        await toggleAutomation(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteAutomation(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleTrigger = useCallback(
    async (id: string) => {
      try {
        await triggerAutomation(id);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const handleCreate = useCallback(
    async (data: {
      name: string;
      triggerType: TriggerType;
      conditions?: AutomationCondition[];
      actions?: AutomationAction[];
      description?: string;
    }) => {
      try {
        await createAutomation(data);
        setShowCreateModal(false);
        setActionError(null);
        fetchData();
      } catch (err) {
        setActionError((err as Error).message);
      }
    },
    [fetchData],
  );

  const activeCount = rules.filter((r) => r.enabled).length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const triggeredToday = rules.filter(
    (r) => r.lastTriggeredAt && r.lastTriggeredAt >= todayStart.getTime(),
  ).length;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Automations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create rules to automate your downloads
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setActionError(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-automation text-automation-foreground rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Create Automation
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="px-4 py-3 rounded-xl bg-automation/10 border border-automation/20">
          <p className="text-xs font-medium text-muted-foreground">Total Rules</p>
          <p className="text-2xl font-bold mt-1">{rules.length}</p>
        </div>
        <div className="px-4 py-3 rounded-xl bg-automation/10 border border-automation/20">
          <p className="text-xs font-medium text-muted-foreground">Active</p>
          <p className="text-2xl font-bold mt-1 text-automation">{activeCount}</p>
        </div>
        <div className="px-4 py-3 rounded-xl bg-automation/10 border border-automation/20">
          <p className="text-xs font-medium text-muted-foreground">Triggered Today</p>
          <p className="text-2xl font-bold mt-1">{triggeredToday}</p>
        </div>
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="flex items-center justify-between px-4 py-2 text-sm border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400 rounded-lg">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <div className="h-4 w-4 animate-spin border-2 border-automation border-t-transparent rounded-full" />
          Loading automations...
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 text-sm text-automation underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : rules.length === 0 ? (
        <div className="py-16 text-center">
          <Lightning className="h-12 w-12 text-automation mx-auto mb-4" />
          <p className="text-lg font-medium">No automations yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create your first automation to get started
          </p>
          <button
            onClick={() => {
              setShowCreateModal(true);
              setActionError(null);
            }}
            className="inline-flex items-center gap-2 px-5 py-2.5 mt-6 text-sm font-medium bg-automation text-automation-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Create Automation
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rules.map((rule) => (
            <AutomationCard
              key={rule.id}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onTrigger={handleTrigger}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateAutomationModal
          onCreate={handleCreate}
          onClose={() => {
            setShowCreateModal(false);
            setActionError(null);
          }}
          error={actionError}
        />
      )}
    </div>
  );
}

// ── AutomationCard ──────────────────────────────────────────────────────

function AutomationCard({
  rule,
  onToggle,
  onDelete,
  onTrigger,
}: {
  rule: AutomationRule;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const TriggerIcon = triggerIcon(rule.triggerType);
  const firstAction = rule.actions[0];
  const FirstActionIcon = firstAction ? actionIcon(firstAction.type) : Lightning;

  return (
    <div
      className={`rounded-xl shadow-sm border bg-card text-card-foreground border-t-3 border-t-automation transition-all duration-200 hover:shadow-md ${
        !rule.enabled ? "opacity-60" : ""
      }`}
    >
      <div className="p-4 space-y-3">
        {/* Header: Name + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold truncate">{rule.name}</h3>
            {rule.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {rule.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onTrigger(rule.id)}
              title="Run manually"
              className="p-1.5 text-muted-foreground hover:text-automation transition-colors rounded-lg hover:bg-automation/10"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    onDelete(rule.id);
                    setConfirmDelete(false);
                  }}
                  className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded-md hover:opacity-90"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Delete"
                className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded-lg hover:bg-destructive/10"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Pipeline preview */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Trigger pill */}
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-torrent/15 text-torrent">
            <TriggerIcon className="h-3 w-3" />
            {TRIGGER_LABELS[rule.triggerType] ?? rule.triggerType}
          </span>

          <CaretRight className="h-3 w-3 text-muted-foreground shrink-0" />

          {/* Conditions pill */}
          {rule.conditions.length > 0 && (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                {rule.conditions.length} condition{rule.conditions.length !== 1 ? "s" : ""}
              </span>
              <CaretRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </>
          )}

          {/* Action pills */}
          {rule.actions.length > 0 ? (
            rule.actions.map((action, i) => {
              const Icon = actionIcon(action.type);
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-subtitle/15 text-subtitle"
                >
                  <Icon className="h-3 w-3" />
                  {ACTION_LABELS[action.type] ?? action.type}
                </span>
              );
            })
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-subtitle/15 text-subtitle">
              <FirstActionIcon className="h-3 w-3" />
              No actions
            </span>
          )}
        </div>

        {/* Footer: trigger count + toggle */}
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}
            </span>
            {rule.lastTriggeredAt && (
              <span className="hidden sm:inline" title={formatTime(rule.lastTriggeredAt)}>
                Last: {formatTime(rule.lastTriggeredAt)}
              </span>
            )}
          </div>

          {/* Toggle switch */}
          <button
            onClick={() => onToggle(rule.id)}
            role="switch"
            aria-checked={rule.enabled}
            aria-label={rule.enabled ? "Disable automation" : "Enable automation"}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-automation/50 focus:ring-offset-2 focus:ring-offset-card ${
              rule.enabled ? "bg-automation" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                rule.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Automation Modal ─────────────────────────────────────────────

function CreateAutomationModal({
  onCreate,
  onClose,
  error,
}: {
  onCreate: (data: {
    name: string;
    triggerType: TriggerType;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
    description?: string;
  }) => void;
  onClose: () => void;
  error: string | null;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerType | null>(null);
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [selectedActions, setSelectedActions] = useState<ActionType[]>([]);
  const [actionConfigs, setActionConfigs] = useState<Record<string, Record<string, unknown>>>({});
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const addCondition = () => {
    setConditions([...conditions, { field: "name", operator: "contains", value: "" }]);
  };

  const updateCondition = (i: number, patch: Partial<AutomationCondition>) => {
    const updated = [...conditions];
    updated[i] = { ...updated[i], ...patch };
    setConditions(updated);
  };

  const removeCondition = (i: number) => {
    setConditions(conditions.filter((_, idx) => idx !== i));
  };

  const toggleAction = (type: ActionType) => {
    if (selectedActions.includes(type)) {
      setSelectedActions(selectedActions.filter((a) => a !== type));
      const newConfigs = { ...actionConfigs };
      delete newConfigs[type];
      setActionConfigs(newConfigs);
    } else {
      setSelectedActions([...selectedActions, type]);
    }
  };

  const updateActionConfig = (type: ActionType, key: string, value: unknown) => {
    setActionConfigs({
      ...actionConfigs,
      [type]: { ...(actionConfigs[type] || {}), [key]: value },
    });
  };

  const handleSubmit = async () => {
    if (!selectedTrigger || !name.trim() || selectedActions.length === 0) return;
    setSubmitting(true);

    const actions: AutomationAction[] = selectedActions.map((type) => ({
      type,
      config: actionConfigs[type] || {},
    }));

    const validConditions = conditions.filter(
      (c) => c.field && c.operator && c.value !== "",
    );

    await onCreate({
      name: name.trim(),
      triggerType: selectedTrigger,
      conditions: validConditions.length > 0 ? validConditions : undefined,
      actions,
      description: description.trim() || undefined,
    });
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl border bg-card text-card-foreground rounded-xl shadow-lg animate-card-enter max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold">Create Automation</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 py-3 border-b">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => {
                if (s < step) setStep(s);
              }}
              disabled={s > step}
              className={`h-2.5 w-2.5 rounded-full transition-all duration-200 ${
                s === step
                  ? "bg-automation scale-110"
                  : s < step
                    ? "bg-muted-foreground/40 cursor-pointer hover:bg-muted-foreground/60"
                    : "border-2 border-muted-foreground/30 bg-transparent"
              }`}
              aria-label={`Step ${s}`}
            />
          ))}
          <span className="ml-3 text-xs text-muted-foreground">
            Step {step} of 3
          </span>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Step 1: Pick Trigger */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">When this happens...</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose an event that will start this automation
                </p>
              </div>

              {/* Name + Description */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Rule Name *
                  </label>
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Auto-fetch subtitles"
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-automation/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Description (optional)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this automation do?"
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-automation/50"
                  />
                </div>
              </div>

              {/* Trigger grid */}
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_OPTIONS.map((opt) => {
                  const Icon = triggerIcon(opt.type);
                  const selected = selectedTrigger === opt.type;
                  return (
                    <button
                      key={opt.type}
                      onClick={() => setSelectedTrigger(opt.type)}
                      className={`relative flex items-start gap-3 p-3 text-left rounded-lg border transition-all duration-150 ${
                        selected
                          ? "border-automation bg-automation/5 ring-1 ring-automation"
                          : "border-border hover:border-automation/40 hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`shrink-0 p-1.5 rounded-md ${
                          selected
                            ? "bg-automation/15 text-automation"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{opt.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                          {opt.description}
                        </p>
                      </div>
                      {selected && (
                        <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-automation" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2: Conditions */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Only if...</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add conditions to filter when this automation runs (optional)
                </p>
              </div>

              {conditions.length === 0 ? (
                <div className="py-6 text-center border border-dashed rounded-lg">
                  <WarningCircle className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    No conditions added. This automation will run for every matching event.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {conditions.map((cond, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30"
                    >
                      <select
                        value={cond.field}
                        onChange={(e) => updateCondition(i, { field: e.target.value })}
                        className="px-2 py-1.5 text-xs border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-automation/50"
                      >
                        {CONDITION_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        value={cond.operator}
                        onChange={(e) => updateCondition(i, { operator: e.target.value })}
                        className="px-2 py-1.5 text-xs border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-automation/50"
                      >
                        {CONDITION_OPERATORS.map((op) => (
                          <option key={op} value={op}>
                            {op}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={String(cond.value)}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        placeholder="Value"
                        className="flex-1 min-w-0 px-2 py-1.5 text-xs border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-automation/50"
                      />
                      <button
                        onClick={() => removeCondition(i)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={addCondition}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground border border-dashed rounded-lg hover:border-automation hover:text-automation transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Condition
              </button>
            </div>
          )}

          {/* Step 3: Pick Actions */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Then do this...</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose one or more actions to perform
                </p>
              </div>

              {/* Action grid */}
              <div className="grid grid-cols-2 gap-2">
                {ACTION_OPTIONS.map((opt) => {
                  const Icon = actionIcon(opt.type);
                  const selected = selectedActions.includes(opt.type);
                  return (
                    <button
                      key={opt.type}
                      onClick={() => toggleAction(opt.type)}
                      className={`relative flex items-start gap-3 p-3 text-left rounded-lg border transition-all duration-150 ${
                        selected
                          ? "border-subtitle bg-subtitle/5 ring-1 ring-subtitle"
                          : "border-border hover:border-subtitle/40 hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`shrink-0 p-1.5 rounded-md ${
                          selected
                            ? "bg-subtitle/15 text-subtitle"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{opt.label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                          {opt.description}
                        </p>
                      </div>
                      {selected && (
                        <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-subtitle" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Action configs */}
              {selectedActions.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground">
                    Action configuration
                  </p>
                  {selectedActions.map((actionType) => (
                    <ActionConfigRow
                      key={actionType}
                      actionType={actionType}
                      config={actionConfigs[actionType] || {}}
                      onUpdate={(key, val) => updateActionConfig(actionType, key, val)}
                    />
                  ))}
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && (!selectedTrigger || !name.trim())}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-automation text-automation-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <CaretRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting || selectedActions.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-automation text-automation-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting && (
                  <div className="h-3 w-3 animate-spin border-2 border-automation-foreground border-t-transparent rounded-full" />
                )}
                Create Automation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Action Config Row ───────────────────────────────────────────────────

function ActionConfigRow({
  actionType,
  config,
  onUpdate,
}: {
  actionType: ActionType;
  config: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  const Icon = actionIcon(actionType);

  if (actionType === "translate_subtitles") {
    return (
      <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
        <div className="shrink-0 p-1.5 rounded-md bg-subtitle/15 text-subtitle">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium shrink-0">
          {ACTION_LABELS[actionType]}
        </span>
        <input
          type="text"
          value={(config.language as string) || ""}
          onChange={(e) => onUpdate("language", e.target.value)}
          placeholder="Target language (e.g. Spanish)"
          className="flex-1 min-w-0 px-2 py-1.5 text-xs border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-subtitle/50"
        />
      </div>
    );
  }

  if (actionType === "notify_webhook") {
    return (
      <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
        <div className="shrink-0 p-1.5 rounded-md bg-subtitle/15 text-subtitle">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium shrink-0">
          {ACTION_LABELS[actionType]}
        </span>
        <input
          type="url"
          value={(config.url as string) || ""}
          onChange={(e) => onUpdate("url", e.target.value)}
          placeholder="https://hooks.example.com/..."
          className="flex-1 min-w-0 px-2 py-1.5 text-xs border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-subtitle/50 font-mono"
        />
      </div>
    );
  }

  // Default: no config needed
  return (
    <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
      <div className="shrink-0 p-1.5 rounded-md bg-subtitle/15 text-subtitle">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="text-xs font-medium">
        {ACTION_LABELS[actionType]}
      </span>
      <span className="text-[10px] text-muted-foreground ml-auto">
        No configuration needed
      </span>
    </div>
  );
}
