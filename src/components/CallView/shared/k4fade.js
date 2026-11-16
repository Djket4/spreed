/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ket4tec (NAS_CLOUD#271): камера на плитке включается и выключается плавно, за 1 с.
 * Вкл: видео проявляется поверх облака по первому целому (не чёрному и не обрезанному) кадру — без скачка и пустого поля.
 * Выкл: гаснет копия последнего настоящего кадра, под ней облако.
 * iOS Safari (запись владельца 16.11): любая перестройка слоя в момент перехода — смена position у обёртки, новый канвас
 * в DOM — давала 1–2 пустых кадра (белый/чёрный). Поэтому обёртка всё время в одном слое (k7call.scss, .k4-vf),
 * копия кадра — постоянный канвас поверх видео: на переходах меняется только opacity.
 */
import { onBeforeUnmount, reactive } from 'vue'

export const FADE_MS = 1000
// кадр так и не пришёл (или камера правда чёрная) — проявляем как есть. Больше, чем ожидание детекции
// плюс сторожок FaceFrame (1,5 + 2 с): при откате на исходную камеру плитка проявляется уже по её кадру
const WAIT_MS = 5000

/**
 * Целый кадр: не чёрный в середине и у каждого края. Первые кадры iOS бывают картинкой поменьше
 * посередине прозрачного поля (запись владельца 16.11) — такой кадр не проявляем и не храним.
 *
 * @param {HTMLVideoElement} v видео
 * @return {boolean}
 */
export function hasPicture(v) {
	try {
		const c = document.createElement('canvas')
		c.width = c.height = 8
		const x = c.getContext('2d')
		x.drawImage(v, 0, 0, 8, 8)
		const p = x.getImageData(0, 0, 8, 8).data
		const lit = (cx, cy) => p[(cy * 8 + cx) * 4] > 16 || p[(cy * 8 + cx) * 4 + 1] > 16 || p[(cy * 8 + cx) * 4 + 2] > 16
		const any = (f) => [0, 1, 2, 3, 4, 5, 6, 7].some(f)
		return (lit(3, 3) || lit(4, 4) || lit(3, 4) || lit(4, 3))
			&& any((i) => lit(i, 0)) && any((i) => lit(i, 7)) && any((i) => lit(0, i)) && any((i) => lit(7, i))
	} catch (e) {
		return true
	}
}

/**
 * @return {{state: {shown: boolean, opaque: boolean, full: boolean}, set: Function}} состояние плитки и переключатель
 */
export function useK4VideoFade() {
	// shown — обёртка видео на экране; opaque — непрозрачна; full — проявилась, облако под ней не нужно
	const state = reactive({ shown: false, opaque: false, full: false })
	let tok = 0
	let timer = 0
	// пока камера показана, раз в 300 мс копия кадра в постоянный канвас: к сигналу «выкл» трек уже подменён
	// и видео отдаёт чёрное 2×2 (замер на test2), снимать в этот момент поздно
	let keeper = 0
	const snap = document.createElement('canvas')
	snap.style.opacity = '0'
	let hasSnap = false
	const stopKeep = () => {
		clearInterval(keeper)
		keeper = 0
	}

	/**
	 * Копия текущего кадра в snap (до 480 px по ширине), канвас — сразу за видео. Так он уже на экране
	 * (прозрачный), когда понадобится: вставка в момент «выкл» и была пустым кадром в Safari.
	 *
	 * @param {HTMLVideoElement} v видео
	 * @return {boolean} кадр снят
	 */
	const keep = (v) => {
		if (!v) {
			return false
		}
		if (snap.previousElementSibling !== v) {
			v.after(snap)
		}
		snap.className = v.className + ' k4-vsnap'
		snap.style.transform = v.style.transform
		if (v.videoWidth < 16 || v.readyState < 2 || !hasPicture(v)) {
			return false
		}
		try {
			const k = Math.min(1, 480 / v.videoWidth)
			const w = Math.round(v.videoWidth * k)
			const h = Math.round(v.videoHeight * k)
			if (snap.width !== w || snap.height !== h) {
				snap.width = w
				snap.height = h
			}
			snap.getContext('2d').drawImage(v, 0, 0, w, h)
			hasSnap = true
			return true
		} catch (e) {
			return false
		}
	}

	const later = (t, fn) => {
		clearTimeout(timer)
		timer = setTimeout(() => t === tok && fn(), FADE_MS)
	}

	/**
	 * @param {boolean} on камера показана
	 * @param {() => HTMLVideoElement} getVideo
	 */
	function set(on, getVideo) {
		const t = ++tok
		clearTimeout(timer)
		if (!on) {
			if (!state.shown) {
				return
			}
			stopKeep()
			const v = getVideo()
			v?.pause()
			// гаснет последний настоящий кадр, а не чёрное
			keep(v)
			snap.style.opacity = hasSnap ? '1' : '0'
			state.opaque = false
			state.full = false
			later(t, () => {
				snap.style.opacity = '0'
				state.shown = false
				getVideo()?.play()?.catch(() => {})
			})
			return
		}
		snap.style.opacity = '0'
		hasSnap = false
		state.shown = true
		state.full = false
		state.opaque = false
		getVideo()?.play()?.catch(() => {})
		const t0 = performance.now()
		// новый кадр после включения: прошлый замерший кадр (или кадр до подмены трека) не в счёт
		let fresh = null
		const poll = () => {
			if (t !== tok) {
				return
			}
			const v = getVideo()
			if (v && fresh === null) {
				fresh = !v.requestVideoFrameCallback
				v.requestVideoFrameCallback?.(() => {
					fresh = true
				})
			}
			if ((fresh && v.readyState >= 2 && v.videoWidth && hasPicture(v)) || performance.now() - t0 > WAIT_MS) {
				state.opaque = true
				later(t, () => {
					state.full = true
				})
				stopKeep()
				keep(v)
				keeper = setInterval(() => keep(getVideo()), 300)
				return
			}
			timer = setTimeout(poll, 50)
		}
		poll()
	}

	onBeforeUnmount(() => {
		tok++
		clearTimeout(timer)
		stopKeep()
		snap.remove()
	})

	return { state, set }
}
