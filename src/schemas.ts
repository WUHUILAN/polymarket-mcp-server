import { z } from "zod";
import {
  Side,
  OrderType,
  AuthStatus,
  OrderStatus,
  ResponseFormat,
} from "./types.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_SPENDING_LIMIT,
  MAX_EXPIRY_HOURS,
} from "./constants.js";

// ── Shared ──────────────────────────────────────────

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.JSON)
  .describe("Output format: 'json' or 'markdown'.");

const paginationLimit = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_LIMIT)
  .default(DEFAULT_PAGE_LIMIT)
  .describe("Maximum results to return.");

const paginationOffset = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe("Number of results to skip.");

// ── Tool 1: authorize_market_trade ──────────────────

export const AuthorizeMarketTradeSchema = z
  .object({
    market_slug: z
      .string()
      .min(1, "Market slug is required")
      .max(200, "Market slug too long")
      .describe(
        "Polymarket market slug (e.g., 'will-trump-win-2024'). Use '*' for all markets."
      ),
    spending_limit: z
      .number()
      .positive("Spending limit must be positive")
      .max(MAX_SPENDING_LIMIT, `Spending limit cannot exceed ${MAX_SPENDING_LIMIT} USDC`)
      .describe("Maximum total USDC exposure allowed for this authorization."),
    max_order_size: z
      .number()
      .positive("Max order size must be positive")
      .describe("Maximum USDC amount per single order."),
    allowed_sides: z
      .array(z.nativeEnum(Side))
      .min(1, "At least one side must be allowed")
      .default([Side.BUY, Side.SELL])
      .describe("Which sides the authorization permits."),
    allowed_order_types: z
      .array(z.nativeEnum(OrderType))
      .min(1, "At least one order type must be allowed")
      .default([OrderType.GTC, OrderType.FOK])
      .describe("Order types permitted under this authorization."),
    expires_in_hours: z
      .number()
      .int()
      .positive()
      .max(MAX_EXPIRY_HOURS)
      .default(24)
      .describe("Authorization expiry in hours (max 720 = 30 days)."),
    response_format: responseFormat,
  })
  .strict();

export type AuthorizeMarketTradeInput = z.infer<
  typeof AuthorizeMarketTradeSchema
>;

// ── Tool 2: place_order ─────────────────────────────

export const PlaceOrderSchema = z
  .object({
    authorization_id: z
      .string()
      .uuid("Authorization ID must be a valid UUID")
      .describe("Authorization ID returned by authorize_market_trade."),
    market_slug: z
      .string()
      .min(1)
      .describe("Market slug (e.g., 'will-trump-win-2024')."),
    outcome: z
      .enum(["YES", "NO"])
      .describe("Which outcome token to trade."),
    side: z.nativeEnum(Side).describe("BUY or SELL."),
    amount: z
      .number()
      .positive("Amount must be positive")
      .max(MAX_SPENDING_LIMIT, "Amount exceeds max allowed.")
      .describe("Amount in USDC to spend (for BUY) or tokens to sell (for SELL)."),
    price: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "Price must be a numeric string")
      .describe("Limit price per token (e.g., '0.50')."),
    order_type: z
      .nativeEnum(OrderType)
      .default(OrderType.GTC)
      .describe("GTC=limit, GTD=limit+expiry, FOK=fill-or-kill, FAK=fill-and-kill."),
    expires_at: z
      .string()
      .datetime()
      .optional()
      .describe("ISO-8601 expiry timestamp (only for GTD orders)."),
    response_format: responseFormat,
  })
  .strict();

export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

// ── Tool 3: cancel_order ────────────────────────────

export const CancelOrderSchema = z
  .object({
    authorization_id: z
      .string()
      .uuid("Authorization ID must be a valid UUID")
      .describe("Authorization under which the order was placed."),
    order_id: z
      .string()
      .uuid("Order ID must be a valid UUID")
      .describe("The order ID to cancel (returned by place_order)."),
    response_format: responseFormat,
  })
  .strict();

export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

// ── Tool 4: revoke_authorization ────────────────────

export const RevokeAuthorizationSchema = z
  .object({
    authorization_id: z
      .string()
      .uuid("Authorization ID must be a valid UUID")
      .describe("Authorization ID to revoke."),
    reason: z
      .string()
      .max(500)
      .optional()
      .default("Revoked by user")
      .describe("Optional reason for revocation."),
    response_format: responseFormat,
  })
  .strict();

export type RevokeAuthorizationInput = z.infer<
  typeof RevokeAuthorizationSchema
>;

// ── Tool 5: get_current_permissions ─────────────────

export const GetCurrentPermissionsSchema = z
  .object({
    status_filter: z
      .nativeEnum(AuthStatus)
      .optional()
      .default(AuthStatus.ACTIVE)
      .describe("Filter by authorization status."),
    limit: paginationLimit,
    offset: paginationOffset,
    response_format: responseFormat,
  })
  .strict();

export type GetCurrentPermissionsInput = z.infer<
  typeof GetCurrentPermissionsSchema
>;

// ── Tool 6: get_order_history ───────────────────────

export const GetOrderHistorySchema = z
  .object({
    authorization_id: z
      .string()
      .uuid("Authorization ID must be a valid UUID")
      .describe("Authorization ID to query orders for."),
    status_filter: z
      .nativeEnum(OrderStatus)
      .optional()
      .describe("Filter by order status (e.g., 'FILLED', 'OPEN')."),
    market_slug: z
      .string()
      .optional()
      .describe("Filter by market slug."),
    side: z.nativeEnum(Side).optional().describe("Filter by side."),
    limit: paginationLimit,
    offset: paginationOffset,
    response_format: responseFormat,
  })
  .strict();

export type GetOrderHistoryInput = z.infer<typeof GetOrderHistorySchema>;
