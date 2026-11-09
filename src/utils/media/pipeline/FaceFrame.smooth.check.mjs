// node FaceFrame.smooth.check.mjs
import assert from 'node:assert/strict'
import { MAX_SPEED, stepWindow } from './FaceSmooth.js'

const DT = 1000 / 60
/**
 *
 * @param s
 * @param n
 * @param tgt
 * @param rec
 */
function run(s, n, tgt, rec) {
	for (let i = 0; i < n; i++) {
		s = stepWindow(s, tgt(i), DT)
		rec(s, i)
	}
	return s
}
let s = { cx: 0.5, cy: 0.5, zoom: 2 }
const noise = []
s = run(s, 180, (i) => ({ cx: 0.5 + (Math.floor(i / 6) % 2 ? 0.02 : -0.02), cy: 0.5, zoom: 2 }), (w) => noise.push(w.cx))
const amp = Math.max(...noise) - Math.min(...noise)
assert(amp < 0.005, 'a: amp ' + amp)

let prevV = s.vcx, maxDv = 0, maxOver = 0, tReach = null, prevX = s.cx, maxV = 0
run(s, 120, () => ({ cx: 0.7, cy: 0.5, zoom: 2 }), (w, i) => {
	const v = (w.cx - prevX) / (DT / 1000)
	maxDv = Math.max(maxDv, Math.abs(v - prevV)); prevV = v; prevX = w.cx
	maxV = Math.max(maxV, Math.abs(v))
	maxOver = Math.max(maxOver, w.cx - 0.7)
	if (tReach === null && Math.abs(w.cx - 0.7) <= 0.01) { tReach = (i + 1) * DT / 1000 }
})
console.log({ amp, maxDv, maxV, tReach, maxOver })
assert(maxDv < 0.05, 'b: dv ' + maxDv)
assert(tReach !== null && tReach < 1.5, 'c: reach ' + tReach)
assert(maxOver <= 0.01, 'c: overshoot ' + maxOver)

const j = stepWindow({ cx: 0.5, cy: 0.5, zoom: 2 }, { cx: 0.9, cy: 0.5, zoom: 2 }, 200)
assert(Math.abs(j.cx - 0.5) <= MAX_SPEED * 0.1 + 1e-9, 'd: jump ' + (j.cx - 0.5))
console.log('ok')
