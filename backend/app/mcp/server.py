"""
Model Context Protocol (MCP) Server for xT-WhatIf Engine (`backend/app/mcp/server.py`).

Exposes the exact same tactical math and spatial optimization tools used by the multi-agent
swarm (`Dr. Voronoi` & `Coach Bianchi`) over MCP JSON-RPC 2.0 (both stdio and HTTP transports):
- `simulate_counterfactual`: Counterfactual 360 frame simulation (16x12 xT, Gaussian pass cone, Voronoi control).
- `optimizer/solve` (`optimizer_solve`): Auto-Coach inverse defensive optimizer within the 6.0m inertia ring.
- `xt_at`: Continuous 2D bilinear Expected Threat (xT) lookup at (x, y) on the 120x80m pitch.
- `what_if_natural_language`: Natural-language tactical what-if ("¿y si el lateral cierra por dentro?").

Supports:
1. JSON-RPC 2.0 MCP specification (`initialize`, `notifications/initialized`, `ping`,
   `tools/list`, `tools/call`, `resources/list`, `resources/read`).
2. Stdio transport via `python -m app.mcp`.
3. HTTP transport via FastAPI router (`/api/v1/mcp`, `/api/v1/mcp/tools`, `/api/v1/mcp/call`).
"""

from __future__ import annotations

import sys
import json
import asyncio
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Response

from app.agents.tools import EngineToolRegistry, resolve_frame
from app.agents.what_if_nl import WhatIfNLRequest, execute_natural_language_what_if
from app.services.match_loader import loader
from app.services.synthetic_generator import DEFAULT_MATCH_ID

logger = logging.getLogger("xtwhatif.mcp")

MCP_PROTOCOL_VERSION = "2024-11-05"
MCP_SERVER_INFO = {
    "name": "xt-whatif-mcp-server",
    "version": "2.0.0",
}

router = APIRouter(tags=["mcp"])


class MCPToolCallRequest(BaseModel):
    name: str = Field(..., description="Tool name: simulate_counterfactual | optimizer/solve | xt_at | what_if_natural_language")
    arguments: Dict[str, Any] = Field(default_factory=dict)


class JSONRPCRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: Optional[Any] = None
    method: str
    params: Optional[Dict[str, Any]] = None


