import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthService } from "../services/auth-service.js";
import { AppError, formatSuccess } from "../errors.js";
import { Side, OrderType } from "../types.js";
import {
  AuthorizeMarketTradeSchema,
  RevokeAuthorizationSchema,
  GetCurrentPermissionsSchema,
} from "../schemas.js";

export function registerAuthorizationTools(
  server: McpServer,
  authService: AuthService
): void {
  // ── authorize_market_trade ────────────────────────

  server.registerTool(
    "polymarket_authorize_market_trade",
    {
      title: "Authorize Market Trade",
      description: `Creates a trading authorization for Polymarket, granting the LLM permission to place orders on specified markets under defined spending limits and guardrails.

This tool MUST be called before any order can be placed. The returned authorization ID is required by place_order, cancel_order, and get_order_history.

Args:
  - market_slug (string): Polymarket market slug or "*" for all markets
  - spending_limit (number): Max total USDC exposure (e.g., 500 = 500 USDC)
  - max_order_size (number): Max USDC per single order
  - allowed_sides (string): Comma-separated. 'BUY,SELL' for both, 'BUY' for buy only, 'SELL' for sell only. Default 'BUY,SELL'.
  - allowed_order_types (string): Comma-separated. 'GTC,GTD,FOK,FAK'. Common: 'GTC,FOK' (limit+market), 'GTC' (limit only), 'FOK,FAK' (market only). Default 'GTC,FOK'.
  - expires_in_hours (number): Auth validity. Default 24, max 720.
  - response_format ("json" | "markdown"): Output format.

Returns:
  {
    "authorization_id": "uuid",
    "market": { "slug": "...", "title": "...", "id": "..." },
    "limits": { "spending_limit": 500, "max_order_size": 100 },
    "spending_summary": { "total_spent": 0, "remaining_limit": 500, "active_order_count": 0 },
    "status": "ACTIVE",
    "created_at": "...",
    "expires_at": "..."
  }

Error Handling:
  - Market slug not found: lists available markets
  - spending_limit < max_order_size: validation error`,
      inputSchema: AuthorizeMarketTradeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const allowedSides = parseEnumList(
          params.allowed_sides,
          Side,
          "allowed_sides"
        );
        const allowedOrderTypes = parseEnumList(
          params.allowed_order_types,
          OrderType,
          "allowed_order_types"
        );

        const result = authService.authorize({
          marketSlug: params.market_slug,
          spendingLimit: params.spending_limit,
          maxOrderSize: params.max_order_size,
          allowedSides,
          allowedOrderTypes,
          expiresInHours: params.expires_in_hours,
        });

        return formatSuccess(
          {
            authorization_id: result.id,
            market: {
              slug: result.marketSlug,
              title: result.marketTitle,
              id: result.marketId,
            },
            limits: {
              spending_limit: result.spendingLimit,
              max_order_size: result.maxOrderSize,
              allowed_sides: result.allowedSides,
              allowed_order_types: result.allowedOrderTypes,
            },
            spending_summary: result.spendingSummary,
            status: result.status,
            created_at: result.createdAt,
            expires_at: result.expiresAt,
          },
          (params as any).response_format
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── revoke_authorization ──────────────────────────

  server.registerTool(
    "polymarket_revoke_authorization",
    {
      title: "Revoke Authorization",
      description: `Revokes an existing trading authorization, immediately invalidating it. All subsequent operations using this authorization will be rejected.

Args:
  - authorization_id (uuid): The authorization to revoke
  - reason (string): Optional reason for revocation
  - response_format ("json" | "markdown"): Output format

Returns:
  {
    "authorization_id": "uuid",
    "previous_status": "ACTIVE",
    "new_status": "REVOKED"
  }

Error Handling:
  - Auth not found: use get_current_permissions to list valid IDs
  - Auth already inactive: returns current status`,
      inputSchema: RevokeAuthorizationSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const auth = authService.revoke(
          params.authorization_id,
          params.reason
        );

        return formatSuccess(
          {
            authorization_id: auth.id,
            previous_status: auth.status === "REVOKED" ? "ACTIVE" : auth.status,
            new_status: "REVOKED",
            reason: params.reason,
          },
          (params as any).response_format
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── get_current_permissions ───────────────────────

  server.registerTool(
    "polymarket_get_current_permissions",
    {
      title: "Get Current Permissions",
      description: `Lists all trading authorizations with their current status, limits, and usage summary.

Each authorization entry includes a usage field showing:
  - total_spent: Total USDC spent under this authorization
  - remaining_limit: How much spending room is left
  - active_order_count: Number of currently open/active orders

Supports pagination and status filtering.

Args:
  - status_filter (AuthStatus): Filter by status. Default ACTIVE.
  - limit (number): Page size (1-100). Default 20.
  - offset (number): Results to skip. Default 0.
  - response_format ("json" | "markdown"): Output format.

Returns:
  {
    "total": 3,
    "count": 3,
    "offset": 0,
    "authorizations": [{ "...": "...", "usage": {...} }],
    "has_more": false
  }`,
      inputSchema: GetCurrentPermissionsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = authService.listPermissions(
          params.status_filter,
          params.limit,
          params.offset
        );

        return formatSuccess(result, (params as any).response_format);
      } catch (error) {
        return handleError(error);
      }
    }
  );
}

// ── Helpers ──────────────────────────────────────────

function parseEnumList<T extends string>(
  raw: string,
  enumType: Record<string, T>,
  fieldName: string
): T[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);

  if (parts.length === 0) {
    throw new AppError(
      "INVALID_INPUT",
      `Field '${fieldName}' is empty.`,
      `Provide at least one value, e.g., 'BUY,SELL'.`
    );
  }

  const validValues = Object.values(enumType) as T[];
  for (const part of parts) {
    if (!validValues.includes(part as T)) {
      throw new AppError(
        "INVALID_INPUT",
        `Invalid value '${part}' in '${fieldName}'.`,
        `Valid values: ${validValues.join(", ")}.`
      );
    }
  }

  return parts as T[];
}

// ── Shared Error Handler ────────────────────────────

function handleError(error: unknown) {
  if (error instanceof AppError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: error.toJSON() }, null, 2),
        },
      ],
    };
  }

  console.error("Unexpected error:", error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "An unexpected error occurred.",
              suggestion: "Please try again.",
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
