#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createWorkIslandMcpServer } from "./tools.mjs";

serveStdio(() => createWorkIslandMcpServer());
