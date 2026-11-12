/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FaceDetector } from '@mediapipe/tasks-vision'
import { showWarning } from '@nextcloud/dialogs'
import { calllog } from '../../calllog.js'
import { getWasmFileset } from '../effects/virtual-background/VideoStreamBackgroundEffect.js'
import { stepWindow } from './FaceSmooth.js'
import TrackSinkSource from './TrackSinkSource.js'

const STORAGE_KEY = 'k4FaceFrameLevel'
export const LEVELS = ['off', 'auto', '1', '1.5', '2']
export const LEVEL_LABELS = { off: 'Выкл', auto: 'Авто', 1: '1×', 1.5: '1,5×', 2: '2×' }

const DETECT_INTERVAL_MS = 125 // не чаще 8 раз/с
const TILE_INTERVAL_MS = 500 // плитки (лица нет) не чаще 2 раз/с
const SLOW_DETECT_MS = 25 // дольше — следующая детекция откладывается
const RVFC_WAIT_MS = 300 // нет первого rVFC -> requestAnimationFrame
const MIN_FRAMES = 3 // кадров канваса до переключения выхода
const NO_FRAMES_MS = 2000
const MIN_FPS = 15
const LOW_FPS_MS = 2000
const STATS_LOG_MS = 5000
const LOST_AFTER_MS = 2000
// Подстройка «Авто» (рамка детектора — лоб..подбородок, без макушки и шеи):
const AUTO_MAX_ZOOM = 2.2 // потолок приближения (было 2.5)
const AUTO_FACE_SPAN_W = 3 // окно по ширине = ширина рамки * это (было 2.6)
const AUTO_FACE_SPAN_H = 3.4 // окно по высоте = высота рамки * это: запас на макушку и подбородок (было 2.6)
const AUTO_HEAD_SHIFT = 0.12 // центр окна выше центра рамки на долю высоты рамки (макушка)

