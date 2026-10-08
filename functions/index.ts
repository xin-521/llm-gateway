import {
  handleChangePassword,
  handleDiscoverModels,
  handleKeys,
  handleLogs,
  handleLogin,
  handleMe,
  handleModels,
  handlePolicies,
  handleProviders,
  handleResetHealth,
  handleRotateKey,
  handleStats,
  handleStatus,
  handleSetup,
  handleTest,
} from "./admin";
import { handleChat } from "./gateway";
import { handleResponses } from "./responses";

/**
 * LLM Gateway — ESA Edge Routine entry.
 *
 * Gateway data plane (OpenAI + Anthropic compatible):
 *   POST /api/v1/chat/completions   OpenAI Chat Completions
 *   POST /api/v1/responses          OpenAI Responses (compat shim)
 *   POST /api/v1/messages           Anthropic Messages
 *   GET  /api/v1/models             model list
 *
 * Console control plane (session token protected):
 *   POST /api/admin/login | GET /api/admin/me | POST /api/admin/change-password
 *   GET  /api/admin/status | POST /api/admin/setup   (first-run bootstrap)
 *   CRUD /api/admin/providers[/id]
 *   POST /api/admin/providers/discover-models  (probe upstream GET /v1/models)
 *   CRUD /api/admin/keys[/id] | POST /api/admin/keys/:id/rotate
 *   GET/PUT /api/admin/policies
 *   GET/DELETE /api/admin/logs
 *   GET /api/admin/stats | POST /api/admin/reset-health | POST /api/admin/test
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization,content-type,x-api-key,anthropic-version",
};

function notFound(): Response {
  return new Response(
    JSON.stringify({
      error: {
        message:
          "Unknown endpoint. Console APIs live under /api/admin/*, gateway APIs under /api/v1/*.",
        type: "gateway_error",
      },
    }),
    {
      status: 404,
      headers: { "content-type": "application/json", ...CORS },
    }
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, "Access-Control-Max-Age": "86400" },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method;

    /* ---------------- gateway data plane ---------------- */
    if (path === "/v1/chat/completions" && method === "POST") {
      return handleChat(request, "openai");
    }
    if (path === "/v1/messages" && method === "POST") {
      return handleChat(request, "anthropic");
    }
    if (path === "/v1/responses" && method === "POST") {
      return handleResponses(request);
    }
    if (path === "/v1/models" && method === "GET") {
      return handleModels(request);
    }

    /* ---------------- console control plane ---------------- */
    if (path === "/admin/login" && method === "POST") {
      return handleLogin(request);
    }
    if (path === "/admin/status" && method === "GET") {
      return handleStatus();
    }
    if (path === "/admin/setup" && method === "POST") {
      return handleSetup(request);
    }
    if (path === "/admin/me" && method === "GET") {
      return handleMe(request);
    }
    if (path === "/admin/change-password" && method === "POST") {
      return handleChangePassword(request);
    }
    if (path === "/admin/providers/discover-models" && method === "POST") {
      return handleDiscoverModels(request);
    }

    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/admin\/providers(\/([\w.-]+))?$/))) {
      return handleProviders(request, m[2] ?? "", method);
    }
    if ((m = path.match(/^\/admin\/keys\/([\w.-]+)\/rotate$/)) && method === "POST") {
      return handleRotateKey(request, m[1]);
    }
    if ((m = path.match(/^\/admin\/keys(\/([\w.-]+))?$/))) {
      return handleKeys(request, m[2] ?? "", method);
    }
    if (path === "/admin/policies") {
      return handlePolicies(request, method);
    }
    if (path === "/admin/logs") {
      return handleLogs(request, method);
    }
    if (path === "/admin/stats" && method === "GET") {
      return handleStats(request);
    }
    if (path === "/admin/reset-health" && method === "POST") {
      return handleResetHealth(request);
    }
    if (path === "/admin/test" && method === "POST") {
      return handleTest(request);
    }

    return notFound();
  },
};
