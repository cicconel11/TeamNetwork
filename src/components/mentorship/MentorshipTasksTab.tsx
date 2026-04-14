"use client";

import React, { useOptimistic, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, Select } from "@/components/ui";
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
  pairs: Array<{ id: string; mentorName: string; menteeName: string }>;
  initialPairId: string;
  isMentor: boolean;
  isAdmin: boolean;
  orgId: string;
  orgSlug: string;
  currentUserId: string;
}

type StatusFilter = "all" | "todo" | "in_progress" | "done";


function getStatusBadgeVariant(status: "todo" | "in_progress" | "done") {
  const variants: Record<string, "muted" | "primary" | "success"> = {
    todo: "muted",
    in_progress: "primary",
    done: "success",
  };
  return variants[status] || "muted";
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
      year: "numeric",
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

export function MentorshipTasksTab({
  initialTasks,
  pairs,
  initialPairId,
  isMentor,
  orgId,
}: MentorshipTasksTabProps) {
  const tMentorship = useTranslations("mentorship");

  const [tasks, setTasks] = useState<MentorshipTask[]>(initialTasks);
  const [selectedPairId, setSelectedPairId] = useState(initialPairId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [patchingIds, setPatchingIds] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const [, startTransition] = useTransition();

  const [optimisticTasks, updateOptimistic] = useOptimistic(
    tasks,
    (state, taskId: string, newStatus: "todo" | "in_progress" | "done") => {
      return state.map((t) =>
        t.id === taskId ? { ...t, status: newStatus } : t
      );
    }
  );

  // Load tasks for selected pair
  async function loadTasksForPair(pairId: string) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/tasks?pairId=${pairId}`,
        {
          signal: abortRef.current.signal,
        }
      );

      if (!res.ok) {
        showFeedback("error", "Failed to load tasks");
        return;
      }

      const data = await res.json();
      setTasks(Array.isArray(data) ? data : data.tasks || []);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        showFeedback("error", "An error occurred while loading tasks");
      }
    }
  }

  // Handle pair selection change
  function handlePairChange(newPairId: string) {
    setSelectedPairId(newPairId);
    setStatusFilter("all");
    setShowTaskForm(false);
    loadTasksForPair(newPairId);
  }

  // Handle status cycling (mentee only)
  function handleStatusCycle(taskId: string, currentStatus: string) {
    if (patchingIds.has(taskId)) return; // Prevent double-tap

    const newStatus = nextStatus(currentStatus as "todo" | "in_progress" | "done");

    setPatchingIds((prev) => new Set(prev).add(taskId));

    startTransition(async () => {
      updateOptimistic(taskId, newStatus);

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
          showFeedback("error", "Failed to update task status");
          // useOptimistic auto-reverts on error
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, status: currentStatus } : t
            )
          );
        }
      } catch {
        showFeedback("error", "An error occurred while updating the task");
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

  // Handle task deletion (mentor only)
  async function handleDeleteTask(taskId: string) {
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/tasks/${taskId}`,
        {
          method: "DELETE",
        }
      );

      if (!res.ok) {
        showFeedback("error", "Failed to delete task");
        return;
      }

      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showFeedback("success", "Task deleted");
    } catch {
      showFeedback("error", "An error occurred while deleting the task");
    }
  }

  // Handle task creation
  function handleTaskCreated(newTask: MentorshipTask) {
    setTasks((prev) => [newTask, ...prev]);
    setShowTaskForm(false);
    showFeedback("success", "Task created");
  }

  // Filter tasks based on status filter
  const filteredTasks = optimisticTasks.filter((task) => {
    if (statusFilter === "all") return true;
    return task.status === statusFilter;
  });

  // If no pairs or no initial pair selected
  if (!selectedPairId) {
    return (
      <Card>
        <EmptyState
          title={tMentorship("noActivePair")}
          description={tMentorship("selectOrCreatePair")}
        />
      </Card>
    );
  }

  // If no tasks for this pair
  if (filteredTasks.length === 0 && statusFilter === "all" && !showTaskForm) {
    return (
      <Card className="space-y-4">
        {pairs.length > 1 && (
          <MentorshipPairPicker
            pairs={pairs}
            selectedPairId={selectedPairId}
            onPairChange={handlePairChange}
          />
        )}
        <EmptyState
          title={tMentorship("noTasks")}
          description={tMentorship("tasksWillAppear")}
        />
        {isMentor && (
          <div className="pt-2">
            <Button onClick={() => setShowTaskForm(true)} size="sm">
              Add Task
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      {/* Pair Picker */}
      {pairs.length > 1 && (
        <MentorshipPairPicker
          pairs={pairs}
          selectedPairId={selectedPairId}
          onPairChange={handlePairChange}
        />
      )}

      {/* Status Filter */}
      <div className="flex items-center gap-2">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          options={[
            { value: "all", label: "All Tasks" },
            { value: "todo", label: "To Do" },
            { value: "in_progress", label: "In Progress" },
            { value: "done", label: "Done" },
          ]}
          className="max-w-xs"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="text-left font-medium py-2 px-3">Title</th>
              <th className="text-left font-medium py-2 px-3">Status</th>
              <th className="text-left font-medium py-2 px-3">Due Date</th>
              {(isMentor || true) && (
                <th className="text-right font-medium py-2 px-3">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map((task) => {
              const overdue = isOverdue(task.due_date, task.status);
              const rowClass = overdue ? "bg-red-50 dark:bg-red-950" : "";

              return (
                <tr
                  key={task.id}
                  className={`border-b hover:bg-muted/50 transition-colors ${rowClass}`}
                >
                  <td className="py-3 px-3">
                    <div className="font-medium">{task.title}</div>
                    {task.description && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {task.description}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {!isMentor ? (
                      // Mentee: clickable status badge to cycle
                      <button
                        onClick={() => handleStatusCycle(task.id, task.status)}
                        disabled={patchingIds.has(task.id)}
                        className="cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Badge variant={getStatusBadgeVariant(task.status)}>
                          {task.status === "todo"
                            ? "To Do"
                            : task.status === "in_progress"
                              ? "In Progress"
                              : "Done"}
                        </Badge>
                      </button>
                    ) : (
                      // Mentor: display-only badge
                      <Badge variant={getStatusBadgeVariant(task.status)}>
                        {task.status === "todo"
                          ? "To Do"
                          : task.status === "in_progress"
                            ? "In Progress"
                            : "Done"}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">
                    {task.due_date ? (
                      <span>{formatDate(task.due_date)}</span>
                    ) : (
                      <span className="text-xs">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {isMentor && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteTask(task.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty state for filtered view */}
      {filteredTasks.length === 0 && statusFilter !== "all" && (
        <div className="py-8 text-center text-muted-foreground">
          <p>No tasks with status &quot;{statusFilter.replace("_", " ")}&quot;</p>
        </div>
      )}

      {/* Add Task Form (Mentor only) */}
      {isMentor && (
        <>
          {!showTaskForm ? (
            <div className="pt-2">
              <Button onClick={() => setShowTaskForm(true)} size="sm">
                Add Task
              </Button>
            </div>
          ) : (
            <MentorshipTaskForm
              pairId={selectedPairId}
              orgId={orgId}
              onTaskCreated={handleTaskCreated}
              onCancel={() => setShowTaskForm(false)}
            />
          )}
        </>
      )}
    </Card>
  );
}
