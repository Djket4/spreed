/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest'
import { draw, face, join } from './face.js'

// холст-заглушка: любой метод — пустая функция, градиенты — с addColorStop
const ctx = new Proxy({}, {
	get: (o, k) => k in o ? o[k] : () => ({ addColorStop() {} }),
	set: (o, k, v) => {
		o[k] = v
		return true
	},
})

describe('face.js: вращение при переключении микрофона (NAS_CLOUD#271)', () => {
	it('ход вращения не скачет и плавно гаснет/разгоняется от текущего', () => {
		join('a/b')
		const f = face('a/b')
		const steps = []
		let on = true
		for (let i = 0; i < 120; i++) {
			if (i === 40) {
				on = false
			}
			if (i === 80) {
				on = true
			}
			const mt = f.mt
			draw(ctx, 200, 200, f, null, on, 1 / 25)
			steps.push(f.mt - mt)
		}
		const full = 1 / 25
		expect(steps[39]).toBeCloseTo(full, 6) // крутится в полную силу
		// после «выкл» ход убывает без скачка: каждый шаг не больше прошлого и не меньше его 80%
		for (let i = 40; i < 80; i++) {
			expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9)
			expect(steps[i]).toBeGreaterThan(steps[i - 1] * 0.8)
		}
		expect(steps[79]).toBeLessThan(full * 0.05) // к 1,6 с почти стоит
		expect(steps[65]).toBeLessThan(full * 0.1) // за ~1 с почти встал
		// «вкл» — разгон от текущего, тоже без скачка
		for (let i = 80; i < 120; i++) {
			expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] - 1e-9)
			expect(steps[i] - steps[i - 1]).toBeLessThan(full * 0.17)
		}
	})
})
