import {
  createAiFeedbackDeleteHandler,
  createAiFeedbackGetHandler,
  createAiFeedbackPostHandler,
} from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createAiFeedbackGetHandler();
export const POST = createAiFeedbackPostHandler();
export const DELETE = createAiFeedbackDeleteHandler();
