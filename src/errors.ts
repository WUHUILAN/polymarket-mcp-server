import { ResponseFormat } from "./types.js";

// ── Custom Error Class ──────────────────────────────

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
    };
  }
}

// ── Error Factory ───────────────────────────────────

export const Errors = {
  authNotFound: (id: string) =>
    new AppError(
      "AUTH_NOT_FOUND",
      `Authorization '${id}' not found.`,
      "Use get_current_permissions to list valid authorizations."
    ),

  authExpired: (id: string, expiresAt: string) =>
    new AppError(
      "AUTH_EXPIRED",
      `Authorization '${id}' expired at ${expiresAt}.`,
      "Create a new one with authorize_market_trade."
    ),

  authRevoked: (id: string) =>
    new AppError(
      "AUTH_REVOKED",
      `Authorization '${id}' has been revoked.`,
      "Create a new one with authorize_market_trade."
    ),

  authInactive: (id: string, status: string) =>
    new AppError(
      "AUTH_INACTIVE",
      `Authorization '${id}' is in status '${status}'.`,
      "Only ACTIVE authorizations can be used."
    ),

  marketNotFound: (slug: string, available: string[]) =>
    new AppError(
      "MARKET_NOT_FOUND",
      `Market slug '${slug}' not found.`,
      `Available markets: ${available.join(", ")}. Use '*' for all-markets authorization.`
    ),

  outcomeNotFound: (outcome: string, slug: string) =>
    new AppError(
      "OUTCOME_NOT_FOUND",
      `Outcome '${outcome}' not valid for market '${slug}'.`,
      "Valid outcomes: YES, NO."
    ),

  orderNotFound: (id: string) =>
    new AppError(
      "ORDER_NOT_FOUND",
      `Order '${id}' not found.`,
      "Check order IDs via get_order_history."
    ),

  orderNotCancellable: (id: string, status: string) =>
    new AppError(
      "ORDER_NOT_CANCELLABLE",
      `Order '${id}' is already in status '${status}' and cannot be cancelled.`,
      "Only OPEN or PARTIALLY_FILLED orders can be cancelled."
    ),

  orderAuthMismatch: (orderId: string, authId: string) =>
    new AppError(
      "ORDER_AUTH_MISMATCH",
      `Order '${orderId}' was placed under a different authorization (auth '${authId}').`,
      "Use the authorization that was used to place this order."
    ),

  limitExceeded: (amount: number, maxOrderSize: number, authId: string) =>
    new AppError(
      "LIMIT_EXCEEDED",
      `Order amount ${amount} exceeds max_order_size ${maxOrderSize} for authorization '${authId}'.`,
      `Reduce order amount to ${maxOrderSize} or less.`
    ),

  spendingLimitExceeded: (projected: number, limit: number) =>
    new AppError(
      "SPENDING_LIMIT_EXCEEDED",
      `Order would bring total spent to ${projected}, exceeding spending_limit of ${limit}.`,
      "Reduce order amount or revoke existing authorizations to free up limit."
    ),

  marketNotAccepting: (slug: string) =>
    new AppError(
      "MARKET_NOT_ACCEPTING",
      `Market '${slug}' is not currently accepting orders.`,
      "Check market status or try a different market."
    ),

  unsupportedSide: (side: string, allowed: string[]) =>
    new AppError(
      "UNSUPPORTED_SIDE",
      `Side '${side}' is not in allowed_sides [${allowed.join(", ")}] for this authorization.`,
      `Use one of: ${allowed.join(", ")}.`
    ),

  unsupportedOrderType: (type: string, allowed: string[]) =>
    new AppError(
      "UNSUPPORTED_ORDER_TYPE",
      `Order type '${type}' is not in allowed_order_types for this authorization.`,
      `Use one of: ${allowed.join(", ")}.`
    ),

  marketScopeViolation: (authSlug: string, requestedSlug: string) =>
    new AppError(
      "MARKET_SCOPE_VIOLATION",
      `Authorization is scoped to market '${authSlug}', not '${requestedSlug}'.`,
      "Use get_current_permissions to find authorizations for this market."
    ),

  invalidPrice: (price: string, tickSize: number) =>
    new AppError(
      "INVALID_PRICE",
      `Price '${price}' does not respect tick size ${tickSize} for this market.`,
      `Price must be a multiple of ${tickSize}.`
    ),

  insufficientLiquidity: (price: string) =>
    new AppError(
      "INSUFFICIENT_LIQUIDITY",
      `Market order cannot be filled: insufficient liquidity at price '${price}'.`,
      "Try a smaller amount or a different price."
    ),

  spendingLimitLessThanMaxOrderSize: (spendingLimit: number, maxOrderSize: number) =>
    new AppError(
      "INVALID_LIMITS",
      `spending_limit (${spendingLimit}) cannot be less than max_order_size (${maxOrderSize}).`,
      "spending_limit must be >= max_order_size."
    ),
};

// ── Handler Wrapper ─────────────────────────────────

export function formatSuccess(data: unknown, responseFormat: ResponseFormat = ResponseFormat.JSON) {
  if (responseFormat === ResponseFormat.MARKDOWN) {
    return {
      content: [{ type: "text" as const, text: dataToMarkdown(data) }],
    };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function dataToMarkdown(data: unknown): string {
  if (typeof data === "object" && data !== null) {
    return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
  }
  return String(data);
}