let level = 'auto' // ket4tec v7: кадр по лицу включён по умолчанию (Андрей 10.11)
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
		const needW = (x2 - x1) * AUTO_FACE_SPAN_W
		const needH = (y2 - y1) * AUTO_FACE_SPAN_H
		zoom = 1 / Math.max(needW, needH, 1 / AUTO_MAX_ZOOM)
	} else {
		zoom = parseFloat(lvl)
	}
	const shift = lvl === 'auto' ? (y2 - y1) * AUTO_HEAD_SHIFT : 0
	return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 - shift, zoom: Math.max(1, zoom) }
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
		// ket4tec (NAS_CLOUD#108): на выходе исходный трек (кадр «Выкл», аппаратный зум, откат) — замены трека нет,
		// получателям надо сказать явно, иначе кнопка камеры не переключается и камеру не вернуть
		if (this.getOutputTrack() === this.getInputTrack()) {
			this._setOutputTrackEnabled('default', enabled)
		}
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
			if (token !== this._applyToken) {
				return // пока ждали, кадрирование выключили или сменили камеру
			}
		}
		this.path = 'digital'
		// пока канвас не дал кадров, на выходе исходная камера: пустого превью не бывает
		if (this._digital?.input !== input) {
			this._setOutput(input)
		}
		try {
			this._startDigital(input)
		} catch (e) {
			this._fallback({ input, stopped: false }, 'запуск конвейера: ' + e.message)
		}
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
		video.autoplay = true
		video.setAttribute('playsinline', '')
		video.setAttribute('autoplay', '')
		// iOS WebKit не декодирует <video> вне DOM: вставляем невидимым
		video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
		video.srcObject = new MediaStream([input])
		document.body.appendChild(video)
		const canvas = document.createElement('canvas')
		// Safari (предположение): captureStream отложенного от DOM канваса может отдавать чёрные кадры
		canvas.style.cssText = video.style.cssText
		document.body.appendChild(canvas)
		const ctx = canvas.getContext('2d')
		const t0 = performance.now()
		const d = {
			input,
			video,
			canvas,
			ctx,
			win: { cx: 0.5, cy: 0.5, zoom: 1 },
			target: { cx: 0.5, cy: 0.5, zoom: 1 },
			lastFace: 0,
			tileIdx: 0,
			noFace: true,
			nextDetectAt: 0,
			nextTileAt: 0,
			lastTick: 0,
			stopped: false,
			detector: null,
			startedAt: t0,
			frames: 0, // отрисовок канваса с ненулевым размером
			published: false,
			sid: 0,
			useRaf: !video.requestVideoFrameCallback,
			rvfcFired: false,
			durs: [],
			detCount: 0,
			fpsT: t0,
			fpsFrames: 0,
			fps: 0,
			lowSince: 0,
			lastLog: t0,
		}
		this._digital = d
		video.play().catch(() => {})
		getDetector().then((detector) => {
			d.detector = detector
		}).catch((e) => console.error('FaceFrame: детектор не загрузился', e))

		const schedule = () => {
			const id = ++d.sid // устаревшие колбэки (rVFC после перехода на rAF) игнорируются
			const run = (now) => {
				if (d.stopped || id !== d.sid) {
					return
				}
				d.rvfcFired = d.rvfcFired || !d.useRaf
				this._renderFrame(d, performance.now())
				schedule()
			}
			if (d.useRaf) {
				requestAnimationFrame(run)
			} else {
				video.requestVideoFrameCallback(run)
			}
		}
		schedule()
		// rVFC на iOS может не стрелять — тогда рисуем по requestAnimationFrame
		d.rvfcTimer = setTimeout(() => {
			if (!d.stopped && !d.useRaf && !d.rvfcFired) {
				d.useRaf = true
				schedule()
			}
		}, RVFC_WAIT_MS)
		d.watch = setInterval(() => this._watch(d), 500)
	}

	// страховка и замеры: раз в 0,5 с
	_watch(d) {
		if (d.stopped) {
			return
		}
		const now = performance.now()
		if (now - d.fpsT >= 1000) {
			d.fps = d.fpsFrames * 1000 / (now - d.fpsT)
			d.fpsT = now
			d.fpsFrames = 0
		}
		const sorted = [...d.durs].sort((a, b) => a - b)
		const stats = {
			path: this.path,
			level: getFaceFrameLevel(),
			fps: Math.round(d.fps * 10) / 10,
			detAvg: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10 : 0,
			detP95: sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] * 10) / 10 : 0,
			detCount: d.detCount,
			frames: d.frames,
			scheduler: d.useRaf ? 'raf' : 'rvfc',
			published: d.published,
		}
		window.__k4ffStats = stats
		if (now - d.lastLog >= STATS_LOG_MS) {
			d.lastLog = now
			console.debug('FaceFrame', stats)
		}

		// вкладка в фоне: rAF/rVFC стоят, fps 0 — это не поломка, страховку не судим
		if (document.hidden) {
			d.lowSince = 0
			d.startedAt = now
			return
		}
		if (!d.published) {
			if (now - d.startedAt > NO_FRAMES_MS) {
				this._fallback(d, d.frames >= MIN_FRAMES
					? `выходной трек не отдаёт кадры за ${NO_FRAMES_MS} мс`
					: `канвас не получил кадров за ${NO_FRAMES_MS} мс`)
			}
			return
		}
		if (d.fps < MIN_FPS) {
			d.lowSince = d.lowSince || now
			if (now - d.lowSince >= LOW_FPS_MS) {
				this._fallback(d, `fps выхода ${stats.fps} < ${MIN_FPS} в течение ${LOW_FPS_MS} мс`)
			}
		} else {
			d.lowSince = 0
		}
	}

	// откат на исходный трек: уровень «Выкл» (селектор покажет), путь 'fallback'
	_fallback(d, reason) {
		if (d.stopped) {
			return
		}
		const input = d.input
		this._stopDigital()
		setFaceFrameLevel('off')
		this._setOutput(input)
		this.path = 'fallback'
		if (window.__k4ffStats) {
			window.__k4ffStats.path = 'fallback'
		}
		calllog('framing_error', { reason: String(reason?.message ?? reason).split('\n')[0].slice(0, 100) })
		console.error('FaceFrame: кадр по лицу отключён —', reason)
		showWarning('Кадр по лицу недоступен в этом браузере, камера работает без него')
	}

	_detectBoxes(d, source, W, H, now) {
		const res = d.detector.detectForVideo(source, nextTs(now))
		return res.detections
			.filter((x) => x.boundingBox)
			.map((x) => ({
				x: x.boundingBox.originX / W,
				y: x.boundingBox.originY / H,
				w: x.boundingBox.width / W,
				h: x.boundingBox.height / H,
			}))
	}

	// не больше одной детекции за кадр: полный кадр (до 8 раз/с), а когда лица нет — плитка (до 2 раз/с)
	_maybeDetect(d, now, lvl) {
		const { video, canvas } = d
		const full = now >= d.nextDetectAt
		const tileDue = !full && d.noFace && now >= d.nextTileAt
		if (!d.detector || !(full || tileDue)) {
			return
		}
		const t = performance.now()
		try {
			let faces
			let tile = null
			if (full) {
				faces = this._detectBoxes(d, video, canvas.width, canvas.height, now)
			} else {
				// плитка апскейлится до размера кадра: далёкое лицо становится крупнее
				tile = TILES[d.tileIdx % TILES.length]
				const tc = d.tileCanvas ||= document.createElement('canvas')
				tc.width = canvas.width
				tc.height = canvas.height
				tc.getContext('2d').drawImage(video, tile.x * canvas.width, tile.y * canvas.height, tile.w * canvas.width, tile.h * canvas.height, 0, 0, tc.width, tc.height)
				faces = this._detectBoxes(d, tc, tc.width, tc.height, now).map((b) => tileToFrame(b, tile))
			}
			if (full) {
				d.noFace = !faces.length
			}
			if (tile && !faces.length) {
				d.tileIdx++
			}
			const target = computeTarget(faces, lvl)
			if (target) {
				d.target = target
				d.lastFace = now
			}
		} catch (e) { /* пропускаем детекцию */ }
		const dur = performance.now() - t
		d.detCount++
		d.durs.push(dur)
		if (d.durs.length > 60) {
			d.durs.shift()
		}
		if (full) {
			d.nextDetectAt = now + (dur > SLOW_DETECT_MS ? Math.max(DETECT_INTERVAL_MS, dur * 4) : DETECT_INTERVAL_MS)
		} else {
			d.nextTileAt = now + TILE_INTERVAL_MS
			d.nextDetectAt = Math.max(d.nextDetectAt, now + (dur > SLOW_DETECT_MS ? dur * 4 : 0))
		}
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
		d.frames++
		d.fpsFrames++

		if (!d.output) {
			try {
				d.output = canvas.captureStream().getVideoTracks()[0]
				if (!d.output) {
					throw new Error('captureStream без видеотрека')
				}
				// проба: <video> на выходном треке, должен отдать кадр до подмены камеры
				const probe = document.createElement('video')
				probe.muted = true
				probe.playsInline = true
				probe.setAttribute('playsinline', '')
				probe.style.cssText = d.video.style.cssText
				probe.srcObject = new MediaStream([d.output])
				document.body.appendChild(probe)
				d.probe = probe
				probe.play?.()?.catch?.(() => {})
			} catch (e) {
				this._fallback(d, 'canvas.captureStream недоступен: ' + e.message)
				return
			}
		}
		// пока канвас не дал 3 кадров, на выходе остаётся исходный трек
		if (!d.published && d.frames >= MIN_FRAMES && this._probeOk(d)) {
			d.published = true
			this._setOutput(d.output)
		}

		// детекция после отрисовки: кадр от неё не зависит
		this._maybeDetect(d, now, lvl)
	}

	// выходной трек реально отдаёт кадры, и они не чёрные при нечёрном источнике
	_probeOk(d) {
		const p = d.probe
		if (!p || !p.videoWidth || p.readyState < 2) {
			return false
		}
		try {
			const px = (el) => {
				const c = document.createElement('canvas')
				c.width = c.height = 8
				const x = c.getContext('2d')
				x.drawImage(el, 0, 0, 8, 8)
				return x.getImageData(0, 0, 8, 8).data.some((v, i) => i % 4 !== 3 && v > 0)
			}
			return px(p) || !px(d.video)
		} catch (e) {
			return true
		}
	}

	_stopDigital() {
		const d = this._digital
		if (!d) {
			return
		}
		d.stopped = true
		clearTimeout(d.rvfcTimer)
		clearInterval(d.watch)
		d.video.srcObject = null
		d.video.remove()
		d.canvas.remove()
		if (d.probe) {
			d.probe.srcObject = null
			d.probe.remove()
		}
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
