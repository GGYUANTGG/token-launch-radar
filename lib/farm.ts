// Farm plans: one plan per protocol, assembled from its own record — category, chains, TVL and age.
// Every step is an action with a cost and a time. The category playbooks say what to do inside the
// product; the chain table says what a transaction costs there; the capital and the hold window
// scale with the protocol's size and how long it has been running. No name is special-cased.

import type { SnapshotProtocol } from './model.ts';

/** A farm step before it is flattened to the board's string form. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Rough per-transaction network fees in USD, by chain as the snapshot names it. */
const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.05,
  Base: 0.15,
  Arbitrum: 0.35,
  BSC: 0.25,
  Polygon: 0.05,
  Avalanche: 0.45,
  Optimism: 0.25,
  'OP Mainnet': 0.25,
  zkSync: 0.3,
  'zkSync Era': 0.3,
  Linea: 0.3,
  Scroll: 0.35,
  Mantle: 0.2,
  Blast: 0.2,
  Berachain: 0.3,
  Sonic: 0.1,
  Fantom: 0.1,
  Gnosis: 0.05,
  Celo: 0.05,
  Tron: 0.3,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  Cosmos: 0.1,
  Bitcoin: 1.5,
};

function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How many weeks to stay active, from the protocol's age: younger protocols qualify over a longer window. */
function holdWeeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 365) return 8;
  if (age < 730) return 6;
  return 5;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

interface Playbook {
  core: (name: string, capital: number, chain: string) => string;
  depth: (name: string, capital: number, chain: string) => string;
  weekly: (name: string) => string;
}

const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['lend', 'cdp', 'collateral'],
    book: {
      core: (n, c, ch) => `Supply ${money(c)} of USDC as collateral in ${n}'s main market on ${ch} and leave it supplied.`,
      depth: (n, c) => `Borrow about ${money(Math.round(c * 0.4))} of a second stablecoin against the position and re-supply it once, so the wallet shows both sides of the market.`,
      weekly: (n) => `Repay a small slice and borrow it back, or top the supply up by a few dollars, so ${n} records an active lending wallet each week.`,
    },
  },
  {
    match: ['dex', 'amm', 'swap'],
    book: {
      core: (n, c, ch) => `Add ${money(c)} of liquidity to ${n}'s busiest stable or ETH pool on ${ch} and keep the LP position open.`,
      depth: (n, c) => `Make three swaps of about ${money(Math.round(c / 3))} through ${n}'s own interface rather than an aggregator, so the volume is credited to your wallet.`,
      weekly: (n) => `Harvest any fees and re-add them to the pool, and make one more small swap on ${n}.`,
    },
  },
  {
    match: ['perpetual', 'derivative', 'option'],
    book: {
      core: (n, c, ch) => `Deposit ${money(c)} of USDC as margin on ${n} (${ch}) and open one small hedged position, long and short the same asset in equal size.`,
      depth: (n, c) => `Trade up to about ${money(c * 4)} of total volume across the week in small clips, keeping the hedge balanced so price moves cost little.`,
      weekly: (n) => `Roll the hedge once and add one small trade, so ${n} sees a returning trader rather than a one-day wallet.`,
    },
  },
  {
    match: ['yield', 'aggregator', 'farming', 'farm'],
    book: {
      core: (n, c, ch) => `Deposit ${money(c)} of USDC into ${n}'s main vault on ${ch} and hold the vault shares in the same wallet.`,
      depth: (n, c) => `Move about ${money(Math.round(c / 2))} into a second ${n} vault with a different strategy, so the wallet holds two distinct positions.`,
      weekly: (n) => `Claim the week's yield on ${n} and redeposit it into the same vault.`,
    },
  },
  {
    match: ['staking', 'restak'],
    book: {
      core: (n, c, ch) => `Stake ${money(c)} of the chain's staking asset through ${n} on ${ch} and keep the liquid receipt token in your wallet.`,
      depth: (n, c) => `Use about ${money(Math.round(c / 2))} of the receipt token in a lending market or pool that ${n} links to, so both protocols record the wallet.`,
      weekly: (n) => `Claim staking rewards on ${n} and restake them instead of selling.`,
    },
  },
  {
    match: ['bridge'],
    book: {
      core: (n, c, ch) => `Bridge ${money(c)} of USDC from Ethereum to ${ch} through ${n}, then use the bridged funds in one app on the far side.`,
      depth: (n, c) => `Bridge a second, smaller amount of about ${money(Math.round(c / 3))} on a different day and bridge a little back, so the wallet has traffic in both directions.`,
      weekly: (n) => `Make one small bridge of $10-20 through ${n} each week rather than one large transfer.`,
    },
  },
  {
    match: ['stable'],
    book: {
      core: (n, c, ch) => `Mint or deposit ${money(c)} of ${n}'s stable asset on ${ch} through its own app and hold the balance.`,
      depth: (n, c) => `Provide about ${money(Math.round(c / 2))} of liquidity to the stable asset's main pool so the wallet earns and is seen holding it.`,
      weekly: (n) => `Add a few dollars to the position and check ${n}'s rewards page for a points or season balance.`,
    },
  },
  {
    match: ['rwa', 'real world'],
    book: {
      core: (n, c, ch) => `Mint ${money(c)} of ${n}'s yield-bearing asset on ${ch} and hold it past the first yield distribution.`,
      depth: (n, c) => `Hold the asset through a second distribution and keep the distribution receipts with your farm log.`,
      weekly: (n) => `Open ${n}'s dashboard once a week and claim any distribution that is waiting.`,
    },
  },
  {
    match: ['prediction'],
    book: {
      core: (n, c) => `Fund ${money(c)} on ${n} and take positions in three different markets, sized so no single market holds more than a third.`,
      depth: (n, c) => `Trade out of one position before it settles and into a new market, so the wallet shows both entries and exits.`,
      weekly: (n) => `Place one or two small positions on ${n} each week, favouring markets that settle within the month.`,
    },
  },
  {
    match: ['insurance'],
    book: {
      core: (n, c, ch) => `Buy ${money(c)} of cover on a large protocol from ${n} on ${ch} and keep the policy to expiry.`,
      depth: (n, c) => `Stake about ${money(Math.round(c / 2))} into ${n}'s underwriting pool as well, so the wallet appears on both sides of the market.`,
      weekly: (n) => `Check the policy and the pool position on ${n} once a week and renew the cover before it lapses.`,
    },
  },
  {
    match: ['curator', 'allocator', 'risk'],
    book: {
      core: (n, c, ch) => `Deposit ${money(c)} of USDC into one of ${n}'s curated vaults on ${ch} and keep the vault shares.`,
      depth: (n, c) => `Split a second ${money(Math.round(c / 2))} across a vault from a different curator on ${n}, so the wallet is not tied to one strategy.`,
      weekly: (n) => `Claim any vault rewards on ${n} and redeposit them into the same vault.`,
    },
  },
  {
    match: ['basis'],
    book: {
      core: (n, c, ch) => `Deposit ${money(c)} of USDC into ${n}'s basis vault on ${ch} and hold the position while the funding spread is positive.`,
      depth: (n, c) => `Add about ${money(Math.round(c / 2))} more after the first yield payment lands, so the wallet shows two separate deposits.`,
      weekly: (n) => `Check the vault's yield and your share balance on ${n} once a week; claim and redeposit monthly.`,
    },
  },
];

