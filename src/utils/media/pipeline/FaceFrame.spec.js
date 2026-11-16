/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test, vi } from 'vitest'
import { computeTarget, stepWindow, TILES, tileToFrame } from './FaceFrame.js'

describe('FaceFrame logic', () => {
	test('нет лиц — нет цели', () => {
		expect(computeTarget([])).toBe(null)
	})
	test('рамка вокруг всех лиц, центр между ними', () => {
		const t = computeTarget([{ x: 0.1, y: 0.4, w: 0.05, h: 0.09 }, { x: 0.3, y: 0.4, w: 0.05, h: 0.09 }], 0.5)
		expect(t.cx).toBeCloseTo(0.225)
	})
	test('авто: далёкое лицо приближается, близкое остаётся 1×', () => {
		expect(computeTarget([{ x: 0.45, y: 0.4, w: 0.08, h: 0.14 }], 0.5).zoom).toBeGreaterThan(1.6)
		expect(computeTarget([{ x: 0.3, y: 0.1, w: 0.4, h: 0.7 }], 0.5).zoom).toBe(1)
	})
	test('NAS_CLOUD#232: «Дальность» — ближе крупнее, до потолка 3×', () => {
		const face = [{ x: 0.4, y: 0.3, w: 0.15, h: 0.2 }]
		const far = computeTarget(face, 0).zoom
		const mid = computeTarget(face, 0.5).zoom
		const near = computeTarget(face, 1).zoom
		expect(far).toBeLessThan(mid)
		expect(mid).toBeLessThan(near)
		expect(computeTarget([{ x: 0.45, y: 0.45, w: 0.05, h: 0.07 }], 1).zoom).toBe(3)
	})
	test('NAS_CLOUD#232: «Дальность» 0 — весь кадр, 1 — голова во весь квадрат, шаги заметные', () => {
		const face = [{ x: 0.42, y: 0.3, w: 0.14, h: 0.25 }] // крупное лицо, как с веб-камеры 1080p
		const z = [0, 0.25, 0.5, 0.75, 1].map((r) => computeTarget(face, r).zoom)
		expect(z[0]).toBe(1)
		expect(z[4]).toBeCloseTo(1 / (0.25 * 1.9))
		for (let i = 1; i < 5; i++) {
			expect(z[i] / z[i - 1]).toBeGreaterThan(1.15)
		}
	})
	test('мёртвая зона: малый сдвиг не двигает окно', () => {
		const s = { cx: 0.5, cy: 0.5, zoom: 2 }
		expect(stepWindow(s, { cx: 0.52, cy: 0.5, zoom: 2 }, 100).cx).toBe(0.5)
	})
	test('окно плавно идёт к цели и не выходит за кадр', () => {
		let s = { cx: 0.5, cy: 0.5, zoom: 2 }
		for (let i = 0; i < 200; i++) {
			s = stepWindow(s, { cx: 0.95, cy: 0.5, zoom: 2 }, 33)
		}
		expect(s.cx).toBeCloseTo(0.75, 1)
	})
	test('потеря лица: возврат к 1×', () => {
		let s = { cx: 0.7, cy: 0.5, zoom: 2 }
		for (let i = 0; i < 300; i++) {
			s = stepWindow(s, { cx: 0.5, cy: 0.5, zoom: 1 }, 33)
		}
		expect(s.zoom).toBeCloseTo(1, 1)
	})
	test('перевод координат плитки в кадр', () => {
		const f = tileToFrame({ x: 0.5, y: 0.5, w: 0.1, h: 0.2 }, { x: 0.4, y: 0, w: 0.6, h: 0.6 })
		expect(f.x).toBeCloseTo(0.7)
		expect(f.y).toBeCloseTo(0.3)
		expect(f.w).toBeCloseTo(0.06)
		expect(f.h).toBeCloseTo(0.12)
		TILES.forEach((t) => expect(t.x + t.w).toBeLessThanOrEqual(1.0001))
	})
})

// NAS_CLOUD#232 (ревью #45): старые сохранённые значения — «off» остаётся выключенным, остальные читаются как «вкл»
describe('FaceFrame: перенос сохранённого уровня', () => {
	test.each([['off', 'off'], ['auto', 'auto'], ['1', 'auto'], ['1.5', 'auto'], ['2', 'auto'], ['x1', 'auto'], ['x2', 'auto']])('%s -> %s', async (stored, expected) => {
		localStorage.setItem('k4FaceFrameLevel', stored)
		vi.resetModules()
		const { getFaceFrameLevel } = await import('./FaceFrame.js')
		expect(getFaceFrameLevel()).toBe(expected)
		localStorage.removeItem('k4FaceFrameLevel')
	})
})
