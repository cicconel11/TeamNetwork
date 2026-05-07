"use client";

import React, { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Clock } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import { MentorshipPairPicker } from "./MentorshipPairPicker";
import { MentorshipTaskForm } from "./MentorshipTaskForm";

interface MentorshipTask {
  id: string;
  pair_id: string;
  title: string;
  description?: string | null;
  status: "todo" | "in_progress" | "done";
  due_date?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface MentorshipTasksTabProps {
  initialTasks: MentorshipTask[];
  pairs: Array<{ id: string; mentorName: string; menteeName: string; mentorUserId?: string; menteeUserId?: string }>;
  initialPairId: string;
  isMentor: boolean;
  isAdmin: boolean;
  orgId: string;
  orgSlug: string;
  currentUserId: string;
}

type StatusFilter = "all" | "todo" | "in_progress" | "done";

/* ─── Status circle SVG icons (Linear-style) ─── */

function StatusCircle({ status, size = 16 }: { status: "todo" | "in_progress" | "done"; size?: number }) {
  if (status === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
        <circle cx="8" cy="8" r="7" fill="#10b981" />
        <path d="M5 8.5L7 10.5L11 6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === "in_progress") {
    // Half-filled circle using a semicircle arc path instead of clipPath (avoids ID collisions)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
        <circle cx="8" cy="8" r="6.5" stroke="#f59e0b" strokeWidth="1.5" />
        <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill="#f59e0b" />
      </svg>
    );
  }

  // todo
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/60" />
    </svg>
  );
}

