/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FaceDetector } from '@mediapipe/tasks-vision'
import { getWasmFileset } from '../effects/virtual-background/VideoStreamBackgroundEffect.js'
import TrackSinkSource from './TrackSinkSource.js'

const STORAGE_KEY = 'k4FaceFrameLevel'
export const LEVELS = ['auto', '1', '1.5', '2']
export const LEVEL_LABELS = { auto: 'Авто', 1: '1×', 1.5: '1,5×', 2: '2×' }

const DETECT_INTERVAL_MS = 150 // ~6-7 раз/с
const LOST_AFTER_MS = 2000
const TAU_MS = 400 // постоянная экспоненциального сглаживания
const DEAD_CENTER = 0.03 // мёртвая зона сдвига окна, доля ширины кадра
const DEAD_ZOOM = 0.06 // мёртвая зона приближения, доля
const AUTO_MAX_ZOOM = 2.5
const AUTO_FACE_SPAN = 2.6 // ширина окна = ширина рамки лиц * это

let level = '1'
try {
	const stored = localStorage.getItem(STORAGE_KEY)
	if (LEVELS.includes(stored)) {
		level = stored
	}
} catch (e) { /* localStorage недоступен */ }
const levelEvents = new EventTarget()

/** @return {string} текущий уровень */
export function getFaceFrameLevel() {
	return level
}

/**
 * @param {string} newLevel новый уровень (сохраняется в localStorage)
 */
export function setFaceFrameLevel(newLevel) {
	if (!LEVELS.includes(newLevel) || newLevel === level) {
		return
	}
	level = newLevel
	try {
		localStorage.setItem(STORAGE_KEY, level)
	} catch (e) { /* localStorage недоступен */ }
	levelEvents.dispatchEvent(new Event('change'))
}

/**
 * @param {Function} handler обработчик смены уровня
 * @return {Function} отписка
 */
export function onFaceFrameLevelChange(handler) {
	levelEvents.addEventListener('change', handler)
	return () => levelEvents.removeEventListener('change', handler)
}

/**
 * Целевое окно (центр в долях кадра и приближение) по рамкам лиц.
 *
 * @param {Array<{x: number, y: number, w: number, h: number}>} faces рамки в долях кадра (0..1)
 * @param {string} lvl уровень
 */
export function computeTarget(faces, lvl) {
	if (!faces.length) {
		return null
	}
	const x1 = Math.min(...faces.map((f) => f.x))
	const y1 = Math.min(...faces.map((f) => f.y))
	const x2 = Math.max(...faces.map((f) => f.x + f.w))
	const y2 = Math.max(...faces.map((f) => f.y + f.h))
	let zoom
	if (lvl === 'auto') {
		// окно должно вместить рамку по ширине и по высоте (с запасом)
		const needW = (x2 - x1) * AUTO_FACE_SPAN
		const needH = (y2 - y1) * AUTO_FACE_SPAN
		zoom = 1 / Math.max(needW, needH, 1 / AUTO_MAX_ZOOM)
	} else {
		zoom = parseFloat(lvl)
	}
	return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, zoom: Math.max(1, zoom) }
}

/**
 * Один шаг сглаживания окна к цели. Возвращает новое состояние.
 *
 * @param {{cx: number, cy: number, zoom: number}} state текущее окно
 * @param {{cx: number, cy: number, zoom: number}} target цель
 * @param {number} dtMs время с прошлого шага
 */
export function stepWindow(state, target, dtMs) {
	const a = 1 - Math.exp(-dtMs / TAU_MS)
	const next = { ...state }
	if (Math.abs(target.cx - state.cx) > DEAD_CENTER) {
		next.cx += (target.cx - state.cx) * a
	}
	if (Math.abs(target.cy - state.cy) > DEAD_CENTER) {
		next.cy += (target.cy - state.cy) * a
	}
	if (Math.abs(target.zoom - state.zoom) / state.zoom > DEAD_ZOOM || target.zoom === 1) {
		next.zoom += (target.zoom - state.zoom) * a
	}
	// окно не выходит за кадр
	const half = 0.5 / next.zoom
	next.cx = Math.min(1 - half, Math.max(half, next.cx))
	next.cy = Math.min(1 - half, Math.max(half, next.cy))
	return next
}

let detectorPromise = null
/** @return {Promise<FaceDetector>} общий детектор */
function getDetector() {
	if (!detectorPromise) {
		detectorPromise = (async () => {
			const fileset = await getWasmFileset()
			return FaceDetector.createFromOptions(fileset, {
				baseOptions: {
					modelAssetPath: new URL('../effects/virtual-background/vendor/models/blaze_face_short_range.tflite', import.meta.url).pathname,
				},
				runningMode: 'VIDEO',
			})
		})()
		detectorPromise.catch(() => {
			detectorPromise = null
		})
	}
	return detectorPromise
}

/**
 * Узел: «кадр по лицу». Уровень берётся из общей настройки (getFaceFrameLevel).
 *
 * Путь 2 (аппаратный zoom) для 1,5×/2×, если камера поддерживает и значение
 * применилось; иначе путь 1 (цифровое окно с ведением за лицом). "Авто" и 1×
 * всегда идут цифровым путём/в обход. Какой путь сработал: свойство "path"
 * ('off' | 'hardware' | 'digital').
 *
 *        -----------
 *  ---> | FaceFrame | --->
 *        -----------
 */
export default class FaceFrame extends TrackSinkSource {
	constructor() {
		super()

		this._addInputTrackSlot()
		this._addOutputTrackSlot()

		this.path = 'off'
		this._hwZoomed = false
		this._applyToken = 0
		this._outputTrack = null
		this._unsubscribe = onFaceFrameLevelChange(() => this._apply())
	}

