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

export type ProfessionalProfile = {
  user_id: string
  display_name: string
  headline: string | null
  bio: string | null
  location: string | null
  portfolio_url: string | null
  avatar_path: string | null
  created_at: string
}

export type BirthdayVisibility = 'public' | 'hide_year' | 'hidden'

export type PrivateProfileDetails = {
  user_id: string
  linkedin_url: string | null
  social_links: string[]
  date_of_birth: string | null
  birthday_visibility: BirthdayVisibility
}

export type PublicProfileDetails = {
  user_id: string
  linkedin_url: string | null
  social_links: string[]
  public_birthday: string | null
}

export type WorkPost = {
  id: string
  author_id: string
  content: string
  project_url: string | null
  project_title: string | null
  project_description: string | null
  project_image_url: string | null
  image_path: string | null
  created_at: string
}

export type WorkPostComment = {
  id: string
  post_id: string
  author_id: string
  content: string
  created_at: string
}

export type ProfessionalConnection = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  updated_at: string
}

export type DirectMessageRequest = {
  id: string
  sender_id: string
  recipient_id: string
  initial_message: string
  status: 'pending' | 'accepted' | 'declined'
  created_at: string
}

export type DirectMessage = {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  created_at: string
  read_at: string | null
}

export type GameGenre = 'arcade' | 'puzzle' | 'platformer' | 'strategy' | 'other'

export type CommunityGame = {
  id: string
  author_id: string
  title: string
  description: string
  genre: GameGenre
  html: string
  created_at: string
}

export type GameActivity = {
  user_id: string
  activity_date: string
  activity_type: 'created' | 'played'
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
        ProfessionalProfile,
        Omit<ProfessionalProfile, 'created_at'> & { created_at?: string },
        Partial<Omit<ProfessionalProfile, 'user_id' | 'created_at'>>
      >
      private_profile_details: Table<
        PrivateProfileDetails,
        PrivateProfileDetails,
        never
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
      work_posts: Table<
        WorkPost,
        Omit<WorkPost, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<WorkPost, 'id' | 'author_id' | 'created_at'>>
      >
      work_post_comments: Table<
        WorkPostComment,
        Omit<WorkPostComment, 'id' | 'created_at'> & { id?: string; created_at?: string },
        never
      >
      work_post_useful_marks: Table<
        { post_id: string; user_id: string; created_at: string },
        { post_id: string; user_id: string; created_at?: string },
        never
      >
      professional_connections: Table<
        ProfessionalConnection,
        Omit<ProfessionalConnection, 'id' | 'created_at' | 'updated_at'> & { id?: string; created_at?: string; updated_at?: string },
        Partial<Pick<ProfessionalConnection, 'status'>>
      >
      direct_message_requests: Table<
        DirectMessageRequest,
        Omit<DirectMessageRequest, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Pick<DirectMessageRequest, 'status'>>
      >
      direct_messages: Table<
        DirectMessage,
        Omit<DirectMessage, 'id' | 'created_at' | 'read_at'> & { id?: string; created_at?: string; read_at?: string | null },
        Partial<Pick<DirectMessage, 'read_at'>>
      >
      community_games: Table<
        CommunityGame,
        Omit<CommunityGame, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Pick<CommunityGame, 'title' | 'description' | 'genre' | 'html'>>
      >
      game_activity: Table<
        GameActivity,
        Omit<GameActivity, 'created_at'> & { created_at?: string },
        never
      >
    }
    Views: Record<string, never>
    Functions: {
      create_workspace: { Args: { workspace_name: string }; Returns: string }
      create_workspace_invitation: { Args: { target_workspace: string; invited_email: string; token_hash: string }; Returns: undefined }
      accept_workspace_invitation: { Args: { invitation_token: string }; Returns: string }
      is_workspace_member: { Args: { target_workspace: string }; Returns: boolean }
      shares_workspace_with: { Args: { target_user: string }; Returns: boolean }
      'link-preview': {
        Args: { url: string }
        Returns: { title: string; description: string | null; image_url: string | null; site_name: string | null }
      }
      get_public_profile_details: {
        Args: Record<string, never>
        Returns: PublicProfileDetails[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type { Database }