function nextStatus(current: "todo" | "in_progress" | "done") {
  const sequence: Record<string, "todo" | "in_progress" | "done"> = {
    todo: "in_progress",
    in_progress: "done",
    done: "todo",
  };
  return sequence[current] || "todo";
}

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function isOverdue(dueDate: string | undefined | null, status: string): boolean {
  if (!dueDate || status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

export function MentorshipTasksTab({
  initialTasks,
  pairs,
  initialPairId,
  isMentor,
  orgId,
  currentUserId,
}: MentorshipTasksTabProps) {
  const tMentorship = useTranslations("mentorship");

  const [tasks, setTasks] = useState<MentorshipTask[]>(initialTasks);
  const [selectedPairId, setSelectedPairId] = useState(initialPairId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [patchingIds, setPatchingIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [, startTransition] = useTransition();

  const [optimisticTasks, updateOptimistic] = useOptimistic(
    tasks,
    (state, action: { taskId: string; newStatus: "todo" | "in_progress" | "done" }) => {
      return state.map((t) =>
        t.id === action.taskId ? { ...t, status: action.newStatus } : t
      );
    }
  );

  // Compute counts for the selected pair
  const pairTasks = optimisticTasks.filter((t) => t.pair_id === selectedPairId);
  const statusCounts: Record<StatusFilter, number> = {
    all: pairTasks.length,
    todo: pairTasks.filter((t) => t.status === "todo").length,
    in_progress: pairTasks.filter((t) => t.status === "in_progress").length,
    done: pairTasks.filter((t) => t.status === "done").length,
  };

  useEffect(() => {
    if (!initialPairId || initialPairId === selectedPairId) return;

    setSelectedPairId(initialPairId);
    setStatusFilter("all");
    setShowTaskForm(false);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    void (async () => {
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/tasks?pairId=${initialPairId}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          showFeedback("Failed to load tasks", "error");
          return;
        }

        const data = await res.json();
        setTasks(Array.isArray(data) ? data : data.tasks || []);
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          showFeedback("An error occurred while loading tasks", "error");
        }
      } finally {
        setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [initialPairId, orgId, selectedPairId]);

  async function loadTasksForPair(pairId: string) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);

    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/tasks?pairId=${pairId}`,
        { signal: abortRef.current.signal }
      );

      if (!res.ok) {
        showFeedback("Failed to load tasks", "error");
        return;
      }

      const data = await res.json();
      setTasks(Array.isArray(data) ? data : data.tasks || []);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        showFeedback("An error occurred while loading tasks", "error");
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handlePairChange(newPairId: string) {
    setSelectedPairId(newPairId);
    setStatusFilter("all");
    setShowTaskForm(false);
    loadTasksForPair(newPairId);
  }

  function handleStatusCycle(taskId: string, currentStatus: "todo" | "in_progress" | "done") {
    if (patchingIds.has(taskId)) return;

    const newStatus = nextStatus(currentStatus);
    setPatchingIds((prev) => new Set(prev).add(taskId));

    startTransition(async () => {
      updateOptimistic({ taskId, newStatus });

      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/tasks/${taskId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          }
        );

        if (!res.ok) {
          showFeedback("Failed to update task status", "error");
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: currentStatus } : t
            )
          );
        }
      } catch {
        showFeedback("An error occurred while updating the task", "error");
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: currentStatus } : t
          )
        );
      } finally {
        setPatchingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    });
  }

  async function handleDeleteTask(taskId: string) {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/tasks/${taskId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        showFeedback("Failed to delete task", "error");
        return;
      }

      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showFeedback("Task deleted", "success");
    } catch {
      showFeedback("An error occurred while deleting the task", "error");
    }
  }

  function handleTaskCreated(newTask: MentorshipTask) {
    setTasks((prev) => [newTask, ...prev]);
    setShowTaskForm(false);
    showFeedback("Task created", "success");
  }

  const filteredTasks = optimisticTasks.filter((task) => {
    if (task.pair_id !== selectedPairId) return false;
    if (statusFilter === "all") return true;
    return task.status === statusFilter;
  });

  if (!selectedPairId) {
    return (
      <div className="py-12">
        <EmptyState
          title={tMentorship("noActivePair")}
          description={tMentorship("selectOrCreatePair")}
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      {/* Pair Picker */}
      {pairs.length > 1 && (
        <div className="px-4 pt-4">
          <MentorshipPairPicker
            pairs={pairs}
            selectedPairId={selectedPairId}
            onPairChange={handlePairChange}
            currentUserId={currentUserId}
          />
        </div>
      )}

      {/* Filter tabs + Add Task */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-wrap">
        {(["all", "todo", "in_progress", "done"] as StatusFilter[]).map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            aria-pressed={statusFilter === filter}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
              statusFilter === filter
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40"
            }`}
          >
            {STATUS_LABELS[filter]}
            <span className="ml-1 opacity-40">{statusCounts[filter]}</span>
          </button>
        ))}

        {isMentor && (
          <button
            onClick={() => setShowTaskForm(true)}
            className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors duration-150"
          >
            + Add Task
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[var(--muted-foreground)]">
          <div className="animate-spin h-5 w-5 border-2 border-current border-t-transparent rounded-full mr-2" />
          Loading tasks…
        </div>
      ) : (
        <>
          {/* Inline Task Form */}
          {showTaskForm && (
            <MentorshipTaskForm
              pairId={selectedPairId}
              orgId={orgId}
              onTaskCreated={handleTaskCreated}
              onCancel={() => setShowTaskForm(false)}
            />
          )}

          {/* Task list */}
          {filteredTasks.length > 0 ? (
            <div className="stagger-children">
              {filteredTasks.map((task) => {
                const overdue = isOverdue(task.due_date, task.status);

                return (
                  <div
                    key={task.id}
                    className="group flex items-center gap-3 px-4 py-2 rounded-md hover:bg-[var(--muted)]/40 transition-colors duration-150"
                  >
                    {/* Status circle */}
                    {!isMentor ? (
                      <button
                        onClick={() => handleStatusCycle(task.id, task.status)}
                        disabled={patchingIds.has(task.id)}
                        aria-label={`Status: ${STATUS_LABELS[task.status]}. Click to change to ${STATUS_LABELS[nextStatus(task.status)]}`}
                        className="flex-shrink-0 transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <StatusCircle status={task.status} />
                      </button>
                    ) : (
                      <span className="flex-shrink-0">
                        <StatusCircle status={task.status} />
                      </span>
                    )}

                    {/* Title */}
                    <span className={`flex-1 text-sm font-medium truncate ${
                      task.status === "done" ? "line-through text-[var(--muted-foreground)]" : "text-[var(--foreground)]"
                    }`}>
                      {task.title}
                    </span>

                    {/* Due date */}
                    {task.due_date && (
                      <span className={`flex-shrink-0 flex items-center gap-1 text-xs ${
                        overdue
                          ? "text-amber-600 dark:text-amber-400 font-medium"
                          : "text-[var(--muted-foreground)]"
                      }`}>
                        {overdue && <Clock className="h-3 w-3" />}
                        {formatDate(task.due_date)}
                      </span>
                    )}

                    {/* Delete (mentor only, hover reveal) */}
                    {isMentor && (
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        aria-label="Delete task"
                        className="flex-shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8">
              {statusFilter !== "all" ? (
                <p className="text-center text-sm text-[var(--muted-foreground)]">
                  No tasks with status &quot;{STATUS_LABELS[statusFilter]}&quot;
                </p>
              ) : (
                <EmptyState
                  title={tMentorship("noTasks")}
                  description={tMentorship("tasksWillAppear")}
                  action={
                    isMentor ? (
                      <Button onClick={() => setShowTaskForm(true)} size="sm">
                        + Add Task
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