	_handleInputTrack(trackId, newTrack) {
		this._apply()
	}

	_handleInputTrackEnabled(trackId, enabled) {
		if (!enabled) {
			this._stopDigital()
			this._setOutputTrack('default', this.getInputTrack())
			this.path = 'off'
			return
		}
		this._apply()
	}

	async _apply() {
		const token = ++this._applyToken
		const input = this.getInputTrack()
		const lvl = getFaceFrameLevel()

		if (!input || !input.enabled || lvl === '1') {
			this._stopDigital()
			this.path = 'off'
			if (input && this._hwZoomed) {
				this._hwZoomed = false
				await this._setHardwareZoom(input, 1)
			}
			if (token === this._applyToken) {
				this._setOutputTrack('default', input)
			}
			return
		}

		if (lvl !== 'auto' && await this._tryHardware(input, parseFloat(lvl))) {
			if (token !== this._applyToken) {
				return
			}
			this._stopDigital()
			this.path = 'hardware'
			this._setOutputTrack('default', input)
			return
		}
		if (token !== this._applyToken) {
			return
		}

		if (this._hwZoomed) {
			this._hwZoomed = false
			await this._setHardwareZoom(input, 1)
		}
		this.path = 'digital'
		this._startDigital(input)
	}

	async _setHardwareZoom(track, zoom) {
		try {
			const caps = track.getCapabilities?.()
			if (!caps?.zoom) {
				return false
			}
			const value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zoom))
			await track.applyConstraints({ advanced: [{ zoom: value }] })
			const applied = track.getSettings().zoom
			return applied !== undefined && Math.abs(applied - value) < 0.05
		} catch (e) {
			return false
		}
	}

	async _tryHardware(track, zoom) {
		const ok = await this._setHardwareZoom(track, zoom)
		this._hwZoomed = ok || this._hwZoomed
		return ok
	}

	_startDigital(input) {
		if (this._digital && this._digital.input === input) {
			return // уровень читается покадрово
		}
		this._stopDigital()

		const video = document.createElement('video')
		video.muted = true
		video.playsInline = true
		video.srcObject = new MediaStream([input])
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d')
		const d = {
			input,
			video,
			canvas,
			ctx,
			win: { cx: 0.5, cy: 0.5, zoom: 1 },
			target: { cx: 0.5, cy: 0.5, zoom: 1 },
			lastFace: 0,
			lastDetect: 0,
			lastTick: 0,
			stopped: false,
			detector: null,
		}
		this._digital = d
		video.play().catch(() => {})
		getDetector().then((detector) => {
			d.detector = detector
		}).catch((e) => console.error('FaceFrame: детектор не загрузился', e))

		const tick = (now) => {
			if (d.stopped) {
				return
			}
			this._renderFrame(d, now || performance.now())
			schedule()
		}
		const schedule = () => {
			if (video.requestVideoFrameCallback) {
				video.requestVideoFrameCallback((now) => tick(now))
			} else {
				d.timer = setTimeout(() => tick(performance.now()), 33)
			}
		}
		d.schedule = schedule

		// выход создаём, когда известен размер кадра
		video.addEventListener('loadedmetadata', () => {
			if (d.stopped) {
				return
			}
			canvas.width = video.videoWidth
			canvas.height = video.videoHeight
			d.stream = canvas.captureStream()
			d.output = d.stream.getVideoTracks()[0]
			this._setOutputTrack('default', d.output)
			schedule()
		}, { once: true })
	}

	_renderFrame(d, now) {
		const { video, canvas, ctx } = d
		if (!video.videoWidth) {
			return
		}
		if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
			canvas.width = video.videoWidth
			canvas.height = video.videoHeight
		}
		const lvl = getFaceFrameLevel()

		if (d.detector && now - d.lastDetect >= DETECT_INTERVAL_MS) {
			d.lastDetect = now
			try {
				const res = d.detector.detectForVideo(video, now)
				const faces = res.detections
					.filter((x) => x.boundingBox)
					.map((x) => ({
						x: x.boundingBox.originX / canvas.width,
						y: x.boundingBox.originY / canvas.height,
						w: x.boundingBox.width / canvas.width,
						h: x.boundingBox.height / canvas.height,
					}))
				const target = computeTarget(faces, lvl)
				if (target) {
					d.target = target
					d.lastFace = now
				}
			} catch (e) { /* пропускаем кадр детекции */ }
		}
		if (now - d.lastFace > LOST_AFTER_MS) {
			d.target = { cx: 0.5, cy: 0.5, zoom: 1 }
		} else if (lvl !== 'auto') {
			d.target.zoom = parseFloat(lvl)
		}

		const dt = d.lastTick ? Math.min(now - d.lastTick, 200) : 0
		d.lastTick = now
		d.win = stepWindow(d.win, d.target, dt)
		this.window = d.win

		const sw = canvas.width / d.win.zoom
		const sh = canvas.height / d.win.zoom
		ctx.drawImage(video, d.win.cx * canvas.width - sw / 2, d.win.cy * canvas.height - sh / 2, sw, sh, 0, 0, canvas.width, canvas.height)
	}

	_stopDigital() {
		const d = this._digital
		if (!d) {
			return
		}
		d.stopped = true
		clearTimeout(d.timer)
		d.video.srcObject = null
		if (d.output) {
			this._disableRemoveTrackWhenEnded(d.output)
			d.output.stop()
		}
		this._digital = null
	}

	destroy() {
		this._unsubscribe()
		this._stopDigital()
		this._applyToken++
		if (this._hwZoomed && this.getInputTrack()) {
			this._setHardwareZoom(this.getInputTrack(), 1)
		}
	}
}
