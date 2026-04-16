import { createAiFeedbackGetHandler, createAiFeedbackPostHandler } from "./handler";

export const GET = createAiFeedbackGetHandler();
export const POST = createAiFeedbackPostHandler();
