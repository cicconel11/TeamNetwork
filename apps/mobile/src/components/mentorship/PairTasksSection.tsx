import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { Check, Circle, Trash2, Plus, Clock } from "lucide-react-native";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";
import {
  createTask,
  deleteTask,
  getTasks,
  updateTask,
  type MentorshipTask,
} from "@/lib/mentorship-api";

const STATUS_FLOW: Record<MentorshipTask["status"], MentorshipTask["status"]> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

export function PairTasksSection({
  orgId,
  pairId,
  canEdit,
}: {
  orgId: string;
  pairId: string;
  canEdit: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const [tasks, setTasks] = useState<MentorshipTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getTasks(orgId, pairId);
      setTasks(list);
    } catch (err) {
      setError((err as Error).message || "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [orgId, pairId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert("Title required", "Give the task a short title before saving.");
      return;
    }
    setSubmitting(true);
    try {
      const { task } = await createTask(orgId, {
        pair_id: pairId,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      setTasks((prev) => [...prev, task]);
      setTitle("");
      setDescription("");
      setShowForm(false);
    } catch (err) {
      Alert.alert("Could not create task", (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCycleStatus = async (task: MentorshipTask) => {
    const next = STATUS_FLOW[task.status];
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: next } : t))
    );
    try {
      await updateTask(orgId, task.id, { status: next });
    } catch (err) {
      // Revert on failure.
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t))
      );
      Alert.alert("Could not update task", (err as Error).message);
    }
  };

  const handleDelete = (task: MentorshipTask) => {
    Alert.alert("Delete task?", `Remove "${task.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const previous = tasks;
          setTasks((prev) => prev.filter((t) => t.id !== task.id));
          try {
            await deleteTask(orgId, task.id);
          } catch (err) {
            setTasks(previous);
            Alert.alert("Could not delete task", (err as Error).message);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {tasks.length === 0 && !showForm ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No tasks yet</Text>
          <Text style={styles.emptySubtitle}>
            Capture the next steps you and your mentor agreed on.
          </Text>
        </View>
      ) : null}

      {tasks.map((task) => {
        const statusColor =
          task.status === "done"
            ? styles.statusDone
            : task.status === "in_progress"
              ? styles.statusInProgress
              : styles.statusTodo;
        return (
          <View key={task.id} style={styles.card}>
            <Pressable
              onPress={() => canEdit && handleCycleStatus(task)}
              disabled={!canEdit}
              style={styles.taskRow}
            >
              <View style={styles.statusIcon}>
                {task.status === "done" ? (
                  <Check size={18} color={styles.statusDone.color} />
                ) : task.status === "in_progress" ? (
                  <Clock size={18} color={styles.statusInProgress.color} />
                ) : (
                  <Circle size={18} color={styles.statusTodo.color} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.taskTitle,
                    task.status === "done" && styles.taskTitleDone,
                  ]}
                >
                  {task.title}
                </Text>
                {task.description ? (
                  <Text style={styles.taskDescription}>{task.description}</Text>
                ) : null}
                <Text style={[styles.taskStatus, statusColor]}>
                  {task.status.replace("_", " ")}
                </Text>
              </View>
              {canEdit ? (
                <Pressable
                  onPress={() => handleDelete(task)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.deleteButton}
                >
                  <Trash2 size={16} color={styles.deleteIcon.color} />
                </Pressable>
              ) : null}
            </Pressable>
          </View>
        );
      })}

      {canEdit ? (
        showForm ? (
          <View style={styles.formCard}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Task title"
              placeholderTextColor={styles.placeholderColor.color}
              style={styles.input}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={styles.placeholderColor.color}
              multiline
              style={[styles.input, styles.multiline]}
            />
            <View style={styles.formActions}>
              <Pressable
                onPress={() => {
                  setShowForm(false);
                  setTitle("");
                  setDescription("");
                }}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  submitting && styles.buttonDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Add task</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowForm(true)}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Plus size={16} color="#ffffff" />
            <Text style={styles.addButtonText}>Add task</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const createStyles = (n: NeutralColors, s: SemanticColors) =>
  StyleSheet.create({
    list: {
      gap: SPACING.sm,
    },
    card: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
    },
    formCard: {
      backgroundColor: n.surface,
      borderRadius: RADIUS.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: n.border,
      padding: SPACING.md,
      gap: SPACING.sm,
    },
    taskRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: SPACING.sm,
    },
    statusIcon: {
      paddingTop: 2,
    },
    taskTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: n.foreground,
    },
    taskTitleDone: {
      textDecorationLine: "line-through",
      color: n.muted,
    },
    taskDescription: {
      fontSize: 13,
      color: n.muted,
      marginTop: 2,
      lineHeight: 18,
    },
    taskStatus: {
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase",
      marginTop: 4,
    },
    statusDone: {
      color: s.success,
    },
    statusInProgress: {
      color: s.warning,
    },
    statusTodo: {
      color: n.muted,
    },
    deleteButton: {
      padding: 4,
    },
    deleteIcon: {
      color: s.error,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: n.foreground,
    },
    emptySubtitle: {
      fontSize: 14,
      color: n.muted,
      marginTop: 2,
    },
    placeholderColor: {
      color: n.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: n.border,
      borderRadius: RADIUS.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 15,
      color: n.foreground,
      backgroundColor: n.surface,
    },
    multiline: {
      minHeight: 60,
      textAlignVertical: "top",
    },
    formActions: {
      flexDirection: "row",
      gap: SPACING.sm,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    secondaryButton: {
      flex: 1,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: n.border,
      backgroundColor: n.surface,
    },
    secondaryButtonText: {
      color: n.foreground,
      fontSize: 14,
      fontWeight: "600",
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.xs,
      backgroundColor: s.success,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.md,
    },
    addButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    errorCard: {
      backgroundColor: `${s.error}14`,
      borderWidth: 1,
      borderColor: `${s.error}55`,
      borderRadius: RADIUS.md,
      padding: SPACING.sm,
    },
    errorText: {
      fontSize: 13,
      color: s.error,
    },
    spinnerColor: {
      color: s.success,
    },
  });
