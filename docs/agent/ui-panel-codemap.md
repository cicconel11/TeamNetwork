# UI Panel — Code Map

## Overview

The AI assistant UI is a slide-out panel anchored to the right edge of the screen, available to org admins. It supports chat with streaming responses, thread management, markdown rendering, route-aware scope hints, starter prompts, and persisted open/close preference. All state is local (no global store). The panel communicates with the backend via `fetch` and consumes Server-Sent Events for streaming responses.

## File Map

### Components

| File | Purpose | Key Exports |
|---|---|---|
| `src/components/ai-assistant/index.ts` | Barrel file | `AIPanelProvider`, `useAIPanel`, `AIEdgeTab`, `AIPanel` |
| `src/components/ai-assistant/AIPanelContext.tsx` | React context provider for panel open/close state | `AIPanelProvider` (L22), `useAIPanel` (L59) |
| `src/components/ai-assistant/AIPanel.tsx` | Main panel component — chat view + thread list view | `AIPanel` (L24) |
| `src/components/ai-assistant/AIEdgeTab.tsx` | Floating edge tab to toggle the panel (admin-only) | `AIEdgeTab` (L10) |
| `src/components/ai-assistant/MessageList.tsx` | Renders message bubbles, streaming indicator, empty state, starter prompts | `MessageList` (L16) |
| `src/components/ai-assistant/MessageInput.tsx` | Textarea with send/stop buttons, error display, route-aware placeholder text | `MessageInput` (L14) |
| `src/components/ai-assistant/ThreadList.tsx` | Thread listing with select, new, and delete actions | `ThreadList` (L16) |
| `src/components/ai-assistant/AssistantMessageContent.tsx` | Markdown renderer (react-markdown + remark-gfm) | `AssistantMessageContent` (L11) |

### State & Utilities

| File | Purpose | Key Exports |
|---|---|---|
| `src/components/ai-assistant/panel-state.ts` | Pure state helpers — optimistic messages, thread deletion, retry identity | `AIPanelThread` type (L1), `AIPanelMessage` type (L8), `createOptimisticUserMessage` (L23), `removePanelMessage` (L38), `resolveRetryRequestIdentity` (L45), `applyThreadDeletion` (L66) |
| `src/components/ai-assistant/panel-preferences.ts` | Panel auto-open logic (admin + desktop gate) | `AI_PANEL_PREFERENCE_KEY` (L1), `resolveInitialAIPanelOpen` (L8) |
| `src/components/ai-assistant/thread-date.ts` | Date formatter for thread timestamps | `formatThreadUpdatedAt` (L8) |

### Hook

| File | Purpose | Key Exports |
|---|---|---|
| `src/hooks/useAIStream.ts` | SSE stream consumer — manages fetch, abort, state | `useAIStream` (L120), `consumeSSEStream` (L65), `parseAIChatFailure` (L45), `AIStreamResult` type (L17) |

## Component Tree

```
[orgSlug]/layout.tsx
  └── AIPanelProvider (autoOpen={isAdmin})
        ├── AIEdgeTab (isAdmin)     ← floating toggle button (right edge, z-44)
        └── AIPanel (orgId)         ← slide-out panel (right edge, z-45)
              ├── Header: title, scope badge, view toggle (chat/threads), close button
              ├── [view === "chat"]
              │     ├── MessageList
              │     │     ├── Empty state (Sparkles icon + prompt + starter prompt chips)
              │     │     ├── Message bubbles (user: indigo, assistant: muted)
              │     │     │     └── AssistantMessageContent (ReactMarkdown)
              │     │     ├── Preview assistant content (post-stream, pre-refresh)
              │     │     └── Streaming content (with cursor animation)
              │     └── MessageInput
              │           ├── Error banner (dismissible)
              │           ├── Streaming indicator ("Thinking..." + Stop)
              │           └── Textarea + Send/Stop button
              └── [view === "threads"]
                    └── ThreadList
                          ├── "New conversation" button
                          └── Thread rows (title, date, delete button)
```

## State Management

All state lives in `AIPanel` via `useState`. No global store or URL state.

| State | Type | Purpose |
|---|---|---|
| `view` | `"chat" \| "threads"` | Which view is shown |
| `activeThreadId` | `string \| null` | Currently selected thread |
| `threads` | `AIPanelThread[]` | Loaded thread list |
| `threadsLoading` | `boolean` | Thread list loading state |
| `messages` | `AIPanelMessage[]` | Messages in the active thread |
| `messagesLoading` | `boolean` | Message list loading state |
| `pendingAssistantContent` | `string \| null` | Streamed content shown before server refresh completes |

