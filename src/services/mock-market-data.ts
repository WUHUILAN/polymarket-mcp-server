import { Market, OrderBookLevel, Side } from "../types.js";

// ── Deterministic pseudo-random (seed-based) ────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Order Book Generator ────────────────────────────

function generateOrderBook(
  midPrice: number,
  seed: number
): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
  const rng = seededRandom(seed);
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  // Generate 6 bid levels below mid (sorted high→low)
  for (let i = 0; i < 6; i++) {
    const price = midPrice - 0.005 - i * (0.005 + rng() * 0.01);
    const size = Math.round((50 + rng() * 2000) * 100) / 100;
    bids.push({ price: Math.round(price * 10000) / 10000, size });
  }
  bids.sort((a, b) => b.price - a.price);

  // Generate 6 ask levels above mid (sorted low→high)
  for (let i = 0; i < 6; i++) {
    const price = midPrice + 0.005 + i * (0.005 + rng() * 0.01);
    const size = Math.round((50 + rng() * 2000) * 100) / 100;
    asks.push({ price: Math.round(price * 10000) / 10000, size });
  }
  asks.sort((a, b) => a.price - b.price);

  return { bids, asks };
}

// ── Seed Markets ────────────────────────────────────

export function createSeedMarkets(): Market[] {
  const now = new Date();
  const year = now.getFullYear();

  return [
    {
      id: "0xabc001-election-2024",
      slug: "will-trump-win-2024",
      title: "Will Donald Trump win the 2024 US Presidential Election?",
      outcomes: [
        { tokenId: "0xtoken_yes_001", outcome: "YES", price: "0.62" },
        { tokenId: "0xtoken_no_001", outcome: "NO", price: "0.38" },
      ],
      tickSize: 0.01,
      minimumOrderSize: 5,
      volume: 12_500_000,
      liquidity: 2_800_000,
      endDateIso: new Date(`${year}-11-05`).toISOString(),
      negRisk: false,
      active: true,
      acceptingOrders: true,
      orderBook: generateOrderBook(0.62, 1001),
    },
    {
      id: "0xabc002-btc-100k",
      slug: "btc-100k-2024",
      title: "Will Bitcoin reach $100,000 by end of 2024?",
      outcomes: [
        { tokenId: "0xtoken_yes_002", outcome: "YES", price: "0.45" },
        { tokenId: "0xtoken_no_002", outcome: "NO", price: "0.55" },
      ],
      tickSize: 0.01,
      minimumOrderSize: 10,
      volume: 8_300_000,
      liquidity: 1_900_000,
      endDateIso: new Date(`${year}-12-31`).toISOString(),
      negRisk: false,
      active: true,
      acceptingOrders: true,
      orderBook: generateOrderBook(0.45, 2002),
    },
    {
      id: "0xabc003-eth-merge",
      slug: "eth-merge-completed",
      title: "Will the Ethereum merge complete successfully?",
      outcomes: [
        { tokenId: "0xtoken_yes_003", outcome: "YES", price: "0.88" },
        { tokenId: "0xtoken_no_003", outcome: "NO", price: "0.12" },
      ],
      tickSize: 0.005,
      minimumOrderSize: 5,
      volume: 3_200_000,
      liquidity: 850_000,
      endDateIso: new Date(`${year}-09-15`).toISOString(),
      negRisk: false,
      active: true,
      acceptingOrders: false, // Market resolved (for testing)
      orderBook: generateOrderBook(0.88, 3003),
    },
    {
      id: "0xabc004-fed-rate-cut",
      slug: "fed-rate-cut-2025",
      title: "Will the Fed cut rates by 50bps in Q1 2025?",
      outcomes: [
        { tokenId: "0xtoken_yes_004", outcome: "YES", price: "0.71" },
        { tokenId: "0xtoken_no_004", outcome: "NO", price: "0.29" },
      ],
      tickSize: 0.01,
      minimumOrderSize: 10,
      volume: 1_100_000,
      liquidity: 320_000,
      endDateIso: new Date("2025-03-31").toISOString(),
      negRisk: false,
      active: true,
      acceptingOrders: true,
      orderBook: generateOrderBook(0.71, 4004),
    },
  ];
}

// ── Mock Matching Engine Helpers ────────────────────

export function getAvailableLiquidity(
  orderBook: { bids: OrderBookLevel[]; asks: OrderBookLevel[] },
  side: Side,
  limitPrice: number
): number {
  const levels = side === Side.BUY ? orderBook.asks : orderBook.bids;
  let total = 0;
  for (const level of levels) {
    if (side === Side.BUY) {
      // Buying: want asks at or below limit price
      if (level.price <= limitPrice) total += level.size;
    } else {
      // Selling: want bids at or above limit price
      if (level.price >= limitPrice) total += level.size;
    }
  }
  return Math.round(total * 100) / 100;
}

export function generateFillRecords(
  fillSize: number,
  fillPrice: string,
  count: number
): { fillId: string; fillTime: string; fillSize: number; fillPrice: string; counterpartyOrderId: string }[] {
  const fills: Array<{
    fillId: string;
    fillTime: string;
    fillSize: number;
    fillPrice: string;
    counterpartyOrderId: string;
  }> = [];
  const now = new Date();
  const remaining = fillSize;
  const perFill = Math.round((fillSize / count) * 100) / 100;

  for (let i = 0; i < count; i++) {
    const size = i === count - 1
      ? Math.round((remaining - perFill * (count - 1)) * 100) / 100
      : perFill;
    fills.push({
      fillId: `fill_${Date.now()}_${i}`,
      fillTime: new Date(now.getTime() - (count - i) * 100).toISOString(),
      fillSize: Math.abs(Math.round(size * 100) / 100),
      fillPrice,
      counterpartyOrderId: `counterparty_${Math.random().toString(36).slice(2, 10)}`,
    });
  }
  return fills;
}

export function isValidPrice(price: number, tickSize: number): boolean {
  const remainder = price % tickSize;
  // Float tolerance
  return Math.abs(remainder) < 1e-10 || Math.abs(remainder - tickSize) < 1e-10;
}
