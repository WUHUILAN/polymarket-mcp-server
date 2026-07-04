// ── Enums ───────────────────────────────────────────

export enum Side {
  BUY = "BUY",
  SELL = "SELL",
}

export enum OrderType {
  GTC = "GTC", // Good-Till-Cancelled (resting limit)
  GTD = "GTD", // Good-Till-Date (resting limit + expiry)
  FOK = "FOK", // Fill-Or-Kill (immediate full fill or cancel)
  FAK = "FAK", // Fill-And-Kill (immediate partial fill, rest cancelled)
}

export enum AuthStatus {
  ACTIVE = "ACTIVE",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export enum OrderStatus {
  PENDING = "PENDING",
  OPEN = "OPEN",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
}

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

// ── Core Entities ───────────────────────────────────

export interface Outcome {
  tokenId: string; // ERC-1155 token ID
  outcome: "YES" | "NO";
  price: string; // Current mid-price, e.g. "0.65"
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface Market {
  id: string; // condition_id
  slug: string; // e.g. "will-trump-win-2024"
  title: string;
  outcomes: Outcome[];
  tickSize: number; // e.g. 0.01
  minimumOrderSize: number; // e.g. 5 USDC
  volume: number;
  liquidity: number;
  endDateIso: string;
  negRisk: boolean;
  active: boolean;
  acceptingOrders: boolean;
  orderBook: {
    bids: OrderBookLevel[]; // sorted high->low
    asks: OrderBookLevel[]; // sorted low->high
  };
}

export interface Authorization {
  id: string;
  marketId: string; // condition_id or "*"
  marketSlug: string; // slug or "*"
  marketTitle: string;
  spendingLimit: number;
  maxOrderSize: number;
  allowedSides: Side[];
  allowedOrderTypes: OrderType[];
  status: AuthStatus;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export interface MatchedFill {
  fillId: string;
  fillTime: string;
  fillSize: number;
  fillPrice: string;
  counterpartyOrderId: string;
}

export interface Order {
  id: string;
  authorizationId: string;
  marketId: string;
  tokenId: string;
  side: Side;
  orderType: OrderType;
  price: string;
  originalSize: number;
  filledSize: number;
  remainingSize: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  rejectionReason: string | null;
  matchedOrders: MatchedFill[];
}

// ── Usage Summary ───────────────────────────────────

export interface SpendingSummary {
  totalSpent: number;
  remainingLimit: number;
  activeOrderCount: number;
}