### `useAIStream` Hook State

| State | Type | Purpose |
|---|---|---|
| `isStreaming` | `boolean` | Whether an SSE stream is active |
| `error` | `string \| null` | Current error message |
| `currentContent` | `string` | Accumulated content from SSE chunks |
| `threadId` | `string \| null` | Thread ID from the current/last stream |
| `toolStatusLabel` | `string \| null` | Human-readable live tool progress label |

### Panel Open/Close

1. `AIPanelProvider` wraps the org layout, receives `autoOpen` prop (set to `isAdmin`)
2. On mount, checks `isDesktop` via `matchMedia("(min-width: 1024px)")`
3. `resolveInitialAIPanelOpen({ isAdmin, isDesktop, storedPreference })` → opens panel only for admins on desktop unless an explicit persisted preference exists
4. `localStorage` stores `"open"` / `"closed"` so the panel preference persists across navigations
5. `isMounted` ref prevents hydration mismatch by returning `isOpen: false` during SSR

### Optimistic Updates

1. User types message → `handleSend` creates `optimisticMessage` with deterministic ID
2. Optimistic message appended to `messages` immediately
3. `useAIStream.sendMessage` fires fetch + SSE stream
4. On success: messages reloaded from server (silent), `pendingAssistantContent` shown until load completes
5. On failure: optimistic message removed, messages reloaded from server

### Idempotency Key Management

- `idempotencyRef` tracks `{ content, threadId, key }` for the last sent message
- Same content + same thread → reuses the key (enables safe retry)
- Different content or thread → new UUID generated
- Key cleared after successful non-in-flight response

## SSE Streaming Client-Side Flow

```
handleSend(content)
  │
  ├─ 1. Create optimistic user message, append to state
  ├─ 2. useAIStream.sendMessage(content, { surface, threadId?, idempotencyKey })
  │       │
  │       ├─ POST /api/ai/{orgId}/chat
  │       │
  │       ├─ Non-OK response:
  │       │   ├─ 409 → return { threadId, inFlight: true } (duplicate, no error shown)
  │       │   └─ Other → set error state, return null
  │       │
  │       └─ OK (SSE stream):
  │           ├─ consumeSSEStream(response, callbacks)
  │           │   ├─ "chunk" → accumulate content, update currentContent state
  │           │   ├─ "done"  → set threadId, clear isStreaming
  │           │   └─ "error" → set error state, return null
  │           │
  │           └─ Return { threadId, content, replayed?, usage? }
  │
  ├─ 3. On null result: remove optimistic message, reload messages
  ├─ 4. On success:
  │       ├─ Set activeThreadId (if new thread)
  │       ├─ Set pendingAssistantContent = result.content
  │       └─ Parallel: loadMessages(silent) + loadThreads()
  └─ 5. Clear pendingAssistantContent after server messages load
```

## Test Coverage

| Test File | Cases | Coverage |
|---|---|---|
| `tests/ai-panel-state.test.ts` | 4 | `createOptimisticUserMessage`, `removePanelMessage`, `resolveRetryRequestIdentity`, `applyThreadDeletion` |
| `tests/ai-panel-preferences.test.ts` | 3 | `resolveInitialAIPanelOpen` — admin+desktop, non-admin, mobile |
| `tests/ai-panel-ssr-source.test.ts` | 2 | Verifies SSR-safe imports, no `window` references in module scope |
| `tests/ai-thread-date.test.ts` | 1 | `formatThreadUpdatedAt` — valid ISO, invalid string |
| `tests/ai-message-list.test.ts` | 5 | `MessageList` rendering scenarios (module-level, no DOM tests) |
| `tests/ai-toggle-visibility.test.ts` | 4 | Edge tab visibility, panel toggle behavior |
| `tests/ai-stream-consumer.test.ts` | 2 | `consumeSSEStream` — chunk/done parsing |
| `tests/ai-stream-failures.test.ts` | 2 | `parseAIChatFailure` — 409 handling, generic error |

### Gaps

- **0 component/integration tests** — no React Testing Library or similar tests for `AIPanel`, `MessageList`, `ThreadList`, `MessageInput`, or `AssistantMessageContent`
- Tests cover pure utility functions and module-level invariants only
