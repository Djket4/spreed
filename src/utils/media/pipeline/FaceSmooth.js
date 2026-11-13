/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Плавное движение окна кадра: сглаживание цели -> критически демпфированная пружина
// с ограничением скорости и мёртвой зоной с гистерезисом. Чистая логика, без зависимостей.
export const TARGET_TAU_MS = 250 // сглаживание шума детектора в цели
export const SPRING_OMEGA = 6 // рад/с, критическое демпфирование (установка ~1 с)
export const MAX_SPEED = 0.6 // центр окна, доля кадра в секунду
export const MAX_ZOOM_SPEED = 1.0 // приближение, единиц зума в секунду
export const DEAD_CENTER = 0.045 // старт движения при отклонении больше; стоп при DEAD/4
export const DEAD_ZOOM = 0.05 // то же, доля текущего зума
export const MAX_DT_MS = 100
const SUBSTEP_MS = 16

// одна ось: пружина к goal, скорость ограничена vmax
/**
 *
 * @param x
 * @param v
 * @param goal
 * @param vmax
 * @param dt
 */
function spring(x, v, goal, vmax, dt) {
	const a = SPRING_OMEGA * SPRING_OMEGA * (goal - x) - 2 * SPRING_OMEGA * v
	v = Math.max(-vmax, Math.min(vmax, v + a * dt))
	return [x + v * dt, v]
}

/**
 * Один шаг. Состояние несёт скорости (v*), флаги движения (m*) и сглаженную цель (t*).
 *
 * @param {object} state текущее окно {cx, cy, zoom} (+ служебные поля прошлых шагов)
 * @param {{cx: number, cy: number, zoom: number}} target сырая цель
 * @param {number} dtMs время с прошлого шага, ограничено MAX_DT_MS
 */
export function stepWindow(state, target, dtMs) {
	const dt = Math.min(Math.max(dtMs, 0), MAX_DT_MS)
	const s = { vcx: 0, vcy: 0, vzoom: 0, mcx: false, mcy: false, mzoom: false, ...state }
	const k = 1 - Math.exp(-dt / TARGET_TAU_MS)
	for (const key of ['cx', 'cy', 'zoom']) {
		const prev = s['t' + key] ?? target[key]
		s['t' + key] = prev + (target[key] - prev) * k
	}
	// гистерезис: старт > dead, стоп < dead/4; сброс на 1× двигает всегда
	const axes = [['cx', DEAD_CENTER, MAX_SPEED], ['cy', DEAD_CENTER, MAX_SPEED], ['zoom', DEAD_ZOOM, MAX_ZOOM_SPEED]]
	for (const [key, dead, vmax] of axes) {
		const err = Math.abs(s['t' + key] - s[key]) / (key === 'zoom' ? s.zoom : 1)
		const m = 'm' + key
		s[m] = err > dead || (s[m] && err > dead / 4) || (key === 'zoom' && target.zoom === 1 && s.zoom > 1.001)
		const v = 'v' + key
		// в покое цель пружины = текущая позиция: скорость плавно гаснет
		for (let left = dt; left > 0; left -= SUBSTEP_MS) {
			const h = Math.min(left, SUBSTEP_MS) / 1000
			;[s[key], s[v]] = spring(s[key], s[v], s[m] ? s['t' + key] : s[key], vmax, h)
		}
	}
	s.zoom = Math.max(1, s.zoom)
	// окно не выходит за кадр
	const half = 0.5 / s.zoom
	for (const key of ['cx', 'cy']) {
		const c = Math.min(1 - half, Math.max(half, s[key]))
		if (c !== s[key]) {
			s['v' + key] = 0
		}
		s[key] = c
	}
	return s
}
