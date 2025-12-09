export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  createdAt: Date
  updatedAt: Date
}

export type TaskStatus = 'todo' | 'in-progress' | 'done'

export interface CreateTaskInput {
  title: string
  description: string
}

export interface UpdateTaskInput {
  id: string
  status?: TaskStatus
  title?: string
  description?: string
}

export interface DatabaseConfig {
  path: string
  valueEncoding: 'json' | 'utf8' | 'binary'
}

export interface AcpClientConfig {
  protocolVersion: number
  clientInfo: {
    name: string
    version: string
  }
}

export interface SessionConfig {
  cwd: string
  mcpServers: Array<{
    name: string
    command: string
    args?: string[]
  }>
}

export interface PromptMessage {
  type: 'text'
  text: string
}

export interface PromptInput {
  sessionId: string
  prompt: PromptMessage[]
}

export interface PermissionRequest {
  permission: string
  context?: Record<string, unknown>
}

export interface PermissionResponse {
  outcome: 'approved' | 'denied'
  reason?: string
}

export interface SessionUpdateParams {
  sessionId: string
  updates: Record<string, unknown>
}

export interface WriteTextFileParams {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
}

export interface WriteTextFileResult {
  success: boolean
  path: string
}

export interface ReadTextFileParams {
  path: string
  encoding?: 'utf8' | 'base64'
}

export interface ReadTextFileResult {
  content: string
  encoding: string
}

export interface ListDirParams {
  path: string
  recursive?: boolean
}

export interface DirEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
}

export interface ListDirResult {
  entries: DirEntry[]
}

export interface CreateTerminalParams {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface CreateTerminalResult {
  handle: string
}

export interface TerminalOutputParams {
  handle: string
}

export interface TerminalOutputResult {
  output: string
  done: boolean
}

export interface AcpClientInterface {
  requestPermission(params: PermissionRequest): Promise<PermissionResponse>
  sessionUpdate(params: SessionUpdateParams): Promise<void>
  writeTextFile(params: WriteTextFileParams): Promise<WriteTextFileResult>
  readTextFile(params: ReadTextFileParams): Promise<ReadTextFileResult>
  listDir(params: ListDirParams): Promise<ListDirResult>
  createTerminal(params: CreateTerminalParams): Promise<CreateTerminalResult>
  terminalOutput(params: TerminalOutputParams): Promise<TerminalOutputResult>
}

export interface ProcessSpawnOptions {
  cwd?: string
  env?: Record<string, string>
  stdio?: 'pipe' | 'inherit' | 'ignore'
}

export interface OpencodeCommandResult {
  success: boolean
  output?: string
  error?: string
  sessionId?: string
}