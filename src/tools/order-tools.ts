import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OrderService } from "../services/order-service.js";
import { AppError, formatSuccess } from "../errors.js";
import {
  PlaceOrderSchema,
  CancelOrderSchema,
  GetOrderHistorySchema,
} from "../schemas.js";

export function registerOrderTools(
  server: McpServer,
  orderService: OrderService
): void {
  // ── place_order ───────────────────────────────────

  server.registerTool(
    "polymarket_place_order",
    {
      title: "Place Order",
      description: `Place an order on a Polymarket market under a prior authorization.

This tool requires a valid authorization created by authorize_market_trade.
The order result depends on the order type:
  - GTC (Good-Till-Cancelled): Resting limit order. Status will be OPEN.
  - GTD (Good-Till-Date): Like GTC but with an expiry time.
  - FOK (Fill-Or-Kill): Market order. Filled completely or rejected.
  - FAK (Fill-And-Kill): Market order. Filled up to available liquidity, rest cancelled.

Returns a spending_summary with total_spent, remaining_limit, and active_order_count.

Args:
  - authorization_id (uuid): From authorize_market_trade
  - market_slug (string): e.g., 'will-trump-win-2024'
  - outcome ("YES" | "NO"): Which token to trade
  - side ("BUY" | "SELL"): Buy or sell
  - amount (number): USDC amount (BUY) or token amount (SELL)
  - price (string): Limit price, e.g., "0.50"
  - order_type (OrderType): GTC, GTD, FOK, or FAK. Default GTC.
  - expires_at (string): ISO-8601, only for GTD orders
  - response_format ("json" | "markdown"): Output format

Returns:
  {
    "order": { "id": "uuid", "status": "OPEN", "filled_size": 0, ... },
    "spending_summary": { "total_spent": 0, "remaining_limit": 500, "active_order_count": 1 }
  }

Error Handling:
  - AUTH_NOT_FOUND/EXPIRED/REVOKED: Auth is invalid
  - MARKET_NOT_FOUND: Slug doesn't match any market
  - LIMIT_EXCEEDED: Amount exceeds max_order_size
  - SPENDING_LIMIT_EXCEEDED: Would exceed spending_limit
  - INVALID_PRICE: Price doesn't respect tick size
  - INSUFFICIENT_LIQUIDITY: FOK/FAK can't be filled`,
      inputSchema: PlaceOrderSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = orderService.placeOrder({
          authorizationId: params.authorization_id,
          marketSlug: params.market_slug,
          outcome: params.outcome,
          side: params.side,
          amount: params.amount,
          price: params.price,
          orderType: params.order_type,
          expiresAt: params.expires_at,
        });

        return formatSuccess(
          {
            order: {
              id: result.order.id,
              market_id: result.order.marketId,
              side: result.order.side,
              outcome: params.outcome,
              order_type: result.order.orderType,
              price: result.order.price,
              original_size: result.order.originalSize,
              filled_size: result.order.filledSize,
              remaining_size: result.order.remainingSize,
              status: result.order.status,
              created_at: result.order.createdAt,
              matched_orders: result.order.matchedOrders,
              ...(result.order.rejectionReason
                ? { rejection_reason: result.order.rejectionReason }
                : {}),
            },
            spending_summary: result.spendingSummary,
          },
          (params as any).response_format
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── cancel_order ──────────────────────────────────

  server.registerTool(
    "polymarket_cancel_order",
    {
      title: "Cancel Order",
      description: `Cancel an existing open or partially filled order.

Only orders in OPEN or PARTIALLY_FILLED status can be cancelled.
FILLED, REJECTED, EXPIRED, and CANCELLED orders cannot be cancelled.

Args:
  - authorization_id (uuid): Auth used to place the order
  - order_id (uuid): Order ID to cancel (from place_order)
  - response_format ("json" | "markdown"): Output format

Returns:
  {
    "order": { "id": "uuid", "previous_status": "OPEN", "new_status": "CANCELLED" },
    "spending_summary": { "total_spent": 0, "remaining_limit": 500, "active_order_count": 0 }
  }

Error Handling:
  - ORDER_NOT_FOUND: Order doesn't exist
  - ORDER_NOT_CANCELLABLE: Order is already in a final state
  - ORDER_AUTH_MISMATCH: Order was placed under a different authorization`,
      inputSchema: CancelOrderSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = orderService.cancelOrder(
          params.authorization_id,
          params.order_id
        );

        return formatSuccess(
          {
            order: {
              id: result.order.id,
              previous_status: result.order.status === "CANCELLED"
                ? (params as any)._previousStatus || "OPEN"
                : result.order.status,
              new_status: result.order.status,
              side: result.order.side,
              price: result.order.price,
              original_size: result.order.originalSize,
              filled_size: result.order.filledSize,
            },
            spending_summary: result.spendingSummary,
          },
          (params as any).response_format
        );
      } catch (error) {
        return handleError(error);
      }
    }
  );

  // ── get_order_history ─────────────────────────────

  server.registerTool(
    "polymarket_get_order_history",
    {
      title: "Get Order History",
      description: `Retrieves order history for a specific authorization.

Supports filtering by order status, market slug, and side with pagination.
GTD orders past their expiry are automatically marked as EXPIRED when queried.

Args:
  - authorization_id (uuid): Auth ID to query orders for
  - status_filter (OrderStatus): Optional status filter
  - market_slug (string): Optional market filter
  - side ("BUY" | "SELL"): Optional side filter
  - limit (number): Page size (1-100). Default 20.
  - offset (number): Results to skip. Default 0.
  - response_format ("json" | "markdown"): Output format

Returns:
  {
    "total": 5,
    "count": 5,
    "offset": 0,
    "orders": [{ "id": "...", "status": "FILLED", ... }],
    "has_more": false
  }`,
      inputSchema: GetOrderHistorySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = orderService.getOrderHistory(params.authorization_id, {
          statusFilter: params.status_filter,
          marketSlug: params.market_slug,
          side: params.side,
          limit: params.limit,
          offset: params.offset,
        });

        return formatSuccess(result, (params as any).response_format);
      } catch (error) {
        return handleError(error);
      }
    }
  );
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
