# Agent Sender Metadata Enhancement

**Created:** 2026-02-11 09:48 AST  
**Priority:** Low (Quality of Life)  
**Status:** Proposed

## Problem

When agents communicate via `sessions_send`, the receiving agent cannot distinguish between:

- Messages from the human user
- Messages from another agent

This leads to confusion - e.g., CodeRev asking "are you asking me to review, or is the user asking?"

## Current Workaround

Agents manually prefix messages with their identity:

```
[ClawAppDev] Hey Revman, can you review PR #4...
```

This works but is:

- Manual (easy to forget)
- Not programmatically parseable
- Inconsistent across agents

## Proposed Solution

### Option 1: System Message Injection

When `sessions_send` is called, inject a system message before the agent's message:

```
[System: Message from agent clawappdev]
<actual message content>
```

**Pros:**

- Simple to implement
- Works with existing message flow
- Visible in transcript/history

**Cons:**

- Adds extra message to history
- Not structured metadata

### Option 2: Message Metadata Field

Add `fromAgent` field to message delivery:

```typescript
{
  role: "user",
  content: "...",
  metadata: {
    fromAgent: "clawappdev",
    sessionKey: "agent:clawappdev:main"
  }
}
```

**Pros:**

- Structured data
- Doesn't pollute message content
- Programmatically accessible

**Cons:**

- Requires changes to message structure
- Needs to be preserved through delivery chain

### Option 3: Session-Level Context Injection

Inject context into receiving agent's system prompt during agent-to-agent messaging:

```
Current session context:
- Responding to message from agent: clawappdev (ClawApp mobile developer)
```

**Pros:**

- Agent automatically knows the sender context
- No manual parsing needed

**Cons:**

- More complex implementation
- Need to maintain agent metadata registry

## Recommended Approach

**Option 2 (Message Metadata)** seems best:

1. Add `fromAgent` field to message delivery
2. Populate automatically in `sessions_send` tool handler
3. Inject into system prompt context when present
4. Keep in transcript metadata for debugging

## Implementation Notes

Files to modify:

- `src/agents/pi-embedded-messaging.ts` - sessions_send handler
- `src/agents/pi-embedded-subscribe.handlers.tools.ts` - tool handling
- Message delivery pipeline (wherever messages are routed)

## Related

- Agent-to-agent communication patterns
- Sub-agent announce mechanism (could use similar approach)
- Session isolation and authentication

## Testing

- ClawAppDev sends message to CodeRev → CodeRev sees sender metadata
- User sends message to CodeRev → No sender metadata (or `fromAgent: null`)
- Transcript shows metadata for debugging
- Backward compatible (old messages without metadata still work)
