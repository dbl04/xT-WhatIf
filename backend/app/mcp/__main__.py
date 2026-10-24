"""
CLI Entrypoint for xT-WhatIf MCP Server over stdio:
    python -m app.mcp
"""

import asyncio
from app.mcp.server import run_stdio_server

if __name__ == "__main__":
    asyncio.run(run_stdio_server())
