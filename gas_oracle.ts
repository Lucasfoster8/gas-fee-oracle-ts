// gas_oracle.ts — weighted-median gas oracle with jitter-aware recommendation.
// Pulls baseFee + priority from multiple RPCs, filters outliers, computes advice.
//
// Requires: npm i ethers
import { ethers } from "ethers";

type Sample = { name: string; base: number; prio: number; block: number };
const RPCS: Record<string, string> = {
  ankr: process.env.RPC_ANKR || "",
  alchemy: process.env.RPC_ALCH || "",
  public: process.env.RPC_PUB || "https://cloudflare-eth.com"
};

async function sample(name: string, url: string): Promise<Sample|null> {
  try {
    const p = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
    const fee = await p.send("eth_feeHistory", [1, "latest", [10, 20, 30]]);
    const baseHex = fee.baseFeePerGas?.[0] || "0x0";
    const base = Number(baseHex);
    const prios = (fee.reward?.[0] || []).map((x: string) => Number(x));
    const prio = prios.sort((a,b)=>a-b)[Math.floor(prios.length/2)] || 0;
    const blk = Number(fee.oldestBlock || 0);
    return { name, base, prio, block: blk };
  } catch (e) {
    return null;
  }
}

function median(nums: number[]): number {
  const xs = nums.slice().sort((a,b)=>a-b);
  const m = Math.floor(xs.length/2);
  return xs.length ? (xs.length%2? xs[m] : Math.floor((xs[m-1]+xs[m])/2)) : 0;
}

function rmOutliers(xs: number[]): number[] {
  if (xs.length < 4) return xs;
  const med = median(xs);
  const mad = median(xs.map(x => Math.abs(x - med))) || 1;
  return xs.filter(x => Math.abs(x - med) <= 3*mad);
}

(async () => {
  const samples: Sample[] = [];
  for (const [name, url] of Object.entries(RPCS)) {
    if (!url) continue;
    const s = await sample(name, url);
    if (s) samples.push(s);
  }
  if (!samples.length) {
    console.error("no samples"); process.exit(1);
  }

  const bases = rmOutliers(samples.map(s=>s.base));
  const prios = rmOutliers(samples.map(s=>s.prio));
  const baseMed = median(bases);
  const prioMed = median(prios);

  // recommendation: base * (1 + jitter) + prio
  const jitter = 0.12; // 12% buffer
  const tip = Math.max(prioMed, 1_000_000); // at least 1 gwei-ish
  const rec = Math.floor(baseMed * (1 + jitter)) + tip;

  const gwei = (n:number)=> (n/1e9).toFixed(2);
  console.log(JSON.stringify({
    providers: samples.map(s=>s.name),
    baseMedianWei: baseMed,
    prioMedianWei: prioMed,
    recommendedWei: rec,
    pretty: { baseGwei: gwei(baseMed), prioGwei: gwei(prioMed), recommendedGwei: gwei(rec) }
  }, null, 2));
})();
