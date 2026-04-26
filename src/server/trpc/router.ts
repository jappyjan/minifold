import { router } from "./trpc";
import { healthRouter } from "./routers/health";
import { browseRouter } from "./routers/browse";

export const appRouter = router({
  health: healthRouter,
  browse: browseRouter,
});

export type AppRouter = typeof appRouter;
