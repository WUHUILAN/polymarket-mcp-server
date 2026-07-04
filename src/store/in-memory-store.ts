import {
  Market,
  Authorization,
  Order,
  AuthStatus,
  OrderStatus,
  Side,
  SpendingSummary,
} from "../types.js";
import { createSeedMarkets } from "../services/mock-market-data.js";

export class InMemoryStore {
  private static instance: InMemoryStore;

  private markets: Map<string, Market> = new Map();
  private auths: Map<string, Authorization> = new Map();
  private orders: Map<string, Order> = new Map();

  // Secondary indexes
  private authsByStatus: Map<AuthStatus, Set<string>> = new Map();
  private ordersByAuth: Map<string, Set<string>> = new Map();
  private ordersByStatus: Map<OrderStatus, Set<string>> = new Map();
  private ordersByMarket: Map<string, Set<string>> = new Map();
  private slugToMarketId: Map<string, string> = new Map();

  private constructor() {
    // Load seed markets
    const seedMarkets = createSeedMarkets();
    for (const market of seedMarkets) {
      this.markets.set(market.id, market);
      this.slugToMarketId.set(market.slug, market.id);
    }
  }

  static getInstance(): InMemoryStore {
    if (!InMemoryStore.instance) {
      InMemoryStore.instance = new InMemoryStore();
    }
    return InMemoryStore.instance;
  }

  // ── Market ────────────────────────────────────────

  getMarket(id: string): Market | undefined {
    return this.markets.get(id);
  }

  getMarketBySlug(slug: string): Market | undefined {
    const id = this.slugToMarketId.get(slug);
    if (!id) return undefined;
    return this.markets.get(id);
  }

  getAllMarkets(): Market[] {
    return Array.from(this.markets.values());
  }

  getAllSlugs(): string[] {
    return Array.from(this.slugToMarketId.keys());
  }

  // ── Authorization ─────────────────────────────────

  createAuth(auth: Authorization): Authorization {
    this.auths.set(auth.id, auth);
    this.indexAuthByStatus(auth);
    return auth;
  }

  getAuth(id: string): Authorization | undefined {
    return this.auths.get(id);
  }

  updateAuth(id: string, updates: Partial<Authorization>): Authorization {
    const auth = this.auths.get(id);
    if (!auth) throw new Error(`Auth ${id} not found in store`);
    // Remove from old status index
    this.removeAuthFromStatusIndex(auth);
    Object.assign(auth, updates);
    // Re-index with new status
    this.indexAuthByStatus(auth);
    return auth;
  }

  listAuths(filter?: { status?: AuthStatus }): Authorization[] {
    if (filter?.status) {
      const ids = this.authsByStatus.get(filter.status);
      if (!ids) return [];
      return Array.from(ids)
        .map((id) => this.auths.get(id)!)
        .filter(Boolean);
    }
    return Array.from(this.auths.values());
  }

  // ── Order ─────────────────────────────────────────

