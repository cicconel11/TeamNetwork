import {
  PATCH as schedulesPatch,
  DELETE as schedulesDelete,
} from "@/app/api/schedules/sources/[sourceId]/route";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: { sourceId: string } }) {
  return schedulesPatch(request, context);
}

export async function DELETE(request: Request, context: { params: { sourceId: string } }) {
  return schedulesDelete(request, context);
}
