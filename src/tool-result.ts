/**
 * Tiny helper that builds the AgentToolResult shape the OpenClaw runtime
 * expects. Inlined here instead of importing from `openclaw/plugin-sdk/core`
 * because the SDK's bundled JS re-exports through a hashed chunk file
 * (`common-B7pbdYUb.js`) that doesn't resolve cleanly as a named import
 * from `openclaw/plugin-sdk/core` at test time. The function is 5 lines;
 * owning it avoids a fragile import.
 */

export interface ToolTextContent {
  type: 'text';
  text: string;
}

export interface ToolResult<T = unknown> {
  content: ToolTextContent[];
  details: T;
}

export function toolTextResult<T>(text: string, details: T): ToolResult<T> {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

export function toolJsonResult<T>(payload: T): ToolResult<T> {
  return toolTextResult(JSON.stringify(payload, null, 2), payload);
}
