import {
  createAiScheduleUploadDeleteHandler,
  createAiScheduleUploadHandler,
} from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createAiScheduleUploadHandler();
export const DELETE = createAiScheduleUploadDeleteHandler();
