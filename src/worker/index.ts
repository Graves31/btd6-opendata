// Worker entry. workerd treats every named export of this module as an entrypoint, so it exports only
// the default handler; everything else lives in app.ts.

import { handleRequest, makeDeps, runScheduled, type Ctx, type Env } from "./app.ts";

export default {
  fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    return handleRequest(makeDeps(env, ctx), env, request);
  },
  async scheduled(controller: { cron: string }, env: Env, ctx: Ctx): Promise<void> {
    await runScheduled(makeDeps(env, ctx), controller.cron);
  },
};
