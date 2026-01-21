/**
 * System Command MCP Server
 * Provides system command execution capabilities
 */

import { Redis } from 'ioredis';
import { exec } from 'child_process';
import { promisify } from 'util';
import { McpServer } from '../server';
import { CallToolResult } from '../types';

const execAsync = promisify(exec);
const TMUX_SESSION_NAME = 'red-agent';

interface SSHOptions {
  host: string;
  user?: string;
  cwd?: string;
  interactive?: boolean;
}

export class SystemCommandServer extends McpServer {
  private allowedCommands: string[];
  private workingDirectory: string;

  constructor(
    redis: Redis,
    options?: {
      allowedCommands?: string[];
      workingDirectory?: string;
    }
  ) {
    super(redis, 'system-command', '1.0.0');
    
    // Default to safe commands only
    this.allowedCommands = options?.allowedCommands || [
      'ls', 'cat', 'pwd', 'echo', 'date', 'whoami',
      'find', 'grep', 'head', 'tail', 'wc', 'df', 'du',
      // Added for remote capabilities (requires explicit 'host' param to use freely)
      'ssh', 'scp'
    ];
    
    this.workingDirectory = options?.workingDirectory || process.cwd();
  }

  /**
   * Setup tools
   */
  protected async setup(): Promise<void> {
    this.defineTool({
      name: 'execute_command',
      description: `Execute a system command. Can run locally (if allowed) or remotely via SSH (if 'host' is provided). 
      Remote mode uses stateless SSH or interactive Tmux sessions.`,
      inputSchema: {
         type: 'object',
         properties: {
             command: {
                 type: 'string',
                 description: 'The command to execute'
             },
             host: {
                 type: 'string',
                 description: 'Remote hostname (e.g. "user@192.168.1.5"). If provided, runs via SSH.'
             },
             interactive: {
                 type: 'boolean',
                 description: 'If true, uses Tmux for stateful/interactive session on remote host. Default: false'
             },
             input: {
                 type: 'string',
                 description: 'Input to send to interactive session (e.g. "y", "password")'
             }
         },
         required: ['command']
      }
    });

    this.capabilities = {
      tools: {
        listChanged: false
      }
    };
  }

