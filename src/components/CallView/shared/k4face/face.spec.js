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
		// «выкл» — гаснет без скачка (шаг меняется не больше чем на 6% полного хода), за 1,2 с встаёт совсем
		for (let i = 40; i < 80; i++) {
			expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9)
			expect(steps[i - 1] - steps[i]).toBeLessThan(full * 0.06)
		}
		expect(steps[40]).toBeGreaterThan(full * 0.95) // первый кадр после «выкл» почти полный — не обрыв
		expect(steps[70]).toBeLessThan(1e-9) // 1,2 с — стоит
		// «вкл» — разгон с нуля, без скачка (#172: экспонента давала ~60% в первый кадр), за 1,2 с — полный ход
		expect(steps[80]).toBeLessThan(full * 0.05)
		for (let i = 81; i < 120; i++) {
			expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] - 1e-9)
			expect(steps[i] - steps[i - 1]).toBeLessThan(full * 0.06)
		}
		expect(steps[110]).toBeCloseTo(full, 6)
		// разгон — зеркало остановки
		for (let k = 0; k < 29; k++) {
			expect(steps[40 + k]).toBeCloseTo(steps[80 + 28 - k], 6)
		}
	})
})
