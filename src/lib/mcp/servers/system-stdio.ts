#!/usr/bin/env tsx
/**
 * System MCP Server - Stdio Transport
 * Executes safe system commands
 * Communicates via stdin/stdout for low-latency internal tool calls
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { McpServerStdio } from '../server-stdio';
import { CallToolResult } from '../types';

const execAsync = promisify(exec);

class SystemServerStdio extends McpServerStdio {
  private allowedCommands: string[];
  private workingDirectory: string;

  constructor() {
    super('system', '1.0.0');
    this.allowedCommands = [
      'ls', 'cat', 'pwd', 'echo', 'date', 'whoami',
      'find', 'grep', 'head', 'tail', 'wc', 'df', 'du',
      'git', 'npm', 'node', 'python'
    ];
    this.workingDirectory = process.cwd();
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    this.defineTool({
      name: 'execute_command',
      description: 'Execute a safe system command. Only whitelisted commands are allowed.',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute'
          },
          timeout: {
            type: 'number',
            description: 'Command timeout in milliseconds (default: 30000)',
            default: 30000
          }
        },
        required: ['command']
      }
    });

    this.capabilities = { tools: { listChanged: false } };
  }

  /**
   * Execute tool
   */
  protected async executeTool(
    name: string,
    args: Record<string, unknown>,
    meta?: { conversationId?: string; generationId?: string; messageId?: string }
  ): Promise<CallToolResult> {
    if (name === 'execute_command') {
      return await this.executeCommand(args, meta);
    }
    throw new Error(`Unknown tool: ${name}`);
  }

  private async executeCommand(args: Record<string, unknown>, meta?: any): Promise<CallToolResult> {
    try {
      const command = args.command as string;
      const timeout = (args.timeout as number) || 30000;

      // Check if command is allowed
      const commandBase = command.split(' ')[0];
      if (!this.allowedCommands.includes(commandBase)) {
        return {
          content: [{
            type: 'text',
            text: `Error: Command '${commandBase}' is not in the whitelist`
          }],
          isError: true
        };
      }

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workingDirectory,
        timeout,
        maxBuffer: 1024 * 1024 * 10 // 10MB
      });

      let result = '';
      if (stdout) result += stdout;
      if (stderr) result += `\nSTDERR:\n${stderr}`;

      return {
        content: [{
          type: 'text',
          text: result || '(no output)'
        }]
      };

    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Command failed: ${error.message}\n${error.stderr || ''}`
        }],
        isError: true
      };
    }
  }
}

// Start server if run directly
if (require.main === module) {
  const server = new SystemServerStdio();
  server.start().catch((error) => {
    console.error('[System Server] Fatal error:', error);
    process.exit(1);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

export { SystemServerStdio };
