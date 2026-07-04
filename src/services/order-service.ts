import { v4 as uuidv4 } from "uuid";
import { InMemoryStore } from "../store/in-memory-store.js";
import {
  Order,
  OrderType,
  OrderStatus,
  Side,
  SpendingSummary,
} from "../types.js";
import { Errors } from "../errors.js";
import {
  getAvailableLiquidity,
  generateFillRecords,
  isValidPrice,
} from "./mock-market-data.js";
import { AuthService } from "./auth-service.js";

export class OrderService {
  private store: InMemoryStore;
  private authService: AuthService;

  constructor(store: InMemoryStore, authService: AuthService) {
    this.store = store;
    this.authService = authService;
  }

  placeOrder(data: {
    authorizationId: string;
    marketSlug: string;
    outcome: "YES" | "NO";
    side: Side;
    amount: number;
    price: string;
    orderType: OrderType;
    expiresAt?: string;
  }): { order: Order; spendingSummary: SpendingSummary } {
    const {
      authorizationId,
      marketSlug,
      outcome,
      side,
      amount,
      price,
      orderType,
      expiresAt,
    } = data;

    // 1. Validate authorization
    const auth = this.authService.validateAuth(authorizationId);

    // 2. Validate market
    const market = this.store.getMarketBySlug(marketSlug);
    if (!market) {
      throw Errors.marketNotFound(marketSlug, this.store.getAllSlugs());
    }
    if (!market.acceptingOrders) {
      throw Errors.marketNotAccepting(marketSlug);
    }

    // 3. Validate outcome
    const outcomeToken = market.outcomes.find((o) => o.outcome === outcome);
    if (!outcomeToken) {
      throw Errors.outcomeNotFound(outcome, marketSlug);
    }

    // 4. Validate authorization scope
    if (auth.marketSlug !== "*" && auth.marketSlug !== marketSlug) {
      throw Errors.marketScopeViolation(auth.marketSlug, marketSlug);
    }
    if (!auth.allowedSides.includes(side)) {
      throw Errors.unsupportedSide(
        side,
        auth.allowedSides
      );
    }
    if (!auth.allowedOrderTypes.includes(orderType)) {
      throw Errors.unsupportedOrderType(
        orderType,
        auth.allowedOrderTypes
      );
    }

    // 5. Validate limits
    if (amount > auth.maxOrderSize) {
      throw Errors.limitExceeded(amount, auth.maxOrderSize, authorizationId);
    }

    const currentSpent = this.store.getTotalSpentUnderAuth(authorizationId);
    if (currentSpent + amount > auth.spendingLimit) {
      throw Errors.spendingLimitExceeded(
        currentSpent + amount,
        auth.spendingLimit
      );
    }

    // 6. Validate price
    const numericPrice = parseFloat(price);
    if (isNaN(numericPrice) || numericPrice <= 0 || numericPrice >= 1) {
      throw Errors.invalidPrice(price, market.tickSize);
    }
    if (!isValidPrice(numericPrice, market.tickSize)) {
      throw Errors.invalidPrice(price, market.tickSize);
    }

    if (amount < market.minimumOrderSize) {
      throw new Error(
        `Amount ${amount} is below minimum order size ${market.minimumOrderSize} for this market.`
      );
    }

    // 7. Process order based on type
    const now = new Date();
    let order: Order;
    const priceNum = parseFloat(price);

    switch (orderType) {
      case OrderType.FOK: {
        const liquidity = getAvailableLiquidity(
          market.orderBook,
          side,
          priceNum
        );
        if (liquidity >= amount) {
          order = this.makeOrder(
            authorizationId,
            market.id,
            outcomeToken.tokenId,
            side,
            orderType,
            price,
            amount,
            OrderStatus.FILLED,
            amount,
            now,
            expiresAt
          );
          order.matchedOrders = generateFillRecords(amount, price, 2);
        } else {
          order = this.makeOrder(
            authorizationId,
            market.id,
            outcomeToken.tokenId,
            side,
            orderType,
            price,
            amount,
            OrderStatus.REJECTED,
            0,
            now,
            expiresAt
          );
          order.rejectionReason = `Insufficient liquidity: available=${liquidity}, requested=${amount}`;
        }
        break;
      }

      case OrderType.FAK: {
        const liquidity = getAvailableLiquidity(
          market.orderBook,
          side,
          priceNum
        );
        if (liquidity >= amount) {
          order = this.makeOrder(
            authorizationId,
            market.id,
            outcomeToken.tokenId,
            side,
            orderType,
            price,
            amount,
            OrderStatus.FILLED,
            amount,
            now,
            expiresAt
          );
          order.matchedOrders = generateFillRecords(amount, price, 2);
        } else if (liquidity > 0) {
          order = this.makeOrder(
            authorizationId,
            market.id,
            outcomeToken.tokenId,
            side,
            orderType,
            price,
            amount,
            OrderStatus.PARTIALLY_FILLED,
            liquidity,
            now,
            expiresAt
          );
          order.matchedOrders = generateFillRecords(liquidity, price, 1);
        } else {
          order = this.makeOrder(
            authorizationId,
            market.id,
            outcomeToken.tokenId,
            side,
            orderType,
            price,
            amount,
            OrderStatus.REJECTED,
            0,
            now,
            expiresAt
          );
          order.rejectionReason =
            "No liquidity available at requested price";
        }
        break;
      }

      case OrderType.GTC:
      case OrderType.GTD:
        order = this.makeOrder(
          authorizationId,
          market.id,
          outcomeToken.tokenId,
          side,
          orderType,
          price,
          amount,
          OrderStatus.OPEN,
          0,
          now,
          expiresAt
        );
        break;

      default:
        throw new Error(`Unsupported order type: ${orderType}`);
    }

    // 8. Persist
    this.store.createOrder(order);

    // 9. Update auth lastUsedAt
    this.store.updateAuth(authorizationId, { lastUsedAt: now.toISOString() });

    // 10. Return with spending summary
    return {
      order,
      spendingSummary: this.store.getSpendingSummary(
        authorizationId,
        auth.spendingLimit
      ),
    };
  }