  /**
   * Execute tool
   */
  protected async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    if (name === 'execute_command') {
      const command = (args.command as string || '').trim();
      const host = args.host as string | undefined;
      const interactive = !!args.interactive;
      const input = args.input as string | undefined;

      if (!host) {
        // Local execution (restricted)
        return await this.executeLocalCommand(command);
      } else {
        // Remote execution (SSH)
        if (interactive || input) {
            return await this.executeRemoteTmux(command, host, input);
        } else {
            return await this.executeRemoteStateless(command, host);
        }
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  /**
   * Execute command via Stateless SSH (Mode A)
   */
  private async executeRemoteStateless(command: string, host: string): Promise<CallToolResult> {
      // Basic SSH wrapper: ssh user@host "command"
      // Note: This relies on system SSH config/agent for auth
      const remoteCmd = `ssh ${host} "${command.replace(/"/g, '\\"')}"`;
      
      try {
          const { stdout, stderr } = await execAsync(remoteCmd);
          return this.formatOutput(stdout, stderr);
      } catch (error: any) {
          return this.formatError(error);
      }
  }

  /**
   * Execute command via Tmux Bridge (Mode B)
   */
  private async executeRemoteTmux(command: string, host: string, input?: string): Promise<CallToolResult> {
      try {
        // 1. Ensure Session
        const checkSession = `ssh ${host} "tmux has-session -t ${TMUX_SESSION_NAME} 2>/dev/null"`;
        try {
            await execAsync(checkSession);
        } catch {
            // Session doesn't exist, create it
            await execAsync(`ssh ${host} "tmux new-session -d -s ${TMUX_SESSION_NAME}"`);
        }

        // 2. Prepare Command
        // Clear history first to ensure we capture relevant output?
        // Maybe optional. For now, let's just run.

        if (input) {
            // Check for control characters
            if (input === '^C') {
                await execAsync(`ssh ${host} "tmux send-keys -t ${TMUX_SESSION_NAME} C-c"`);
            } else {
                await execAsync(`ssh ${host} "tmux send-keys -t ${TMUX_SESSION_NAME} '${input}' C-m"`);
            }
        } else {
            // Run main command with marker
            const marker = `---CMD_DONE_${Date.now()}---`;
            const fullCmd = `${command}; echo '${marker}'`;
            
            // Send keys
            await execAsync(`ssh ${host} "tmux send-keys -t ${TMUX_SESSION_NAME} '${fullCmd.replace(/'/g, "'\\''")}' C-m"`);
            
            // Poll for marker
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds (0.5s interval)
            
            while (attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 500));
                
                // Read pane (-p: stdout, -S -: history from start? No, maybe just visible for now or few lines back)
                // -S -100 captures last 100 lines
                const { stdout } = await execAsync(`ssh ${host} "tmux capture-pane -t ${TMUX_SESSION_NAME} -p -S -100"`);
                
                if (stdout.includes(marker)) {
                    const cleanOutput = stdout.replace(marker, '').trim();
                     // TODO: Strip command echo if possible
                    return this.formatOutput(cleanOutput, '');
                }
                attempts++;
            }
            
            return {
                content: [{ type: 'text', text: 'Command timed out or is still running in background. Use interactive mode to check status.' }],
                isError: false 
            };
        }

        // For input-only calls, just return current screen
        const { stdout } = await execAsync(`ssh ${host} "tmux capture-pane -t ${TMUX_SESSION_NAME} -p"`);
        return this.formatOutput(stdout, '');

      } catch (error: any) {
          return this.formatError(error);
      }
  }

  /**
   * Format generic output
   */
  private formatOutput(stdout: string, stderr: string): CallToolResult {
      let output = '';
      if (stdout) output += `**Output:**\n\`\`\`\n${stdout.trim()}\n\`\`\`\n`;
      if (stderr) output += `**Errors:**\n\`\`\`\n${stderr.trim()}\n\`\`\`\n`;
      if (!output) output = '(Command executed successfully with no output)';
      
      return { content: [{ type: 'text', text: output }] };
  }

  private formatError(error: any): CallToolResult {
      return {
          content: [{ type: 'text', text: `Execution failed: ${error.message}\nStderr: ${error.stderr || ''}` }],
          isError: true
      };
  }

  /**
   * Execute system command locally
   */
  private async executeLocalCommand(command: string): Promise<CallToolResult> {
    if (!command) {
      return {
        content: [{
          type: 'text',
          text: 'Error: No command provided'
        }],
        isError: true
      };
    }

    // Check if command is allowed
    const baseCommand = command.split(' ')[0];
    if (!this.allowedCommands.includes(baseCommand)) {
      return {
        content: [{
          type: 'text',
          text: `Error: Command '${baseCommand}' is not allowed. Allowed commands: ${this.allowedCommands.join(', ')}`
        }],
        isError: true
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workingDirectory,
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024, // 1MB max output
      });

      let output = '';
      
      if (stdout) {
        output += `**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n`;
      }
      
      if (stderr) {
        output += `**Errors:**\n\`\`\`\n${stderr}\n\`\`\`\n`;
      }

      if (!output) {
        output = '(Command executed successfully with no output)';
      }

      return {
        content: [{
          type: 'text',
          text: output
        }]
      };

    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';

      let errorText = `Command execution failed: ${errorMessage}\n`;
      
      if (stdout) {
        errorText += `\n**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n`;
      }
      
      if (stderr) {
        errorText += `\n**Errors:**\n\`\`\`\n${stderr}\n\`\`\``;
      }

      return {
        content: [{
          type: 'text',
          text: errorText
        }],
        isError: true
      };
    }
  }
}
