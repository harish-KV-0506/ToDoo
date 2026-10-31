export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'
export type WorkspaceRole = 'owner' | 'member'

export type Task = {
  id: string
  workspace_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  assigned_to: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type Workspace = {
  id: string
  name: string
  created_by: string
  created_at: string
}

export type WorkspaceMember = {
  user_id: string
  role: WorkspaceRole
  display_name: string
}

export type WorkspaceInvitation = {
  id: string
  email: string
  expires_at: string
  created_at: string
}

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type Database = {
  public: {
    Tables: {
      profiles: Table<
        { user_id: string; display_name: string; created_at: string },
        { user_id: string; display_name: string; created_at?: string },
        { display_name?: string }
      >
      workspaces: Table<Workspace, never, never>
      workspace_members: Table<
        { workspace_id: string; user_id: string; role: WorkspaceRole; created_at: string },
        never,
        never
      >
      workspace_invitations: Table<
        { id: string; workspace_id: string; email: string; token_hash: string; invited_by: string; expires_at: string; accepted_at: string | null; created_at: string },
        never,
        never
      >
      tasks: Table<Task, Omit<Task, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string }>
    }
    Views: Record<string, never>
    Functions: {
      create_workspace: { Args: { workspace_name: string }; Returns: string }
      create_workspace_invitation: { Args: { target_workspace: string; invited_email: string; token_hash: string }; Returns: undefined }
      accept_workspace_invitation: { Args: { invitation_token: string }; Returns: string }
      is_workspace_member: { Args: { target_workspace: string }; Returns: boolean }
      shares_workspace_with: { Args: { target_user: string }; Returns: boolean }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type { Database }