  createOrder(order: Order): Order {
    this.orders.set(order.id, order);
    this.indexOrder(order);
    return order;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  updateOrder(id: string, updates: Partial<Order>): Order {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Order ${id} not found in store`);
    // Remove from old indexes
    this.removeOrderFromIndexes(order);
    Object.assign(order, updates);
    // Re-index
    this.indexOrder(order);
    return order;
  }

  listOrders(filter?: {
    authId?: string;
    marketId?: string;
    status?: OrderStatus;
    side?: Side;
  }): Order[] {
    let candidateIds: Set<string> | undefined;

    // Use the most selective index
    if (filter?.authId) {
      candidateIds = this.ordersByAuth.get(filter.authId);
      if (!candidateIds) return [];
    }
    if (filter?.status) {
      const statusIds = this.ordersByStatus.get(filter.status);
      if (!statusIds) return [];
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => statusIds.has(id)))
        : statusIds;
    }
    if (filter?.marketId) {
      const marketIds = this.ordersByMarket.get(filter.marketId);
      if (!marketIds) return [];
      candidateIds = candidateIds
        ? new Set([...candidateIds].filter((id) => marketIds.has(id)))
        : marketIds;
    }

    const orders = candidateIds
      ? Array.from(candidateIds).map((id) => this.orders.get(id)!)
      : Array.from(this.orders.values());

    // Side filter (post-filter since less selective)
    if (filter?.side) {
      return orders.filter((o) => o.side === filter.side);
    }
    return orders;
  }

  // ── Usage Tracking ────────────────────────────────

  getTotalSpentUnderAuth(authId: string): number {
    const orderIds = this.ordersByAuth.get(authId);
    if (!orderIds) return 0;
    let total = 0;
    for (const id of orderIds) {
      const order = this.orders.get(id);
      if (
        order &&
        order.side === Side.BUY &&
        (order.status === OrderStatus.FILLED ||
          order.status === OrderStatus.PARTIALLY_FILLED)
      ) {
        total += order.filledSize;
      }
    }
    return Math.round(total * 100) / 100;
  }

  getActiveOrderCountUnderAuth(authId: string): number {
    const orderIds = this.ordersByAuth.get(authId);
    if (!orderIds) return 0;
    let count = 0;
    for (const id of orderIds) {
      const order = this.orders.get(id);
      if (
        order &&
        (order.status === OrderStatus.OPEN ||
          order.status === OrderStatus.PARTIALLY_FILLED ||
          order.status === OrderStatus.PENDING)
      ) {
        count++;
      }
    }
    return count;
  }

  getSpendingSummary(authId: string, spendingLimit: number): SpendingSummary {
    const totalSpent = this.getTotalSpentUnderAuth(authId);
    return {
      totalSpent,
      remainingLimit: Math.max(0, Math.round((spendingLimit - totalSpent) * 100) / 100),
      activeOrderCount: this.getActiveOrderCountUnderAuth(authId),
    };
  }

  // ── Index Helpers ─────────────────────────────────

  private indexAuthByStatus(auth: Authorization): void {
    if (!this.authsByStatus.has(auth.status)) {
      this.authsByStatus.set(auth.status, new Set());
    }
    this.authsByStatus.get(auth.status)!.add(auth.id);
  }

  private removeAuthFromStatusIndex(auth: Authorization): void {
    const set = this.authsByStatus.get(auth.status);
    if (set) set.delete(auth.id);
  }

  private indexOrder(order: Order): void {
    // By auth
    if (!this.ordersByAuth.has(order.authorizationId)) {
      this.ordersByAuth.set(order.authorizationId, new Set());
    }
    this.ordersByAuth.get(order.authorizationId)!.add(order.id);

    // By status
    if (!this.ordersByStatus.has(order.status)) {
      this.ordersByStatus.set(order.status, new Set());
    }
    this.ordersByStatus.get(order.status)!.add(order.id);

    // By market
    if (!this.ordersByMarket.has(order.marketId)) {
      this.ordersByMarket.set(order.marketId, new Set());
    }
    this.ordersByMarket.get(order.marketId)!.add(order.id);
  }

  private removeOrderFromIndexes(order: Order): void {
    this.ordersByAuth.get(order.authorizationId)?.delete(order.id);
    this.ordersByStatus.get(order.status)?.delete(order.id);
    this.ordersByMarket.get(order.marketId)?.delete(order.id);
  }

  // ── Reset (for testing) ───────────────────────────

  reset(): void {
    this.markets.clear();
    this.auths.clear();
    this.orders.clear();
    this.authsByStatus.clear();
    this.ordersByAuth.clear();
    this.ordersByStatus.clear();
    this.ordersByMarket.clear();
    this.slugToMarketId.clear();
    // Re-seed
    const seedMarkets = createSeedMarkets();
    for (const market of seedMarkets) {
      this.markets.set(market.id, market);
      this.slugToMarketId.set(market.slug, market.id);
    }
  }
}
