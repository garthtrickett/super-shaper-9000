import { Effect } from "effect";
import { html, type TemplateResult } from "lit-html";
import { clientLog } from "./clientLog";
import { LocationService } from "./LocationService";

import "../../components/pages/board-builder-page";

export interface ViewResult {
  template: TemplateResult;
}

export interface Route {
  pattern: RegExp;
  view: (...args: string[]) => ViewResult;
}

type MatchedRoute = Route & { params: string[] };

const routes: Route[] =[
  {
    pattern: /^\/$/,
    view: () => ({ template: html`<board-builder-page></board-builder-page>` }),
  }
];

const NotFoundView = (): ViewResult => ({ template: html`<div>404 Not Found</div>` });

export const matchRoute = (path: string): Effect.Effect<MatchedRoute> =>
  Effect.gen(function* () {
    const cleanPath = path.split('?')[0] || "/";
    
    for (const route of routes) {
      const match = cleanPath.match(route.pattern);
      if (match) {
        return { ...route, params: match.slice(1).filter(Boolean) };
      }
    }
    return { pattern: /^\/404$/, view: NotFoundView, params:[] };
  });

export const navigate = (
  path: string,
): Effect.Effect<void, Error, LocationService> =>
  Effect.gen(function* () {
    yield* clientLog("info", `Navigating to ${path}`, undefined, "router");
    const location = yield* LocationService;
    yield* location.navigate(path);
  });
