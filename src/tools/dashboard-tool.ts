import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthService } from "../services/auth-service.js";
import { InMemoryStore } from "../store/in-memory-store.js";
import { AppError, formatSuccess } from "../errors.js";
import { DashboardSchema } from "../schemas.js";
import { AuthStatus } from "../types.js";

// ── Dashboard Tool ──────────────────────────────────

export function registerDashboardTool(
  server: McpServer,
  authService: AuthService,
  store: InMemoryStore
): void {
  server.registerTool(
    "polymarket_dashboard",
    {
      title: "Dashboard — Authorization & Order Overview",
      description: `One-stop overview of all trading authorizations and recent orders.

Returns a consolidated dashboard showing every active authorization with its ID prominently displayed, plus spending summaries and the 5 most recent orders across all authorizations.

Use this tool whenever you need to:
  - Find an authorization_id quickly (no need to scroll through history)
  - Check overall spending status at a glance
  - See what orders have been placed recently

Args:
  - response_format ("json" | "markdown"): Output format. Default "json".

Returns:
  {
    "summary": { total_authorizations, active_authorizations, total_spent_all, total_active_orders },
    "authorizations": [{ authorization_id, market, status, spending_limit, spent, remaining, active_orders, expires_at }],
    "recent_orders": [{ order_id, authorization_id, market, side, status, created_at }]  // last 5
  }`,
      inputSchema: DashboardSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Gather all auth data
        const allAuths = authService.listPermissions(
          AuthStatus.ACTIVE,
          100,
          0
        );
        const expiredAuths = authService.listPermissions(
          AuthStatus.EXPIRED,
          100,
          0
        );
        const revokedAuths = authService.listPermissions(
          AuthStatus.REVOKED,
          100,
          0
        );

        const authorizations = [
          ...allAuths.authorizations.map((a) => formatAuthRow(a)),
          ...expiredAuths.authorizations.map((a) => formatAuthRow(a)),
          ...revokedAuths.authorizations.map((a) => formatAuthRow(a)),
        ];

        const activeAuths = allAuths.authorizations;
        const totalSpent = activeAuths.reduce(
          (sum, a) => sum + (a.usage?.totalSpent ?? 0),
          0
        );
        const totalActiveOrders = activeAuths.reduce(
          (sum, a) => sum + (a.usage?.activeOrderCount ?? 0),
          0
        );

        // Recent orders (last 5 across all auths)
        const allOrders = store.listOrders({});
        allOrders.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const recentOrders = allOrders.slice(0, 5).map((o) => {
          const market = store.getMarket(o.marketId);
          return {
            order_id: o.id,
            authorization_id: o.authorizationId,
            market: market?.slug ?? o.marketId,
            side: o.side,
            status: o.status,
            price: o.price,
            amount: o.originalSize,
            created_at: o.createdAt,
          };
        });

        return formatSuccess(
          {
            summary: {
              total_authorizations: allAuths.total + expiredAuths.total + revokedAuths.total,
              active_authorizations: allAuths.total,
              total_spent_all: Math.round(totalSpent * 100) / 100,
              total_active_orders: totalActiveOrders,
            },
            authorizations,
            recent_orders: recentOrders,
          },
          (params as any).response_format
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );
}

// ── Authorization Resources ─────────────────────────
// Registered as MCP Resources so they appear in Inspector's Resources panel,
// separate from the History panel. No need to scroll through tool calls.
//
// Uses ResourceTemplate with a list callback to dynamically list all active
// authorizations, and a URI template (auth://{authId}) for individual reads.

export function registerAuthorizationResources(
  server: McpServer,
  authService: AuthService,
  store: InMemoryStore
): void {
  const template = new ResourceTemplate("auth://{authId}", {
    list: async () => {
      const result = authService.listPermissions(AuthStatus.ACTIVE, 100, 0);
      return {
        resources: result.authorizations.map((a) => ({
          uri: `auth://${a.id}`,
          name: `${a.marketSlug} (${a.usage.remainingLimit} USDC left)`,
          mimeType: "application/json" as const,
          description: `Market: ${a.marketTitle}. Limit: ${a.spendingLimit} USDC, Spent: ${a.usage.totalSpent} USDC, Active orders: ${a.usage.activeOrderCount}. Expires: ${new Date(a.expiresAt).toLocaleString()}.`,
        })),
      };
    },
  });

  server.registerResource(
    "Authorization Detail",
    template,
    {
      title: "Authorization Detail",
      description:
        "Full details and usage summary for a trading authorization.",
      mimeType: "application/json",
    },
    async (uri: URL) => {
      const authId = uri.href.replace("auth://", "");
      const auth = store.getAuth(authId);

      if (!auth) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  error: {
                    code: "AUTH_NOT_FOUND",
                    message: `Authorization '${authId}' not found. It may have been revoked or expired.`,
                    suggestion: "Refresh the Resources list to see current authorizations.",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const market =
        auth.marketId !== "*" ? store.getMarket(auth.marketId) : null;
      const usage = store.getSpendingSummary(authId, auth.spendingLimit);
      const orders = store.listOrders({ authId });
      const recentOrders = orders
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 10)
        .map((o) => ({
          id: o.id,
          side: o.side,
          order_type: o.orderType,
          price: o.price,
          original_size: o.originalSize,
          filled_size: o.filledSize,
          status: o.status,
          created_at: o.createdAt,
        }));

      const detail = {
        authorization_id: auth.id,
        market: market
          ? { slug: market.slug, title: market.title, id: market.id }
          : { slug: "*", title: "All Markets", id: "*" },
        status: auth.status,
        limits: {
          spending_limit: auth.spendingLimit,
          max_order_size: auth.maxOrderSize,
          allowed_sides: auth.allowedSides,
          allowed_order_types: auth.allowedOrderTypes,
        },
        usage,
        dates: {
          created_at: auth.createdAt,
          expires_at: auth.expiresAt,
          last_used_at: auth.lastUsedAt,
        },
        recent_orders: recentOrders,
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    }
  );
}

// ── Helpers ─────────────────────────────────────────

function formatAuthRow(a: any) {
  return {
    authorization_id: a.id,
    market: a.marketSlug,
    status: a.status,
    spending_limit: a.spendingLimit,
    spent: a.usage?.totalSpent ?? 0,
    remaining: a.usage?.remainingLimit ?? a.spendingLimit,
    active_orders: a.usage?.activeOrderCount ?? 0,
    expires_at: a.expiresAt,
  };
}

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
