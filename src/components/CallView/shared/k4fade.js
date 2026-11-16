/**
 * ket4tec (NAS_CLOUD#271): камера на плитке включается и выключается плавно, за 1 с.
 * Вкл: видео проявляется поверх облака по первому настоящему (не чёрному) кадру — без скачка и пустого поля.
 * Выкл: гаснет копия последнего настоящего кадра, под ней облако.
 */
import { onBeforeUnmount, reactive } from 'vue'

export const FADE_MS = 1000
const WAIT_MS = 3000 // кадр так и не пришёл (или камера правда чёрная) — проявляем как есть

// хоть один пиксель 8×8 не чёрный
function hasPicture(v) {
	try {
		const c = document.createElement('canvas')
		c.width = c.height = 8
		const x = c.getContext('2d')
		x.drawImage(v, 0, 0, 8, 8)
		return x.getImageData(0, 0, 8, 8).data.some((b, i) => i % 4 !== 3 && b > 16)
	} catch (e) {
		return true
	}
}

// копия текущего кадра (до 480 px по ширине); null — кадра нет или он чёрный
function grab(v) {
	if (v.videoWidth < 16 || v.readyState < 2 || !hasPicture(v)) {
		return null
	}
	try {
		const k = Math.min(1, 480 / v.videoWidth)
		const c = document.createElement('canvas')
		c.width = Math.round(v.videoWidth * k)
		c.height = Math.round(v.videoHeight * k)
		c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
		return c
	} catch (e) {
		return null
	}
}

export function useK4VideoFade() {
	// shown — обёртка видео на экране; opaque — непрозрачна; full — проявилась, облако под ней не нужно
	const state = reactive({ shown: false, opaque: false, full: false })
	let tok = 0
	let timer = 0
	// пока камера показана, раз в 300 мс держим копию кадра: к сигналу «выкл» трек уже подменён
	// и видео отдаёт чёрное 2×2 (замер на test2), снимать в этот момент поздно
	let keeper = 0
	let last = null
	const stopKeep = () => {
		clearInterval(keeper)
		keeper = 0
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
			const snap = (v && grab(v)) || last
			last = null
			if (snap && v) {
				snap.className = v.className + ' k4-vsnap'
				snap.style.transform = v.style.transform
				v.after(snap)
			}
			state.opaque = false
			state.full = false
			later(t, () => {
				snap?.remove()
				state.shown = false
				getVideo()?.play()?.catch(() => {})
			})
			return
		}
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
				keeper = setInterval(() => {
					const g = getVideo() && grab(getVideo())
					if (g) {
						last = g
					}
				}, 300)
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
	})

	return { state, set }
}
