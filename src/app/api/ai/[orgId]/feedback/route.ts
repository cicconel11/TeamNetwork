import {
  createAiFeedbackDeleteHandler,
  createAiFeedbackGetHandler,
  createAiFeedbackPostHandler,
} from "./handler";

export const GET = createAiFeedbackGetHandler();
export const POST = createAiFeedbackPostHandler();
export const DELETE = createAiFeedbackDeleteHandler();
