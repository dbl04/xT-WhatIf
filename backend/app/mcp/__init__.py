"""
xT-WhatIf Model Context Protocol (MCP) Server Package (`backend/app/mcp/`).
"""

from app.mcp.server import (
    MCP_PROTOCOL_VERSION,
    MCP_SERVER_INFO,
    MCPToolCallRequest,
    XTWhatIfMCPServer,
    mcp_server,
    router as mcp_router,
    run_stdio_server,
)

__all__ = [
    "MCP_PROTOCOL_VERSION",
    "MCP_SERVER_INFO",
    "MCPToolCallRequest",
    "XTWhatIfMCPServer",
    "mcp_server",
    "mcp_router",
    "run_stdio_server",
]
