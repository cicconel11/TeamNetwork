import { POST as schedulesGoogleConnectPost } from "@/app/api/schedules/google/connect/route";

export async function POST(request: Request) {
  return schedulesGoogleConnectPost(request);
}
