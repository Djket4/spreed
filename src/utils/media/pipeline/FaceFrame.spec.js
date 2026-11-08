/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'vitest'
import { computeTarget, stepWindow } from './FaceFrame.js'

describe('FaceFrame logic', () => {
	test('нет лиц — нет цели', () => {
		expect(computeTarget([], 'auto')).toBe(null)
	})
	test('рамка вокруг всех лиц, центр между ними', () => {
		const t = computeTarget([{ x: 0.1, y: 0.4, w: 0.05, h: 0.09 }, { x: 0.3, y: 0.4, w: 0.05, h: 0.09 }], '2')
		expect(t.cx).toBeCloseTo(0.225)
		expect(t.zoom).toBe(2)
	})
	test('авто: далёкое лицо приближается, близкое остаётся 1×', () => {
		expect(computeTarget([{ x: 0.45, y: 0.4, w: 0.08, h: 0.14 }], 'auto').zoom).toBeGreaterThan(1.8)
		expect(computeTarget([{ x: 0.3, y: 0.1, w: 0.4, h: 0.7 }], 'auto').zoom).toBe(1)
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
})
