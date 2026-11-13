/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'vitest'
import { computeTarget } from './FaceFrame.js'
import { stepWindow } from './FaceSmooth.js'
import { centerZoom, clampTarget, squareRect } from './FaceSquare.js'

const W = 1280
const H = 720
const face = (cx, cy = 0.45, w = 0.12) => ({ x: cx - w / 2, y: cy - w / 2, w, h: w })
function center(faces) {
	const t = clampTarget(computeTarget(faces, '1'), W, H)
	const r = squareRect(t, W, H)
	return { t, r, faceX: (r.sx + r.side / 2) / W }
}

describe('вырез квадрата по лицу (zoom 1)', () => {
	test('лицо в левой трети: центр квадрата уходит к лицу', () => {
		const { r, t } = center([face(0.3)])
		expect(t.zoom).toBe(1)
		expect(r.side).toBe(H)
		const facePxInSquare = (0.3 * W - r.sx) / r.side
		expect(facePxInSquare).toBeGreaterThan(0.45) // голова около середины плитки
		expect(facePxInSquare).toBeLessThan(0.55)
		// совсем у края (0.2) — максимум, что даёт кадр 16:9: лицо внутри плитки, а не за её краем
		const { r: edge } = center([face(0.2)])
		expect((0.2 * W - edge.sx) / edge.side).toBeGreaterThan(0.3)
	})
	test('лицо в правой трети: симметрично', () => {
		const facePxInSquare = (() => { const { r } = center([face(0.7)]); return (0.7 * W - r.sx) / r.side })()
		expect(facePxInSquare).toBeGreaterThan(0.45)
		expect(facePxInSquare).toBeLessThan(0.55)
	})
	test('лицо по центру: квадрат из середины', () => {
		expect(squareRect(clampTarget(computeTarget([face(0.5)], '1'), W, H), W, H).sx).toBeCloseTo((W - H) / 2)
	})
	test('лица нет: нет цели, окно остаётся в центре', () => {
		expect(computeTarget([], '1')).toBeNull()
		expect(squareRect({ cx: 0.5, cy: 0.5, zoom: 1 }, W, H).sx).toBeCloseTo((W - H) / 2)
	})
	test('лицо у самого края: квадрат не выходит за кадр', () => {
		for (const x of [0.01, 0.99]) {
			const { r } = center([face(x)])
			expect(r.sx).toBeGreaterThanOrEqual(0)
			expect(r.sx + r.side).toBeLessThanOrEqual(W)
		}
	})
	test('вертикальный кадр телефона: сдвиг по высоте в пределах кадра', () => {
		const r = squareRect(clampTarget(computeTarget([face(0.5, 0.2, 0.2)], '1'), 720, 1280), 720, 1280)
		expect(r.sx).toBe(0)
		expect(r.sy).toBeGreaterThanOrEqual(0)
		expect(r.sy + r.side).toBeLessThanOrEqual(1280)
		expect(r.sy).toBeLessThan(200) // лицо в верхней части, квадрат поднялся
	})
	test('несколько лиц: общий центр', () => {
		const t = computeTarget([face(0.2), face(0.6)], '1')
		expect(t.cx).toBeCloseTo(0.4)
	})
	test('сглаживание: скачок цели не даёт рывка, шаг не больше лимита скорости', () => {
		let win = { cx: 0.5, cy: 0.5, zoom: 1 }
		const target = clampTarget(computeTarget([face(0.2)], '1'), W, H)
		let prev = win.cx
		let maxStep = 0
		for (let i = 0; i < 400; i++) {
			win = stepWindow(win, target, 16, { W, H })
			maxStep = Math.max(maxStep, Math.abs(win.cx - prev))
			prev = win.cx
		}
		expect(maxStep).toBeLessThan(0.6 * 0.016 + 1e-6)
		expect(Math.abs(win.cx - target.cx)).toBeLessThan(0.05) // дошли в пределах мёртвой зоны
	})
	test('дрожание детектора в мёртвой зоне не двигает окно', () => {
		let win = { cx: 0.5, cy: 0.5, zoom: 1 }
		const xs = []
		for (let i = 0; i < 200; i++) {
			win = stepWindow(win, { cx: 0.5 + (i % 2 ? 0.02 : -0.02), cy: 0.5, zoom: 1 }, 16, { W, H })
			xs.push(win.cx)
		}
		expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.01)
	})
})

