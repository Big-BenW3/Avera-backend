/**
 * Buildspace API module: src/db/schema.ts
 * Defines the durable PostgreSQL tables, relationships, indexes, and enums for the full product.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Enums remain small and explicit. UI labels are mapped in contracts rather than stored as free text.
export const spaceVisibility = pgEnum("space_visibility", ["public", "private"]);
export const spaceType = pgEnum("space_type", ["startup", "hackathon", "open_source", "client_project", "personal", "experiment"]);
export const membershipStatus = pgEnum("membership_status", ["invited", "active", "removed"]);
export const joinRequestStatus = pgEnum("join_request_status", ["pending", "accepted", "declined", "withdrawn"]);
export const ideaLifecycle = pgEnum("idea_lifecycle", ["idea", "discussion", "team_forming", "promoted", "archived"]);
export const taskStatus = pgEnum("task_status", ["todo", "in_progress", "done"]);
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const conversationKind = pgEnum("conversation_kind", ["space", "direct"]);
export const messageRequestStatus = pgEnum("message_request_status", ["pending", "accepted", "declined"]);
export const callStatus = pgEnum("call_status", ["scheduled", "live", "ended", "cancelled"]);
export const notificationKind = pgEnum("notification_kind", ["invitation", "join_request", "mention", "comment", "task", "security", "call", "system"]);
export const aiRunStatus = pgEnum("ai_run_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const integrationProvider = pgEnum("integration_provider", ["github", "figma"]);
export const reportStatus = pgEnum("report_status", ["open", "reviewing", "resolved", "dismissed"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// Identity and account security ------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash"),
  handle: varchar("handle", { length: 40 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  bio: text("bio"),
  avatarKey: text("avatar_key"),
  skills: jsonb("skills").notNull().default([]),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_handle_unique").on(table.handle),
]);

export const authIdentities = pgTable("auth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  createdAt,
}, (table) => [uniqueIndex("auth_identity_provider_unique").on(table.provider, table.providerAccountId)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipHash: varchar("ip_hash", { length: 128 }),
  userAgent: text("user_agent"),
  createdAt,
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash), index("sessions_user_active_idx").on(table.userId, table.expiresAt)]);

export const mfaFactors = pgTable("mfa_factors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secretCiphertext: text("secret_ciphertext").notNull(),
  recoveryCodeHashes: jsonb("recovery_code_hashes").notNull().default([]),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt,
});

export const userBlocks = pgTable("user_blocks", {
  blockerUserId: uuid("blocker_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedUserId: uuid("blocked_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.blockerUserId, table.blockedUserId] })]);

// Spaces, roles, and membership ------------------------------------------------
export const spaces = pgTable("spaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 96 }).notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  sourceIdeaId: uuid("source_idea_id"),
  name: varchar("name", { length: 140 }).notNull(),
  summary: text("summary").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  type: spaceType("type").notNull(),
  visibility: spaceVisibility("visibility").notNull().default("private"),
  recruiting: boolean("recruiting").notNull().default(false),
  maxMembers: integer("max_members").notNull().default(5),
  productStage: varchar("product_stage", { length: 48 }).notNull().default("exploring"),
  externalUrl: text("external_url"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("spaces_slug_unique").on(table.slug), index("spaces_discovery_idx").on(table.visibility, table.category, table.archivedAt)]);

export const spaceRoles = pgTable("space_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  isOwnerRole: boolean("is_owner_role").notNull().default(false),
  permissions: jsonb("permissions").notNull().default([]),
  createdAt,
}, (table) => [uniqueIndex("space_roles_name_unique").on(table.spaceId, table.name)]);

export const spaceMemberships = pgTable("space_memberships", {
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").references(() => spaceRoles.id, { onDelete: "set null" }),
  status: membershipStatus("status").notNull().default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.spaceId, table.userId] }), index("space_memberships_user_idx").on(table.userId, table.status)]);

export const spaceInvites = pgTable("space_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  inviterUserId: uuid("inviter_user_id").notNull().references(() => users.id),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  roleId: uuid("role_id").references(() => spaceRoles.id, { onDelete: "set null" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  createdAt,
}, (table) => [uniqueIndex("space_invites_token_unique").on(table.tokenHash), index("space_invites_space_idx").on(table.spaceId, table.expiresAt)]);

export const joinRequests = pgTable("join_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  desiredRole: varchar("desired_role", { length: 100 }),
  note: text("note"),
  status: joinRequestStatus("status").notNull().default("pending"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt,
}, (table) => [uniqueIndex("join_requests_unique_open").on(table.spaceId, table.userId), index("join_requests_space_status_idx").on(table.spaceId, table.status)]);

export const spaceBans = pgTable("space_bans", {
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  reason: text("reason"),
  createdAt,
}, (table) => [primaryKey({ columns: [table.spaceId, table.userId] })]);

export const spaceTimeboxes = pgTable("space_timeboxes", {
  spaceId: uuid("space_id").primaryKey().references(() => spaces.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  reminderEnabled: boolean("reminder_enabled").notNull().default(true),
  createdAt,
  updatedAt,
});

// Public ideas and the path from signal to Space --------------------------------
export const ideas = pgTable("ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  promotedSpaceId: uuid("promoted_space_id").references(() => spaces.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  lookingFor: varchar("looking_for", { length: 120 }),
  lifecycle: ideaLifecycle("lifecycle").notNull().default("idea"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt,
  updatedAt,
}, (table) => [index("ideas_discovery_idx").on(table.isPublic, table.category, table.createdAt), index("ideas_author_idx").on(table.authorUserId, table.lifecycle)]);

export const ideaInterests = pgTable("idea_interests", {
  ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.ideaId, table.userId] })]);

export const ideaBookmarks = pgTable("idea_bookmarks", {
  ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.ideaId, table.userId] })]);

export const ideaOffers = pgTable("idea_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  offer: text("offer").notNull(),
  availability: varchar("availability", { length: 80 }),
  createdAt,
}, (table) => [uniqueIndex("idea_offers_one_per_user_unique").on(table.ideaId, table.userId)]);

export const ideaComments = pgTable("idea_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenByUserId: uuid("hidden_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
}, (table) => [index("idea_comments_idea_created_idx").on(table.ideaId, table.createdAt)]);

// Plans, tasks, designs, files, and the readable work record --------------------
export const planningNotes = pgTable("planning_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  color: varchar("color", { length: 32 }).notNull().default("yellow"),
  promotedTaskId: uuid("promoted_task_id"),
  createdAt,
  updatedAt,
});

export const roadmapItems = pgTable("roadmap_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  horizon: varchar("horizon", { length: 32 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  createdAt,
  updatedAt,
}, (table) => [index("roadmap_space_horizon_idx").on(table.spaceId, table.horizon, table.position)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  roadmapItemId: uuid("roadmap_item_id").references(() => roadmapItems.id, { onDelete: "set null" }),
  planningNoteId: uuid("planning_note_id").references(() => planningNotes.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description"),
  area: varchar("area", { length: 80 }).notNull().default("Product"),
  status: taskStatus("status").notNull().default("todo"),
  priority: taskPriority("priority").notNull().default("medium"),
  position: integer("position").notNull().default(0),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, (table) => [index("tasks_space_board_idx").on(table.spaceId, table.status, table.position), index("tasks_assignee_idx").on(table.assigneeUserId, table.status)]);

export const taskComments = pgTable("task_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt,
  updatedAt,
}, (table) => [index("task_comments_task_created_idx").on(table.taskId, table.createdAt)]);

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  objectKey: text("object_key").notNull(),
  contentType: varchar("content_type", { length: 160 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  createdAt,
}, (table) => [uniqueIndex("files_object_key_unique").on(table.objectKey)]);

export const fileLinks = pgTable("file_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  createdAt,
}, (table) => [index("file_links_entity_idx").on(table.entityType, table.entityId)]);

export const designLinks = pgTable("design_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull().default("figma"),
  externalFileId: varchar("external_file_id", { length: 255 }).notNull(),
  url: text("url").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  createdAt,
  updatedAt,
});

// Collaboration: chats, direct messages, calls, notifications -------------------
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: conversationKind("kind").notNull(),
  spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "cascade" }),
  createdAt,
  updatedAt,
});

export const conversationMembers = pgTable("conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.conversationId, table.userId] })]);

export const messageRequests = pgTable("message_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  senderUserId: uuid("sender_user_id").notNull().references(() => users.id),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  status: messageRequestStatus("status").notNull().default("pending"),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  createdAt,
  updatedAt,
}, (table) => [index("message_requests_recipient_idx").on(table.recipientUserId, table.status)]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  replyToMessageId: uuid("reply_to_message_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt,
}, (table) => [index("messages_conversation_created_idx").on(table.conversationId, table.createdAt)]);

export const messageReceipts = pgTable("message_receipts", {
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.messageId, table.userId] })]);

export const callSessions = pgTable("call_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  startedByUserId: uuid("started_by_user_id").notNull().references(() => users.id),
  livekitRoom: varchar("livekit_room", { length: 160 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  status: callStatus("status").notNull().default("scheduled"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt,
}, (table) => [uniqueIndex("call_sessions_room_unique").on(table.livekitRoom), index("call_sessions_space_status_idx").on(table.spaceId, table.status)]);

export const callParticipants = pgTable("call_participants", {
  callSessionId: uuid("call_session_id").notNull().references(() => callSessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.callSessionId, table.userId] })]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: notificationKind("kind").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  href: text("href"),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt,
}, (table) => [index("notifications_user_unread_idx").on(table.userId, table.readAt, table.createdAt)]);

// Activity, integrations, AI, and safety ----------------------------------------
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  type: varchar("type", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt,
}, (table) => [index("activity_events_space_created_idx").on(table.spaceId, table.createdAt)]);

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  provider: integrationProvider("provider").notNull(),
  externalId: varchar("external_id", { length: 255 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  secretCiphertext: text("secret_ciphertext"),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("integration_connections_unique").on(table.spaceId, table.provider, table.externalId)]);

export const spaceAiSettings = pgTable("space_ai_settings", {
  spaceId: uuid("space_id").primaryKey().references(() => spaces.id, { onDelete: "cascade" }),
  enabledSources: jsonb("enabled_sources").notNull().default(["roadmap", "tasks", "activity", "design", "build"]),
  // Conversations are intentionally absent: Project Memory must never index chat or DMs.
  chatExcluded: boolean("chat_excluded").notNull().default(true),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id),
  updatedAt,
});

export const aiSourceDocuments = pgTable("ai_source_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  sourceType: varchar("source_type", { length: 64 }).notNull(),
  sourceId: uuid("source_id").notNull(),
  contentHash: varchar("content_hash", { length: 128 }).notNull(),
  body: text("body").notNull(),
  // JSON keeps the first version portable. A later pgvector migration can add a vector column.
  embedding: jsonb("embedding"),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  createdAt,
}, (table) => [uniqueIndex("ai_source_documents_source_unique").on(table.spaceId, table.sourceType, table.sourceId)]);

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
  kind: varchar("kind", { length: 64 }).notNull(),
  status: aiRunStatus("status").notNull().default("queued"),
  provider: varchar("provider", { length: 64 }).notNull().default("nvidia_nim"),
  modelId: varchar("model_id", { length: 160 }),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output"),
  errorMessage: text("error_message"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt,
  updatedAt,
}, (table) => [index("ai_runs_space_created_idx").on(table.spaceId, table.createdAt)]);

export const aiCitations = pgTable("ai_citations", {
  id: uuid("id").defaultRandom().primaryKey(),
  aiRunId: uuid("ai_run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => aiSourceDocuments.id, { onDelete: "cascade" }),
  excerpt: text("excerpt").notNull(),
  createdAt,
});

export const contentReports = pgTable("content_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  reporterUserId: uuid("reporter_user_id").notNull().references(() => users.id),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  context: text("context"),
  status: reportStatus("status").notNull().default("open"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
}, (table) => [index("content_reports_status_idx").on(table.status, table.createdAt)]);

// The transactional outbox makes notifications, AI indexing, and webhooks reliable.
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 100 }).notNull(),
  aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt,
}, (table) => [index("outbox_events_ready_idx").on(table.processedAt, table.availableAt)]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: varchar("key", { length: 255 }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestHash: varchar("request_hash", { length: 128 }).notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
});

// Discovery records are intentionally simple. Announcements are authored by a backend-admin tool later.
export const announcements = pgTable("announcements", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  href: text("href"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  priority: integer("priority").notNull().default(0),
  createdAt,
}, (table) => [index("announcements_active_idx").on(table.startsAt, table.endsAt, table.priority)]);

export const spaceFollows = pgTable("space_follows", {
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.spaceId, table.userId] })]);
