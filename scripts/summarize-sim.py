"""Aggregate calib/sim/*.jsonl chunks into one table with exact (Clopper-Pearson) 95% CIs."""
import glob, json, math, sys

def binom_cdf(k, n, p):
    """P(X <= k), X ~ Binomial(n, p), summed in log space (stable for large n)"""
    if k < 0: return 0.0
    if k >= n: return 1.0
    if p <= 0: return 1.0
    if p >= 1: return 0.0
    lp, lq = math.log(p), math.log1p(-p)
    tot = 0.0
    for i in range(0, k + 1):
        tot += math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * lp + (n - i) * lq)
    return min(1.0, tot)

def cp(k, n):
    def solve(f):
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if f(mid): lo = mid
            else: hi = mid
        return lo
    lower = 0.0 if k == 0 else solve(lambda p: 1 - binom_cdf(k - 1, n, p) < 0.025)
    upper = 1.0 if k == n else solve(lambda p: binom_cdf(k, n, p) > 0.025)
    return lower, upper

rows = {}
for f in sorted(glob.glob('calib/sim/*.jsonl') + glob.glob('calib/sim/bootstrap/*.jsonl')):
    for line in open(f):
        if not line.strip(): continue
        r = json.loads(line)
        pv = r.get('pv') or ('bootstrap' if '/bootstrap/' in f else 'conservative' if 'conservative' in f else 'mid')
        key = (('bootstrap/' if '/bootstrap/' in f else '') + f.split('/')[-1].replace('.jsonl', ''), r['mode'], pv, r['truth'], r.get('alt', ''), r['w'], r['testN'])
        a = rows.setdefault(key, [0, 0, 0, 0])
        a[0] += r['sims']; a[1] += r['below_fail']; a[2] += r['below_warn']; a[3] += r['below_05']
out = []
for k, (n, f, w, p5) in rows.items():
    lo1, hi1 = cp(f, n); lo2, hi2 = cp(w, n)
    out.append({'file': k[0], 'mode': k[1], 'pv': k[2], 'truth': k[3], 'alt': k[4], 'w': k[5], 'testN': k[6], 'sims': n,
                'rate_p<0.001': f / n, 'ci_0.001': [round(lo1, 5), round(hi1, 5)], 'rate_p<0.01': w / n, 'ci_0.01': [round(lo2, 5), round(hi2, 5)], 'rate_p<0.05': p5 / n})
for o in out:
    print(f"{o['file']:38s} {o['mode']:5s} {o['pv']:12s} {o['truth']:9s} w={o['w']:<4} n={o['testN']:<3} sims={o['sims']:<6} p<.001: {o['rate_p<0.001']*100:.3f}% [{o['ci_0.001'][0]*100:.3f},{o['ci_0.001'][1]*100:.3f}]  p<.01: {o['rate_p<0.01']*100:.2f}% [{o['ci_0.01'][0]*100:.2f},{o['ci_0.01'][1]*100:.2f}]  p<.05: {o['rate_p<0.05']*100:.2f}%")
json.dump(out, open('calib/sim-summary.json', 'w'), indent=1)
