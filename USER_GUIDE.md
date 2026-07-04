# Polymarket MCP Server 用户使用手册

## 目录

1. [MCP Inspector 界面说明](#1-mcp-inspector-界面说明)
2. [系统概览](#2-系统概览)
3. [可用市场一览](#3-可用市场一览)
4. [六个工具详解](#4-六个工具详解)
   - [4.1 authorize_market_trade — 创建交易授权](#41-authorize_market_trade)
   - [4.2 place_order — 下单](#42-place_order)
   - [4.3 cancel_order — 撤单](#43-cancel_order)
   - [4.4 revoke_authorization — 撤销授权](#44-revoke_authorization)
   - [4.5 get_current_permissions — 查看当前权限](#45-get_current_permissions)
   - [4.6 get_order_history — 查看订单历史](#46-get_order_history)
5. [典型操作流程](#5-典型操作流程)
6. [错误码速查表](#6-错误码速查表)

---

## 1. MCP Inspector 界面说明

MCP Inspector 是 MCP 官方提供的交互式调试工具。连接服务器后，你会看到以下区域：

### 顶部信息栏

```
Server: polymarket-mcp-server v1.0.0
Transport: stdio
```

显示当前连接的服务器名称、版本号和传输方式。

### 左侧：工具列表（Tools）

列出服务器注册的所有工具。每行一个工具名，点击即可选中。

**你的服务器有 6 个工具**：
- `polymarket_authorize_market_trade`
- `polymarket_place_order`
- `polymarket_cancel_order`
- `polymarket_revoke_authorization`
- `polymarket_get_current_permissions`
- `polymarket_get_order_history`

| 图标 | 含义 |
|------|------|
| 🔵 蓝色标记 | 可读工具（不会修改数据） |
| 🟠 橙色标记 | 写入工具（会修改数据） |

### 右侧主面板

点击工具后展开，从上到下分为三个区域：

#### A. 工具描述区（Description）

显示工具的名称、用途描述、参数说明和返回值格式。这是最重要的阅读区域——它会告诉你这个工具做什么、每个参数的含义。

#### B. 参数输入区（Arguments）

一个 JSON 编辑器，你需要在这里填入调用参数。**注意**：
- 必须使用合法的 JSON 格式
- 参数名用双引号包裹
- Inspector 通常提供参数自动补全提示
- 有默认值的参数可以不填

示例：
```json
{
  "market_slug": "btc-100k-2024",
  "spending_limit": 500,
  "max_order_size": 100
}
```

#### C. 结果输出区（Result）

点击执行按钮后，这里显示服务器返回的结果。有两种可能：

**成功返回**（绿色区域）：
```json
{
  "authorization_id": "abc123-...",
  "status": "ACTIVE",
  ...
}
```

**错误返回**（红色区域）：
```json
{
  "error": {
    "code": "MARKET_NOT_FOUND",
    "message": "Market slug 'xxx' not found.",
    "suggestion": "Available markets: will-trump-win-2024, btc-100k-2024, ..."
  }
}
```

#### D. 执行按钮

即工具调用按钮，点击后将参数发送给服务器。同一次工具调用只执行一次。

### 底部：历史记录（History）

列出你所有的工具调用历史，按时间倒序。可以点击任意一条查看当时的请求和响应。

---

## 2. 系统概览

### 这个服务器做什么？

模拟 Polymarket（全球最大预测市场）的交易授权和订单管理。它是一个 **Mock 系统**：

- ❌ 不连接真实 Polymarket API
- ❌ 不涉及真实资金（USDC）
- ❌ 不需要钱包 / 私钥
- ✅ 所有交易都在内存中模拟
- ✅ 包含完整的授权 → 下单 → 撤单 → 查询流程
- ✅ 模拟了真实的订单簿和流动性

### 核心概念

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Authorization │ ──→ │    Order      │ ──→ │  MatchedFill  │
│  （授权许可）    │     │   （订单）     │     │  （成交记录）   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                     │
       │  spending_limit      │  price / amount
       │  max_order_size      │  side (BUY/SELL)
       │  allowed_sides       │  order_type
       │  expires_at          │  status
```

**关键规则**：
1. 必须先创建授权（Authorization），才能下单
2. 授权有额度上限（spending_limit）和单笔上限（max_order_size）
3. 授权有过期时间，过期后自动失效
4. 授权只对指定市场有效（或用 `*` 通配所有市场）
5. GTC 订单挂单后保持 OPEN，不会自动成交；FOK/FAK 订单立即执行

### 订单类型说明

| 类型 | 全称 | 行为 |
|------|------|------|
| **GTC** | Good-Till-Cancelled | 限价挂单，挂到订单簿上，保持 OPEN 直到你主动取消 |
| **GTD** | Good-Till-Date | 同 GTC，但有过期时间，到期自动变为 EXPIRED |
| **FOK** | Fill-Or-Kill | 市价单，必须全部成交否则拒绝；检查订单簿流动性 |
| **FAK** | Fill-And-Kill | 市价单，能成交多少成交多少，剩余部分取消 |

### 订单状态流转

```
                    ┌─────────┐
                    │ PENDING │  (初始状态)
                    └────┬────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌─────────┐   ┌──────────────┐  ┌──────────┐
    │  OPEN   │   │ PARTIALLY_   │  │ REJECTED │
    │ (GTC/GTD)│   │ FILLED (FAK) │  │ (FOK/FAK)│
    └────┬─────┘   └──────┬───────┘  └──────────┘
         │                │
    ┌────┴────┐      ┌────┴────┐
    ▼         ▼      ▼         ▼
┌───────┐ ┌──────┐ ┌──────┐ ┌───────┐
│FILLED │ │CANCE │ │FILLED│ │CANCE  │
│ (不会  │ │LLED  │ │      │ │LLED   │
│  发生) │ │      │ │      │ │       │
└───────┘ └──────┘ └──────┘ └───────┘
```

> **注意**：在这个 Mock 系统中，GTC 订单始终保持 OPEN，不会自动变为 FILLED。你只能通过 cancel_order 来撤销它。

---

## 3. 可用市场一览

服务器启动时预加载了 4 个种子市场：

| Slug | 标题 | YES 价格 | Tick Size | 最小订单 | 状态 |
|------|------|----------|-----------|----------|------|
| `will-trump-win-2024` | Will Donald Trump win the 2024 US Presidential Election? | 0.62 | 0.01 | 5 USDC | ✅ 接受下单 |
| `btc-100k-2024` | Will Bitcoin reach $100,000 by end of 2024? | 0.45 | 0.01 | 10 USDC | ✅ 接受下单 |
| `eth-merge-completed` | Will the Ethereum merge complete successfully? | 0.88 | 0.005 | 5 USDC | ❌ 已关闭 |
| `fed-rate-cut-2025` | Will the Fed cut rates by 50bps in Q1 2025? | 0.71 | 0.01 | 10 USDC | ✅ 接受下单 |

> `eth-merge-completed` 的 `acceptingOrders: false`，可以用来测试"市场已关闭"的错误处理。

---

## 4. 六个工具详解

---

### 4.1 authorize_market_trade

**用途**：创建交易授权。这是所有交易的**第一步**，必须先调用。

**类比**：你去赌场，先到柜台换筹码并设定"最多输 500 块、单次下注不超过 100 块"。

#### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `market_slug` | string | ✅ | — | 市场标识，如 `"btc-100k-2024"`。用 `"*"` 表示授权所有市场 |
| `spending_limit` | number | ✅ | — | 总花费上限（USDC），如 `500` |
| `max_order_size` | number | ✅ | — | 单笔订单最大金额，如 `100` |
| `allowed_sides` | array | 否 | `["BUY","SELL"]` | 允许的方向 |
| `allowed_order_types` | array | 否 | `["GTC","FOK"]` | 允许的订单类型 |
| `expires_in_hours` | number | 否 | `24` | 有效期（小时），最大 720（30天） |
| `response_format` | enum | 否 | `"json"` | 输出格式：`"json"` 或 `"markdown"` |

#### 示例调用

```json
{
  "market_slug": "btc-100k-2024",
  "spending_limit": 500,
  "max_order_size": 100
}
```

只用必填参数，其他用默认值。

```json
{
  "market_slug": "*",
  "spending_limit": 2000,
  "max_order_size": 200,
  "allowed_sides": ["BUY"],
  "allowed_order_types": ["GTC", "FOK", "FAK"],
  "expires_in_hours": 48
}
```

全参数示例：授权所有市场、只能买入、48 小时有效。

#### 成功返回示例

```json
{
  "authorization_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "market": {
    "slug": "btc-100k-2024",
    "title": "Will Bitcoin reach $100,000 by end of 2024?",
    "id": "0xabc002-btc-100k"
  },
  "limits": {
    "spending_limit": 500,
    "max_order_size": 100,
    "allowed_sides": ["BUY", "SELL"],
    "allowed_order_types": ["GTC", "FOK"]
  },
  "spending_summary": {
    "total_spent": 0,
    "remaining_limit": 500,
    "active_order_count": 0
  },
  "status": "ACTIVE",
  "created_at": "2026-07-04T12:00:00.000Z",
  "expires_at": "2026-07-05T12:00:00.000Z"
}
```

> ⚠️ **关键**：`authorization_id` 是后续所有操作必需的凭证，请复制保存。

#### 常见错误

| 情况 | 错误码 | 解决 |
|------|--------|------|
| market_slug 打错了 | `MARKET_NOT_FOUND` | 返回信息会列出所有可用 slug |
| spending_limit < max_order_size | `INVALID_LIMITS` | spending_limit 必须 ≥ max_order_size |
| expires_in_hours > 720 | 验证错误 | 最大 720 小时（30 天） |

---

### 4.2 place_order

**用途**：在已授权市场上下单。支持四种订单类型。

**类比**：你拿着筹码走到赌桌，下注 "YES 50 块 价格 0.45"。

#### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `authorization_id` | uuid | ✅ | — | 从 authorize_market_trade 获得的授权 ID |
| `market_slug` | string | ✅ | — | 目标市场 |
| `outcome` | enum | ✅ | — | `"YES"` 或 `"NO"` |
| `side` | enum | ✅ | — | `"BUY"` 或 `"SELL"` |
| `amount` | number | ✅ | — | 金额（USDC）。BUY=花费金额，SELL=卖出 token 数量 |
| `price` | string | ✅ | — | 限价，如 `"0.50"`。必须符合市场 tick size |
| `order_type` | enum | 否 | `"GTC"` | `"GTC"` / `"GTD"` / `"FOK"` / `"FAK"` |
| `expires_at` | datetime | 否 | — | 仅 GTD 订单需要，ISO-8601 格式 |
| `response_format` | enum | 否 | `"json"` | 输出格式 |

#### 订单类型行为详解

##### GTC（Good-Till-Cancelled，限价挂单）

```json
{
  "authorization_id": "f47ac10b-...",
  "market_slug": "btc-100k-2024",
  "outcome": "YES",
  "side": "BUY",
  "amount": 50,
  "price": "0.45",
  "order_type": "GTC"
}
```

行为：订单立即变为 `OPEN` 状态，挂到订单簿上。**不会自动成交**，需要用 cancel_order 来撤销。

##### GTD（Good-Till-Date，限价 + 过期）

```json
{
  "authorization_id": "f47ac10b-...",
  "market_slug": "btc-100k-2024",
  "outcome": "YES",
  "side": "BUY",
  "amount": 50,
  "price": "0.45",
  "order_type": "GTD",
  "expires_at": "2026-07-05T12:00:00.000Z"
}
```

行为：同 GTC，但到期后查询时自动变为 `EXPIRED`。

##### FOK（Fill-Or-Kill，全额成交否则取消）

```json
{
  "authorization_id": "f47ac10b-...",
  "market_slug": "btc-100k-2024",
  "outcome": "NO",
  "side": "BUY",
  "amount": 50,
  "price": "0.55",
  "order_type": "FOK"
}
```

行为：检查订单簿上卖单（asks）中 `price ≤ 0.55` 的流动性总量：
- 流动性 ≥ 50 → `FILLED`（金额成交）
- 流动性 < 50 → `REJECTED`（拒绝）

##### FAK（Fill-And-Kill，部分成交剩余取消）

```json
{
  "authorization_id": "f47ac10b-...",
  "market_slug": "fed-rate-cut-2025",
  "outcome": "YES",
  "side": "SELL",
  "amount": 100,
  "price": "0.70",
  "order_type": "FAK"
}
```

行为：检查订单簿流动性：
- 流动性 ≥ 100 → `FILLED`
- 0 < 流动性 < 100 → `PARTIALLY_FILLED`（部分成交，剩余取消）
- 流动性 = 0 → `REJECTED`

#### 成功返回示例

```json
{
  "order": {
    "id": "a1b2c3d4-...",
    "market_id": "0xabc002-btc-100k",
    "side": "BUY",
    "outcome": "YES",
    "order_type": "FOK",
    "price": "0.55",
    "original_size": 50,
    "filled_size": 50,
    "remaining_size": 0,
    "status": "FILLED",
    "created_at": "2026-07-04T12:05:00.000Z",
    "matched_orders": [
      {
        "fillId": "fill_1751544300000_0",
        "fillTime": "2026-07-04T12:05:00.100Z",
        "fillSize": 25,
        "fillPrice": "0.55",
        "counterpartyOrderId": "counterparty_abc12345"
      }
    ]
  },
  "spending_summary": {
    "total_spent": 50,
    "remaining_limit": 450,
    "active_order_count": 1
  }
}
```

#### 風控摘要（spending_summary）解读

| 字段 | 含义 |
|------|------|
| `total_spent` | 该授权下所有已成交 BUY 订单的金额总和 |
| `remaining_limit` | 还能花多少钱 = spending_limit - total_spent |
| `active_order_count` | 当前挂单（OPEN / PARTIALLY_FILLED）的数量 |

#### 常见错误

| 情况 | 错误码 |
|------|--------|
| 授权不存在 | `AUTH_NOT_FOUND` |
| 授权已过期 | `AUTH_EXPIRED` |
| 市场不存在 | `MARKET_NOT_FOUND` |
| 市场不接收订单 | `MARKET_NOT_ACCEPTING`（如 eth-merge-completed） |
| 金额超单笔上限 | `LIMIT_EXCEEDED` |
| 金额超总额上限 | `SPENDING_LIMIT_EXCEEDED` |
| 价格不符合 tick size | `INVALID_PRICE` |
| 授权不允许该方向 | `UNSUPPORTED_SIDE` |
| 授权不允许该订单类型 | `UNSUPPORTED_ORDER_TYPE` |
| FOK 流动性不足 | `INSUFFICIENT_LIQUIDITY` |

---

### 4.3 cancel_order

**用途**：撤销一个未成交的挂单（GTC/GTD）。只有 `OPEN` 或 `PARTIALLY_FILLED` 状态的订单可以撤销。

#### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `authorization_id` | uuid | ✅ | 下单时使用的授权 ID |
| `order_id` | uuid | ✅ | 要撤销的订单 ID（place_order 返回的那个） |

#### 示例调用

```json
{
  "authorization_id": "f47ac10b-...",
  "order_id": "a1b2c3d4-..."
}
```

#### 成功返回示例

```json
{
  "order": {
    "id": "a1b2c3d4-...",
    "previous_status": "OPEN",
    "new_status": "CANCELLED",
    "side": "BUY",
    "price": "0.45",
    "original_size": 50,
    "filled_size": 0
  },
  "spending_summary": {
    "total_spent": 0,
    "remaining_limit": 500,
    "active_order_count": 0
  }
}
```

#### 常见错误

| 情况 | 错误码 |
|------|--------|
| 订单不存在 | `ORDER_NOT_FOUND` |
| 订单已是终态（FILLED/REJECTED/CANCELLED/EXPIRED） | `ORDER_NOT_CANCELLABLE` |
| 订单不属于该授权 | `ORDER_AUTH_MISMATCH` |

---

### 4.4 revoke_authorization

**用途**：作废一个授权。作废后，该授权下的所有后续操作都会被拒绝。已成交的订单不受影响。

**类比**：你离开赌场前，把筹码退还柜台，之后不能再下注。

#### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `authorization_id` | uuid | ✅ | — | 要作废的授权 ID |
| `reason` | string | 否 | `"Revoked by user"` | 作废原因，最多 500 字符 |

#### 示例调用

```json
{
  "authorization_id": "f47ac10b-...",
  "reason": "交易完成，不再需要此授权"
}
```

#### 成功返回

```json
{
  "authorization_id": "f47ac10b-...",
  "new_status": "REVOKED",
  "reason": "交易完成，不再需要此授权"
}
```

#### 常见错误

| 情况 | 错误码 |
|------|--------|
| 授权不存在 | `AUTH_NOT_FOUND` |
| 授权已被撤销 | `AUTH_INACTIVE`（状态已是 REVOKED） |

---

### 4.5 get_current_permissions

**用途**：查看当前所有授权，每个授权附带使用情况摘要。

**类比**：查看你有多少张筹码券、每张还剩多少钱可以花。

#### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `status_filter` | enum | 否 | `"ACTIVE"` | 按状态筛选：`"ACTIVE"` / `"REVOKED"` / `"EXPIRED"` |
| `limit` | number | 否 | `20` | 每页条数（1-100） |
| `offset` | number | 否 | `0` | 跳过条数 |

#### 示例调用

```json
{}
```

全部默认：列出所有 ACTIVE 的授权。

```json
{
  "status_filter": "REVOKED",
  "limit": 10
}
```

列出已撤销的授权，每页 10 条。

#### 成功返回示例

```json
{
  "total": 2,
  "count": 2,
  "offset": 0,
  "authorizations": [
    {
      "id": "f47ac10b-...",
      "marketId": "0xabc002-btc-100k",
      "marketSlug": "btc-100k-2024",
      "marketTitle": "Will Bitcoin reach $100,000 by end of 2024?",
      "spendingLimit": 500,
      "maxOrderSize": 100,
      "allowedSides": ["BUY", "SELL"],
      "allowedOrderTypes": ["GTC", "FOK"],
      "status": "ACTIVE",
      "createdAt": "2026-07-04T12:00:00.000Z",
      "expiresAt": "2026-07-05T12:00:00.000Z",
      "usage": {
        "total_spent": 50,
        "remaining_limit": 450,
        "active_order_count": 1
      }
    }
  ],
  "has_more": false
}
```

> 💡 `usage` 部分是实时计算的：total_spent 统计该授权下所有 FILLED/PARTIALLY_FILLED 的 BUY 订单总额。

---

### 4.6 get_order_history

**用途**：查询某个授权下的历史订单。支持多维度筛选和分页。

#### 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `authorization_id` | uuid | ✅ | — | 授权 ID |
| `status_filter` | enum | 否 | — | 按订单状态筛选 |
| `market_slug` | string | 否 | — | 按市场筛选 |
| `side` | enum | 否 | — | 按方向筛选：`"BUY"` / `"SELL"` |
| `limit` | number | 否 | `20` | 每页条数 |
| `offset` | number | 否 | `0` | 跳过条数 |

#### 示例调用

```json
{
  "authorization_id": "f47ac10b-..."
}
```

最简单：列出该授权下所有订单。

```json
{
  "authorization_id": "f47ac10b-...",
  "status_filter": "FILLED",
  "side": "BUY",
  "limit": 5
}
```

筛选：只看已成交的买单，最多 5 条。

#### 成功返回

```json
{
  "total": 3,
  "count": 3,
  "offset": 0,
  "orders": [
    {
      "id": "a1b2c3d4-...",
      "authorizationId": "f47ac10b-...",
      "marketId": "0xabc002-btc-100k",
      "side": "BUY",
      "orderType": "FOK",
      "price": "0.55",
      "originalSize": 50,
      "filledSize": 50,
      "remainingSize": 0,
      "status": "FILLED",
      "createdAt": "2026-07-04T12:05:00.000Z",
      "updatedAt": "2026-07-04T12:05:00.000Z",
      "matchedOrders": [
        {
          "fillId": "fill_1751544300000_0",
          "fillTime": "2026-07-04T12:05:00.100Z",
          "fillSize": 25,
          "fillPrice": "0.55",
          "counterpartyOrderId": "counterparty_abc12345"
        }
      ]
    }
  ],
  "has_more": false
}
```

> 💡 GTD 订单在查询时如果 `expiresAt` 已过，会自动变为 `EXPIRED` 状态。

---

## 5. 典型操作流程

### 流程一：基础交易流程（推荐首次体验）

```
Step 1: authorize_market_trade ──→ 拿到 authorization_id
         { "market_slug": "btc-100k-2024", "spending_limit": 1000, "max_order_size": 200 }

Step 2: place_order (GTC 挂单) ──→ 订单 OPEN, 记下 order_id
         { "authorization_id": "xxx", "market_slug": "btc-100k-2024",
           "outcome": "YES", "side": "BUY", "amount": 100, "price": "0.45" }

Step 3: get_order_history ──→ 确认订单已存在
         { "authorization_id": "xxx" }

Step 4: get_current_permissions ──→ 看到 usage 中 active_order_count = 1
         {}

Step 5: cancel_order ──→ 撤销挂单
         { "authorization_id": "xxx", "order_id": "yyy" }

Step 6: revoke_authorization ──→ 作废授权
         { "authorization_id": "xxx" }
```

### 流程二：市价单测试（体验 FOK/FAK）

```
Step 1: authorize_market_trade
         { "market_slug": "fed-rate-cut-2025", "spending_limit": 500, "max_order_size": 200,
           "allowed_order_types": ["FOK", "FAK"] }

Step 2: place_order (FOK) ──→ 大概率 FILLED（流动性充足）
         { "authorization_id": "xxx", "market_slug": "fed-rate-cut-2025",
           "outcome": "YES", "side": "BUY", "amount": 50, "price": "0.75",
           "order_type": "FOK" }

Step 3: place_order (FOK, 天价) ──→ REJECTED（流动性不足）
         { ..., "amount": 50000, "price": "0.50", "order_type": "FOK" }

Step 4: place_order (FAK) ──→ 可能 PARTIALLY_FILLED
         { ..., "amount": 5000, "price": "0.80", "order_type": "FAK" }
```

### 流程三：多市场授权测试

```
Step 1: authorize_market_trade (通配符)
         { "market_slug": "*", "spending_limit": 2000, "max_order_size": 200 }

Step 2: place_order (btc 市场)
         { "authorization_id": "xxx", "market_slug": "btc-100k-2024", ... }

Step 3: place_order (fed 市场) ──→ 同一个授权，成功！
         { "authorization_id": "xxx", "market_slug": "fed-rate-cut-2025", ... }
```

### 流程四：测试错误场景

```
测试 1: 下单到已关闭的市场
  → place_order 到 eth-merge-completed
  → 返回 MARKET_NOT_ACCEPTING

测试 2: 超限下单
  → authorize (spending_limit=100, max_order_size=50)
  → place_order amount=60
  → 返回 LIMIT_EXCEEDED

测试 3: 累计超限
  → place_order FOK amount=60 → FILLED
  → place_order FOK amount=60 → SPENDING_LIMIT_EXCEEDED (60+60=120 > 100)
```

---

## 6. 错误码速查表

所有错误都返回三个字段：`code`（错误码）、`message`（描述）、`suggestion`（建议）。

| 错误码 | 触发条件 | 建议操作 |
|--------|----------|----------|
| `AUTH_NOT_FOUND` | 授权 ID 不存在或已删除 | 用 `get_current_permissions` 查看有效授权 |
| `AUTH_EXPIRED` | 授权已过期 | 重新调用 `authorize_market_trade` |
| `AUTH_REVOKED` | 授权已被撤销 | 重新调用 `authorize_market_trade` |
| `AUTH_INACTIVE` | 授权状态不是 ACTIVE | 检查该授权的当前状态 |
| `MARKET_NOT_FOUND` | slug 不匹配任何已知市场 | 返回消息会列出可用 slug 列表 |
| `MARKET_NOT_ACCEPTING` | 市场已关闭不接受订单 | 换一个仍然活跃的市场 |
| `OUTCOME_NOT_FOUND` | outcome 不是 YES 或 NO | 用 YES 或 NO |
| `ORDER_NOT_FOUND` | 订单 ID 不存在 | 用 `get_order_history` 查看有效订单 |
| `ORDER_NOT_CANCELLABLE` | 订单已是终态无法撤销 | 只有 OPEN/PARTIALLY_FILLED 可撤销 |
| `ORDER_AUTH_MISMATCH` | 订单属于另一个授权 | 使用下单时的原始授权 ID |
| `LIMIT_EXCEEDED` | 单笔金额超过 max_order_size | 减少 amount 或创建新的授权 |
| `SPENDING_LIMIT_EXCEEDED` | 累计花费超过 spending_limit | 减少 amount 或撤销旧授权释放额度 |
| `UNSUPPORTED_SIDE` | 授权不允许该方向 | 查看授权的 allowed_sides |
| `UNSUPPORTED_ORDER_TYPE` | 授权不允许该订单类型 | 查看授权的 allowed_order_types |
| `MARKET_SCOPE_VIOLATION` | 市场不在授权范围内 | 用 `get_current_permissions` 查找该市场的授权 |
| `INVALID_PRICE` | 价格不符合 tick size | 价格为 tick size 的整数倍（如 0.01, 0.02...） |
| `INSUFFICIENT_LIQUIDITY` | FOK 无法全额成交 | 减少 amount 或调整价格 |
| `INVALID_LIMITS` | spending_limit < max_order_size | spending_limit 必须 ≥ max_order_size |
| `INTERNAL_ERROR` | 服务器内部错误 | 重试 |

---

## 小贴士

1. **授权 ID 很重要**：每次 `authorize_market_trade` 返回的 `authorization_id` 是后续所有操作的钥匙，建议立即复制保存
2. **FOK 用于确定成交**：如果你想要确定的结果（要么全成交要么不成交），用 FOK
3. **GTC 用于"挂单等待"**：GTC 订单会一直挂着，需要手动 cancel；在这个 Mock 系统中它不会自动成交
4. **`*` 通配符很方便**：创建一个 `market_slug: "*"` 的授权就可以在所有市场下单
5. **学会看 spending_summary**：每次下单后检查 `remaining_limit`，避免超出预算
6. **重启服务器 = 重置所有状态**：所有授权和订单都存在内存中，服务器重启后全部清空，重新加载 4 个种子市场
