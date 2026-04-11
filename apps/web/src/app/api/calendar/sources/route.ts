import { GET as schedulesSourcesGet } from "@/app/api/schedules/sources/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return schedulesSourcesGet(request);
}
