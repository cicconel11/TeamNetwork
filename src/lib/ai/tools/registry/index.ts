import type { ToolExecutionResult } from "@/lib/ai/tools/executor";
import type { ToolName } from "@/lib/ai/tools/definitions";
import type { ToolModule, ToolModuleRunContext } from "./types";
import { listMembersModule } from "./list-members";
import { listEventsModule } from "./list-events";
import { listAnnouncementsModule } from "./list-announcements";
import { listDiscussionsModule } from "./list-discussions";
import { listJobPostingsModule } from "./list-job-postings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODULES: ReadonlyArray<ToolModule<any>> = [
  listMembersModule,
  listEventsModule,
  listAnnouncementsModule,
  listDiscussionsModule,
  listJobPostingsModule,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: ReadonlyMap<string, ToolModule<any>> = new Map(
  MODULES.map((mod) => [mod.name, mod])
);

export function getToolModule(name: ToolName) {
  return REGISTRY.get(name);
}

export function isRegisteredTool(name: ToolName): boolean {
  return REGISTRY.has(name);
}

export async function dispatchToolModule(
  name: ToolName,
  rawArgs: unknown,
  run: ToolModuleRunContext
): Promise<ToolExecutionResult> {
  const mod = REGISTRY.get(name);
  if (!mod) {
    throw new Error(`No registered tool module for ${name}`);
  }
  // Args have already been validated upstream against the same schema; we
  // re-cast here to keep the registry boundary narrow without re-validating.
  return mod.execute(rawArgs as never, run);
}