  cancelOrder(
    authorizationId: string,
    orderId: string
  ): { order: Order; spendingSummary: SpendingSummary } {
    // 1. Validate authorization
    const auth = this.authService.validateAuth(authorizationId);

    // 2. Get order
    const order = this.store.getOrder(orderId);
    if (!order) throw Errors.orderNotFound(orderId);

    // 3. Auth match
    if (order.authorizationId !== authorizationId) {
      throw Errors.orderAuthMismatch(orderId, order.authorizationId);
    }

    // 4. Check cancellable
    if (
      order.status !== OrderStatus.OPEN &&
      order.status !== OrderStatus.PARTIALLY_FILLED
    ) {
      throw Errors.orderNotCancellable(orderId, order.status);
    }

    // 5. Cancel
    const updated = this.store.updateOrder(orderId, {
      status: OrderStatus.CANCELLED,
      updatedAt: new Date().toISOString(),
    });

    return {
      order: updated,
      spendingSummary: this.store.getSpendingSummary(
        authorizationId,
        auth.spendingLimit
      ),
    };
  }

  getOrderHistory(
    authorizationId: string,
    filter: {
      statusFilter?: OrderStatus;
      marketSlug?: string;
      side?: Side;
      limit: number;
      offset: number;
    }
  ) {
    // Validate authorization exists
    const auth = this.store.getAuth(authorizationId);
    if (!auth) throw Errors.authNotFound(authorizationId);

    let marketId: string | undefined;
    if (filter.marketSlug) {
      const market = this.store.getMarketBySlug(filter.marketSlug);
      if (!market) {
        throw Errors.marketNotFound(
          filter.marketSlug,
          this.store.getAllSlugs()
        );
      }
      marketId = market.id;
    }

    const allOrders = this.store.listOrders({
      authId: authorizationId,
      status: filter.statusFilter,
      marketId,
      side: filter.side,
    });

    // Automatically expire GTD orders past expiry
    for (const order of allOrders) {
      if (
        order.orderType === OrderType.GTD &&
        order.expiresAt &&
        new Date(order.expiresAt) < new Date() &&
        order.status === OrderStatus.OPEN
      ) {
        this.store.updateOrder(order.id, {
          status: OrderStatus.EXPIRED,
          updatedAt: new Date().toISOString(),
        });
        order.status = OrderStatus.EXPIRED;
      }
    }

    // Re-filter after expiry processing
    let resultOrders = filter.statusFilter
      ? allOrders.filter((o) => o.status === filter.statusFilter)
      : allOrders;

    // Sort by createdAt descending
    resultOrders.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = resultOrders.length;
    const paged = resultOrders.slice(filter.offset, filter.offset + filter.limit);

    return {
      total,
      count: paged.length,
      offset: filter.offset,
      orders: paged,
      has_more: total > filter.offset + paged.length,
      next_offset:
        total > filter.offset + paged.length
          ? filter.offset + paged.length
          : undefined,
    };
  }

  // ── Order Factory ─────────────────────────────────

  private makeOrder(
    authorizationId: string,
    marketId: string,
    tokenId: string,
    side: Side,
    orderType: OrderType,
    price: string,
    originalSize: number,
    status: OrderStatus,
    filledSize: number,
    now: Date,
    expiresAt?: string
  ): Order {
    return {
      id: uuidv4(),
      authorizationId,
      marketId,
      tokenId,
      side,
      orderType,
      price,
      originalSize,
      filledSize,
      remainingSize: Math.round((originalSize - filledSize) * 100) / 100,
      status,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt || null,
      rejectionReason: null,
      matchedOrders: [],
    };
  }
}