const DEFAULT_BOOK: Playbook = {
  core: (n, c, ch) => `Deposit ${money(c)} of USDC into ${n}'s main product on ${ch} through its own app and keep the position open.`,
  depth: (n, c) => `Use a second feature of ${n} with about ${money(Math.round(c / 2))} — a second pool, a borrow, a stake or a vote — so the wallet is more than a single deposit.`,
  weekly: (n) => `Make one small qualifying action on ${n} — a deposit, a swap, a claim or a vote — each week.`,
};

function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) {
    if (entry.match.some((m) => c.includes(m))) return entry.book;
  }
  return DEFAULT_BOOK;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const weeks = holdWeeksFor(age);
  const book = playbookFor(p);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with, keep its seed phrase offline, and fund it on ${chain} first.`,
      cost: `about ${money(gas)} of network fees for the funding transaction`,
      time: '10 minutes',
    },
    {
      text: book.core(p.name, capital, chain),
      cost: `${money(capital)} of capital and about ${money(gas * 2)} of network fees`,
      time: '15 minutes to set up',
    },
    {
      text: book.depth(p.name, capital, chain),
      cost: `about ${money(gas * 2)} of network fees on top of the capital already in`,
      time: '15 minutes',
    },
    {
      text: book.weekly(p.name),
      cost: `about ${money(gas)} of network fees a week`,
      time: '10 minutes a week',
    },
    {
      text: `Stay active for at least ${weeks} weeks so the wallet appears in several weekly snapshots, and check ${p.name}'s own points or rewards page before the end of each month.`,
      cost: `the ${money(capital)} stays in the position for the ${weeks} weeks`,
      time: `${weeks} weeks`,
    },
    {
      text: `Claim any allocation only from the link ${p.name} publishes on its own site or verified account, never pay a fee to claim, and log the wallet, the dates and every transaction so you can unwind the position.`,
      cost: 'nothing to check; a claim that asks for a fee is a scam',
      time: '10 minutes',
    },
  ];
}
