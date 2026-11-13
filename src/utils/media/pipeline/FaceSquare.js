/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// NAS_CLOUD#172: квадрат вырезается у отправителя (а не object-fit у получателей),
// чтобы сдвиг к лицу видели все участники и превью проверки устройств.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Окно {cx, cy, zoom} (доли кадра, zoom=1 — квадрат на всю короткую сторону) -> квадрат в пикселях кадра.
 *
 * @param {{cx: number, cy: number, zoom: number}} win окно
 * @param {number} W ширина кадра
 * @param {number} H высота кадра
 */
export function squareRect(win, W, H) {
	const side = Math.min(W, H) / Math.max(1, win.zoom || 1)
	return {
		sx: clamp(win.cx * W - side / 2, 0, W - side),
		sy: clamp(win.cy * H - side / 2, 0, H - side),
		side,
	}
}

/**
 * Цель, прижатая так, чтобы квадрат не вылезал за кадр: пружина не копит «недоход» за краем.
 *
 * @param {{cx: number, cy: number, zoom: number}} t цель
 * @param {number} W ширина кадра
 * @param {number} H высота кадра
 */
export function clampTarget(t, W, H) {
	const side = Math.min(W, H) / Math.max(1, t.zoom || 1)
	const hx = side / 2 / W
	const hy = side / 2 / H
	return { ...t, cx: clamp(t.cx, hx, 1 - hx), cy: clamp(t.cy, hy, 1 - hy) }
}