describe('одно лицо у края: квадрат сужается, лицо встаёт в центр', () => {
	const place = (fx, fy = 0.5) => {
		const t = { cx: fx, cy: fy, zoom: centerZoom({ cx: fx, cy: fy }, W, H) }
		const r = squareRect(clampTarget(t, W, H), W, H)
		return { z: t.zoom, pos: (fx * W - r.sx) / r.side }
	}
	test('лицо на 20%: приближение ~1.4×, лицо в центре', () => {
		const { z, pos } = place(0.2)
		expect(z).toBeCloseTo(1.406, 2)
		expect(pos).toBeCloseTo(0.5, 2)
	})
	test('лицо на 10%: упор в 1.5× и остаточное смещение', () => {
		const { z, pos } = place(0.1)
		expect(z).toBe(1.5)
		expect(pos).toBeLessThan(0.45)
		expect(pos).toBeGreaterThan(0.2)
	})
	test('лицо по центру: приближения нет', () => {
		expect(place(0.5).z).toBe(1)
	})
	test('лицо у верхнего края: то же по вертикали', () => {
		expect(centerZoom({ cx: 0.5, cy: 0.4 }, W, H)).toBeCloseTo(1 / 0.8, 2)
		expect(centerZoom({ cx: 0.5, cy: 0.05 }, W, H)).toBe(1.5)
	})
})

describe('этап 2: два лица -> 2:1', () => {
	const f = (x) => ({ x, w: 0.12 })
	test('лица по краям не помещаются в квадрат, рядом — помещаются, одно и три — нет', async () => {
		const { wantSplit } = await import('./FaceSquare.js')
		expect(wantSplit([f(0.14), f(0.74)], W, H)).toBe(true)
		expect(wantSplit([f(0.40), f(0.50)], W, H)).toBe(false)
		expect(wantSplit([f(0.5)], W, H)).toBe(false)
		expect(wantSplit([f(0.1), f(0.5), f(0.8)], W, H)).toBe(false)
	})
	test('гистерезис 1.5 с в обе стороны, мимо идущий не переключает', async () => {
		const { holdSplit, isTwoSquares } = await import('./FaceSquare.js')
		let st = { on: false, flipAt: 0 }
		st = holdSplit(st, true, 1000)
		expect(st.on).toBe(false)
		st = holdSplit(st, true, 2400)
		expect(st.on).toBe(false)
		st = holdSplit(st, true, 2600)
		expect(st.on).toBe(true)
		st = holdSplit(st, false, 3000) // вышел на секунду
		st = holdSplit(st, true, 3800) // вернулся: таймер сброшен
		expect(st).toEqual({ on: true, flipAt: 0 })
		st = holdSplit(st, false, 4000)
		st = holdSplit(st, false, 5600)
		expect(st.on).toBe(false)
		expect(isTwoSquares(720, 360)).toBe(true)
		expect(isTwoSquares(1280, 720)).toBe(false)
		expect(isTwoSquares(360, 360)).toBe(false)
	})

	test('splitTargets: второе лицо ушло — оба квадрата идут к оставшемуся, без пустых кадров', async () => {
		const { splitTargets } = await import('./FaceSquare.js')
		const L = { cx: 0.2, cy: 0.5, zoom: 1 }
		const R = { cx: 0.8, cy: 0.5, zoom: 1 }
		const one = { cx: 0.5, cy: 0.5, zoom: 1 }
		expect(splitTargets(true, [L, R], undefined, one)).toEqual([L, R])
		expect(splitTargets(false, undefined, [L, R], one)).toEqual([one, one])
		expect(splitTargets(false, undefined, [L, R], null)).toEqual([L, R])
	})
})
