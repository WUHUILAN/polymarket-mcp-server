import { v4 as uuidv4 } from "uuid";
import { InMemoryStore } from "../store/in-memory-store.js";
import {
  Authorization,
  AuthStatus,
  Side,
  OrderType,
  SpendingSummary,
} from "../types.js";
import { MAX_EXPIRY_HOURS } from "../constants.js";
import { Errors } from "../errors.js";

export class AuthService {
  private store: InMemoryStore;

  constructor(store: InMemoryStore) {
    this.store = store;
  }

  authorize(data: {
    marketSlug: string;
    spendingLimit: number;
    maxOrderSize: number;
    allowedSides: Side[];
    allowedOrderTypes: OrderType[];
    expiresInHours: number;
  }): Authorization & { spendingSummary: SpendingSummary } {
    const {
      marketSlug,
      spendingLimit,
      maxOrderSize,
      allowedSides,
      allowedOrderTypes,
      expiresInHours,
    } = data;

    // Validate constraints
    if (spendingLimit < maxOrderSize) {
      throw Errors.spendingLimitLessThanMaxOrderSize(spendingLimit, maxOrderSize);
    }

    if (expiresInHours > MAX_EXPIRY_HOURS) {
      throw new Error(`expires_in_hours cannot exceed ${MAX_EXPIRY_HOURS}`);
    }

    // Resolve market
    let marketId = "*";
    let marketTitle = "All Markets";

    if (marketSlug !== "*") {
      const market = this.store.getMarketBySlug(marketSlug);
      if (!market) {
        throw Errors.marketNotFound(marketSlug, this.store.getAllSlugs());
      }
      marketId = market.id;
      marketTitle = market.title;
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + expiresInHours * 3600 * 1000
    );

    const auth: Authorization = {
      id: uuidv4(),
      marketId,
      marketSlug,
      marketTitle,
      spendingLimit,
      maxOrderSize,
      allowedSides,
      allowedOrderTypes,
      status: AuthStatus.ACTIVE,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastUsedAt: null,
    };

    this.store.createAuth(auth);

    return {
      ...auth,
      spendingSummary: {
        totalSpent: 0,
        remainingLimit: spendingLimit,
        activeOrderCount: 0,
      },
    };
  }

  validateAuth(authId: string): Authorization {
    const auth = this.store.getAuth(authId);
    if (!auth) throw Errors.authNotFound(authId);

    // Check expiration first
    if (new Date(auth.expiresAt) < new Date()) {
      // Auto-expire
      this.store.updateAuth(authId, { status: AuthStatus.EXPIRED });
      throw Errors.authExpired(authId, auth.expiresAt);
    }

    if (auth.status === AuthStatus.REVOKED) {
      throw Errors.authRevoked(authId);
    }

    if (auth.status !== AuthStatus.ACTIVE) {
      throw Errors.authInactive(authId, auth.status);
    }

    return auth;
  }

  revoke(authId: string, reason: string): Authorization {
    const auth = this.store.getAuth(authId);
    if (!auth) throw Errors.authNotFound(authId);

    if (auth.status !== AuthStatus.ACTIVE) {
      throw Errors.authInactive(authId, auth.status);
    }

    const updated = this.store.updateAuth(authId, {
      status: AuthStatus.REVOKED,
    });

    return updated;
  }

  listPermissions(statusFilter: AuthStatus = AuthStatus.ACTIVE, limit: number, offset: number) {
    const all = this.store.listAuths({ status: statusFilter });
    const total = all.length;
    const items = all.slice(offset, offset + limit);

    // Attach usage summary to each
    const enriched = items.map((auth) => ({
      ...auth,
      usage: this.store.getSpendingSummary(auth.id, auth.spendingLimit),
    }));

    return {
      total,
      count: enriched.length,
      offset,
      authorizations: enriched,
      has_more: total > offset + enriched.length,
      next_offset: total > offset + enriched.length ? offset + enriched.length : undefined,
    };
  }
}
