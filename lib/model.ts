// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol the snapshot records with no token that could still launch one:
// the whole watchlist (the floor, never a ceiling) plus every other pre-token protocol in the file,
// with no cap. Protocols whose token already trades are never ranked; they are the evidence.
//
// The implied value is a peer comparison, fitted from the snapshot's own figures at run time:
//   1. Peers are the protocols whose token already trades (a market cap and a TVL are recorded).
//      Wild prints (a market-cap/TVL ratio outside [0.002, 25]) are trimmed before fitting.
//   2. A least-squares line on (ln TVL, ln market cap) over the trimmed peers gives the market's
//      size curve: value grows slower than TVL, so big protocols earn a smaller multiple.
//   3. Each category keeps its own offset from that line: the median residual of its peers,
//      shrunk toward zero by n/(n+6) so a category with two peers cannot shout, capped to [0.15, 6].
//   4. Three adjustments, each from the protocol's own record: momentum (its 7-day TVL change,
//      clamped), tenure (how long it has run with no token, saturating), and breadth (how many
//      chains its TVL sits on, capped).
// No protocol name is ever special-cased: the same fitted function scores every row, and the page
// recomputes each row from the shipped parameters so the code and the board are the same arithmetic.

import { farmSteps, stepText } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's fixed constants. The fitted parameters (alpha, beta, offsets) come from the data. */
export interface ModelConstants {
  ratio_min: number;
  ratio_max: number;
  shrink_k: number;
  offset_min: number;
  offset_max: number;
  momentum_floor: number;
  momentum_cap: number;
  momentum_weight: number;
  tenure_base: number;
  tenure_range: number;
  tenure_tau_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  ratio_min: 0.002,
  ratio_max: 25,
  shrink_k: 6,
  offset_min: 0.15,
  offset_max: 6,
  momentum_floor: -40,
  momentum_cap: 60,
  momentum_weight: 0.6,
  tenure_base: 0.78,
  tenure_range: 0.38,
  tenure_tau_days: 650,
  unknown_age_days: 400,
  breadth_per_chain: 0.03,
  breadth_max_extra: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'peerfit-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One tokened peer of a category, as the detail view shows it. */
export interface PeerComp {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** A category's fitted place in the model. */
export interface CategoryFit {
  category: string;
  peers: number;
  median_ratio: number | null;
  offset: number;
  top_peers: PeerComp[];
}

/** The fitted model: the size curve plus every category's offset. */
export interface Fit {
  alpha: number;
  beta: number;
  peers_total: number;
  peers_used: number;
  global_median_ratio: number;
  categories: CategoryFit[];
  byCategory: Map<string, CategoryFit>;
}

/** The full arithmetic of one row's implied value. */
export interface Breakdown {
  peer_base_usd: number;
  category_offset: number;
  category_peers: number;
  momentum_pct: number;
  momentum_multiplier: number;
  tenure_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: Breakdown;
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row plus its category's top peer comps. */
export interface RadarRow extends BoardRow {
  peers: PeerComp[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: { alpha: number; beta: number; peers_total: number; peers_used: number; global_median_ratio: number };
  categories: CategoryFit[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The watchlist's own product exclusions, applied to the whole universe: a wrapped, staked or
 * bridged product of a token that already trades is not a launch that has not happened yet —
 * WBTC is Bitcoin on Ethereum, whatever its record's token fields say. The snapshot carries no
 * parentProtocol field, so the board uses the same signals the watchlist's rule names: the
 * product categories, a wrapped/staked/staking word in the name, and an exchange's name at the
 * front of it. The watchlist itself contains none of these by construction, so coverage is safe.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_FRONT = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol is one the board may rank: pre-token, and not a product of a trading token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_FRONT.test(p.name)) return false;
  return true;
}

/** Whether a protocol can serve as a valuation peer: its token trades and both figures are real. */
function isPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/**
 * Fit the size curve and the category offsets from the snapshot's tokened protocols.
 * Deterministic: the same snapshot always fits the same model.
 */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): Fit {
  const peers = snapshot.protocols.filter(isPeer);
  const trimmed = peers.filter((p) => {
    const r = p.mcap_usd! / p.tvl_usd;
    return r >= model.ratio_min && r <= model.ratio_max;
  });
  const xs = trimmed.map((p) => Math.log(p.tvl_usd));
  const ys = trimmed.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const beta = den > 0 ? num / den : 1;
  const alpha = my - beta * mx;

  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of peers) {
    const key = p.category ?? '(uncategorised)';
    const list = byCat.get(key) ?? [];
    list.push(p);
    byCat.set(key, list);
  }
  const categories: CategoryFit[] = [];
  const byCategory = new Map<string, CategoryFit>();
  for (const [category, list] of byCat) {
    const residuals = list
      .filter((p) => {
        const r = p.mcap_usd! / p.tvl_usd;
        return r >= model.ratio_min && r <= model.ratio_max;
      })
      .map((p) => Math.log(p.mcap_usd!) - (alpha + beta * Math.log(p.tvl_usd)));
    const shrink = residuals.length / (residuals.length + model.shrink_k);
    const offset = residuals.length === 0 ? 1 : clamp(Math.exp(shrink * median(residuals)), model.offset_min, model.offset_max);
    const top_peers = [...list]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .slice(0, 5)
      .map((p) => ({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: round4(p.mcap_usd! / p.tvl_usd) }));
    const fit: CategoryFit = {
      category,
      peers: list.length,
      median_ratio: round4(median(list.map((p) => p.mcap_usd! / p.tvl_usd))),
      offset: round4(offset),
      top_peers,
    };
    categories.push(fit);
    byCategory.set(category, fit);
  }
  categories.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return {
    alpha,
    beta,
    peers_total: peers.length,
    peers_used: trimmed.length,
    global_median_ratio: round4(median(peers.map((p) => p.mcap_usd! / p.tvl_usd))),
    categories,
    byCategory,
  };
}

/** The implied value and its full breakdown for one protocol under the fitted model. */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: Fit, model: ModelConstants = MODEL): { implied: number; breakdown: Breakdown } {
  const age = ageDays(asOf, p.listed_at);
  const cat = fit.byCategory.get(p.category ?? '(uncategorised)');
  const offset = cat?.offset ?? 1;
  const peerBase = Math.exp(fit.alpha + fit.beta * Math.log(Math.max(1, p.tvl_usd))) * offset;
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const momentumPct = clamp(rawGrowth, model.momentum_floor, model.momentum_cap);
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenureMult = model.tenure_base + model.tenure_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.tenure_tau_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const implied = Math.max(1, Math.round(peerBase * momentumMult * tenureMult * breadthMult));
  return {
    implied,
    breakdown: {
      peer_base_usd: Math.round(peerBase),
      category_offset: round4(offset),
      category_peers: cat?.peers ?? 0,
      momentum_pct: round4(momentumPct),
      momentum_multiplier: round4(momentumMult),
      tenure_multiplier: round4(tenureMult),
      breadth_multiplier: round4(breadthMult),
      age_days: age,
    },
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitModel(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, fit, model);
    return { p, implied, breakdown };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // The gate reads ranks as a value order: where rounding ties two values, walk the lower one down
  // by a dollar at a time so the order on the page is the order in the file.
  for (let i = 1; i < scored.length; i++) {
    if (scored[i]!.implied >= scored[i - 1]!.implied) scored[i]!.implied = Math.max(1, scored[i - 1]!.implied - 1);
  }
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view: the comp set itself. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const rows: RadarRow[] = board.map((row) => ({
    ...row,
    peers: fit.byCategory.get(row.category ?? '(uncategorised)')?.top_peers ?? [],
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: {
      alpha: round4(fit.alpha),
      beta: round4(fit.beta),
      peers_total: fit.peers_total,
      peers_used: fit.peers_used,
      global_median_ratio: fit.global_median_ratio,
    },
    categories: fit.categories.map((c) => ({ ...c, top_peers: c.top_peers.slice(0, 3) })),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A readable data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar, null, 1)};\n`;
}