class XTWhatIfMCPServer:
    """
    Model Context Protocol (MCP) server backed by `EngineToolRegistry`.
    """

    def __init__(self, registry: Optional[EngineToolRegistry] = None):
        self.registry = registry or EngineToolRegistry()

    def list_tools(self) -> List[Dict[str, Any]]:
        """Returns the MCP tool definitions (`tools/list`)."""
        tools = list(EngineToolRegistry.get_mcp_tools())
        tools.append({
            "name": "what_if_natural_language",
            "description": (
                "Executes a natural-language tactical what-if query (e.g. '¿y si el lateral cierra por dentro?') "
                "using the engine tools (`xt_at`, `simulate_counterfactual`, `optimizer/solve`) and returns "
                "the interpreted move, simulated metrics, and verified multi-agent debate."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language tactical question."},
                    "match_id": {"type": "integer", "default": DEFAULT_MATCH_ID},
                    "event_uuid": {"type": "string"},
                    "language": {"type": "string", "enum": ["en", "es"], "default": "es"},
                    "audience": {
                        "type": "string",
                        "enum": ["casual", "analyst", "coach", "audio_description"],
                        "default": "analyst",
                    },
                },
                "required": ["query"],
            },
        })
        return tools

    def list_resources(self) -> List[Dict[str, Any]]:
        """Returns MCP resources (`resources/list`)."""
        return [
            {
                "uri": f"xt-whatif://match/{DEFAULT_MATCH_ID}/frames",
                "name": f"Synthetic Match {DEFAULT_MATCH_ID} 360 Key Moments",
                "description": "Canonical 120x80m 360 freeze-frames for xT-WhatIf tactical simulation.",
                "mimeType": "application/json",
            }
        ]

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Executes a tool via `EngineToolRegistry` (`tools/call`) and wraps the output
        in the standard MCP content envelope.
        """
        args = dict(arguments or {})
        try:
            normalized = name.strip().lower()
            if normalized in ("what_if_natural_language", "what_if", "what-if"):
                req = WhatIfNLRequest(
                    query=str(args.get("query", "¿y si el lateral cierra por dentro?")),
                    match_id=int(args.get("match_id", DEFAULT_MATCH_ID)),
                    event_uuid=args.get("event_uuid"),
                    language=args.get("language", "es"),
                    audience=args.get("audience", "analyst"),
                )
                nl_res = await execute_natural_language_what_if(req)
                data = {
                    "query": nl_res.query,
                    "interpreted_move": nl_res.interpreted_move.model_dump(),
                    "metrics": nl_res.simulated_frame.metrics.model_dump(),
                    "agent_debate": [m.model_dump() for m in nl_res.simulated_frame.agent_debate],
                    "tool_calls": nl_res.tool_calls,
                    "verdict_summary": nl_res.verdict_summary,
                }
            else:
                data = await self.registry.execute_tool(name, args, caller_agent="mcp-client")

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(data, ensure_ascii=False),
                    }
                ],
                "structuredContent": data,
                "isError": False,
            }
        except Exception as exc:
            logger.warning("MCP tool call error (%s): %s", name, exc)
            err_payload = {"error": str(exc), "tool": name}
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(err_payload, ensure_ascii=False),
                    }
                ],
                "structuredContent": err_payload,
                "isError": True,
            }

    async def handle_jsonrpc(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Processes a single JSON-RPC 2.0 MCP message and returns a JSON-RPC 2.0 response
        (or `None` for notifications).
        """
        req_id = payload.get("id")
        method = payload.get("method", "")
        params = payload.get("params") or {}

        # Notifications have no `id` and expect no response
        if method.startswith("notifications/"):
            return None

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {
                        "tools": {"listChanged": False},
                        "resources": {"listChanged": False},
                    },
                    "serverInfo": MCP_SERVER_INFO,
                },
            }

        if method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": {}}

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"tools": self.list_tools()},
            }

        if method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments") or {}
            call_res = await self.call_tool(tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": call_res,
            }

        if method == "resources/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"resources": self.list_resources()},
            }

        if method == "resources/read":
            uri = params.get("uri", f"xt-whatif://match/{DEFAULT_MATCH_ID}/frames")
            frames = loader.fetch_match_360_frames(DEFAULT_MATCH_ID)
            summary = [
                {
                    "event_uuid": f["event_uuid"],
                    "minute": f["minute"],
                    "second": f["second"],
                    "event_type": f["event_type"],
                    "moment_label": f.get("moment_label"),
                    "metrics": f["metrics"],
                }
                for f in frames
            ]
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "contents": [
                        {
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": json.dumps(summary, ensure_ascii=False),
                        }
                    ]
                },
            }

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
        }


mcp_server = XTWhatIfMCPServer()


@router.get("/api/v1/mcp/tools")
async def http_list_mcp_tools() -> Dict[str, Any]:
    """Lists all engine tools exposed by the MCP server."""
    return {
        "server": MCP_SERVER_INFO,
        "protocol_version": MCP_PROTOCOL_VERSION,
        "tools": mcp_server.list_tools(),
    }


@router.post("/api/v1/mcp/call")
async def http_call_mcp_tool(request: MCPToolCallRequest) -> Dict[str, Any]:
    """Invokes an MCP tool over HTTP REST."""
    return await mcp_server.call_tool(request.name, request.arguments)


@router.post("/api/v1/mcp")
@router.post("/api/v1/mcp/rpc")
async def http_mcp_jsonrpc(request: JSONRPCRequest):
    """Standard JSON-RPC 2.0 HTTP endpoint for Model Context Protocol (MCP) clients."""
    resp = await mcp_server.handle_jsonrpc(request.model_dump())
    if resp is None:
        return Response(status_code=204)
    return resp


async def run_stdio_server() -> None:
    """Runs the MCP server over standard input/output (stdio JSON-RPC 2.0)."""
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        line_str = line.strip()
        if not line_str:
            continue
        try:
            payload = json.loads(line_str)
            resp = await mcp_server.handle_jsonrpc(payload)
            if resp is not None:
                sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
                sys.stdout.flush()
        except Exception as exc:
            err = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {exc}"},
            }
            sys.stdout.write(json.dumps(err) + "\n")
            sys.stdout.flush()
