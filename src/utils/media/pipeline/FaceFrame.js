/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FaceDetector } from '@mediapipe/tasks-vision'
import { getWasmFileset } from '../effects/virtual-background/VideoStreamBackgroundEffect.js'
import { stepWindow } from './FaceSmooth.js'
import TrackSinkSource from './TrackSinkSource.js'

const STORAGE_KEY = 'k4FaceFrameLevel'
export const LEVELS = ['off', 'auto', '1', '1.5', '2']
export const LEVEL_LABELS = { off: 'Выкл', auto: 'Авто', 1: '1×', 1.5: '1,5×', 2: '2×' }

const DETECT_INTERVAL_MS = 150 // ~6-7 раз/с
const LOST_AFTER_MS = 2000
const AUTO_MAX_ZOOM = 2.5
const AUTO_FACE_SPAN = 2.6 // ширина окна = ширина рамки лиц * это

let level = 'off'
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

export { stepWindow }

// Резервный проход для далёких лиц: если в полном кадре лиц нет, по очереди
// (одна плитка за детекцию) прогоняется центр, 4 угловых плитки 60% и сетка 3×3 по 40% с перекрытием.
export const TILES = [
	{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
	{ x: 0, y: 0, w: 0.6, h: 0.6 },
	{ x: 0.4, y: 0, w: 0.6, h: 0.6 },
	{ x: 0, y: 0.4, w: 0.6, h: 0.6 },
	{ x: 0.4, y: 0.4, w: 0.6, h: 0.6 },
	// мелкие плитки 3×3 (40%, шаг 30%) для совсем далёких лиц (~4% ширины)
	...[0.3, 0, 0.6].flatMap((y) => [0.3, 0, 0.6].map((x) => ({ x, y, w: 0.4, h: 0.4 }))),
]

/**
 * Перевод рамки из долей плитки в доли целого кадра.
 *
 * @param {{x: number, y: number, w: number, h: number}} box рамка в долях плитки
 * @param {{x: number, y: number, w: number, h: number}} tile плитка в долях кадра
 */
export function tileToFrame(box, tile) {
	return {
		x: tile.x + box.x * tile.w,
		y: tile.y + box.y * tile.h,
		w: box.w * tile.w,
		h: box.h * tile.h,
	}
}

// детектор общий для всех узлов (звонок и превью), а метки времени VIDEO-режима
// обязаны строго расти — иначе detectForVideo бросает исключение
let lastTs = 0
const nextTs = (now) => (lastTs = Math.max(lastTs + 1, Math.round(now)))

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

		// для проверки в живом звонке: window.__k4ff[i].path / .window
		;(window.__k4ff ||= []).push(this)
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
			this._setOutput(this.getInputTrack())
			this.path = 'off'
			return
		}
		this._apply()
	}

	// Повторная установка того же трека заставляет VirtualBackground перезапустить
	// эффект (как при смене constraints) и ломает видео, поэтому дубли пропускаем.
	_setOutput(track) {
		if (this.getOutputTrack() !== track) {
			this._setOutputTrack('default', track)
		}
	}

	async _apply() {
		const token = ++this._applyToken
		const input = this.getInputTrack()
		const lvl = getFaceFrameLevel()

		if (!input || !input.enabled || lvl === 'off') {
			this._stopDigital()
			this.path = 'off'
			if (input && this._hwZoomed) {
				this._hwZoomed = false
				await this._setHardwareZoom(input, 1)
			}
			if (token === this._applyToken) {
				this._setOutput(input)
			}
			return
		}

		if (lvl !== 'auto' && await this._tryHardware(input, parseFloat(lvl))) {
			if (token !== this._applyToken) {
				return
			}
			this._stopDigital()
			this.path = 'hardware'
			this._setOutput(input)
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
			tileIdx: 0,
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
				const toBoxes = (res, W, H) => res.detections
					.filter((x) => x.boundingBox)
					.map((x) => ({
						x: x.boundingBox.originX / W,
						y: x.boundingBox.originY / H,
						w: x.boundingBox.width / W,
						h: x.boundingBox.height / H,
					}))
				let faces = toBoxes(d.detector.detectForVideo(video, nextTs(now)), canvas.width, canvas.height)
				if (!faces.length) {
					// плитка апскейлится до размера кадра: далёкое лицо становится крупнее
					const tile = TILES[d.tileIdx++ % TILES.length]
					const tc = d.tileCanvas ||= document.createElement('canvas')
					tc.width = canvas.width
					tc.height = canvas.height
					tc.getContext('2d').drawImage(video, tile.x * canvas.width, tile.y * canvas.height, tile.w * canvas.width, tile.h * canvas.height, 0, 0, tc.width, tc.height)
					faces = toBoxes(d.detector.detectForVideo(tc, nextTs(now)), tc.width, tc.height).map((b) => tileToFrame(b, tile))
				}
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

		const dt = d.lastTick ? Math.min(now - d.lastTick, 100) : 0
		d.lastTick = now
		d.win = stepWindow(d.win, d.target, dt)
		this.window = d.win

		const sw = canvas.width / d.win.zoom
		const sh = canvas.height / d.win.zoom
		ctx.drawImage(video, d.win.cx * canvas.width - sw / 2, d.win.cy * canvas.height - sh / 2, sw, sh, 0, 0, canvas.width, canvas.height)

		// пока канвас пуст, на выходе остаётся исходный трек (картинка как в стоке, без серого);
		// на канвасный трек переключаемся после первой отрисовки
		if (!d.output) {
			d.output = canvas.captureStream().getVideoTracks()[0]
			this._setOutput(d.output)
		}
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
			// останавливаем уже после того, как получатели переключились на новый
			// трек: иначе VirtualBackground, получив вместо остановленного трека
			// исходный, теряет видео
			setTimeout(() => d.output.stop(), 500)
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
