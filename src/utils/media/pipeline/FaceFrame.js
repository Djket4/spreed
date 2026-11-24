/**
 * SPDX-FileCopyrightText: 2026 Ket4tec
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FaceDetector } from '@mediapipe/tasks-vision'
import { showWarning } from '@nextcloud/dialogs'
import { calllog } from '../../calllog.js'
import { getWasmFileset } from '../effects/virtual-background/VideoStreamBackgroundEffect.js'
import { stepWindow } from './FaceSmooth.js'
import { centerZoom, clampTarget, squareRect } from './FaceSquare.js'
import TrackSinkSource from './TrackSinkSource.js'

const STORAGE_KEY = 'k4FaceFrameLevel'
// ket4tec (NAS_CLOUD#232): автокадрирование вкл/выкл + «Дальность»; старые x1/x2 из localStorage читаются как «вкл»
export const LEVELS = ['off', 'auto']
const RANGE_KEY = 'k4FaceFrameRange'

const DETECT_INTERVAL_MS = 125 // не чаще 8 раз/с
const TILE_INTERVAL_MS = 500 // плитки (лица нет) не чаще 2 раз/с
const SLOW_DETECT_MS = 25 // дольше — следующая детекция откладывается
const RVFC_WAIT_MS = 300 // нет первого rVFC -> requestAnimationFrame
const MIN_FRAMES = 3 // кадров канваса до проверки выхода пробой
const NO_FRAMES_MS = 2000
// ket4tec (NAS_CLOUD#160): выходной трек уже работавший и вставший (Safari 26: видео в 0 через 1–2 мин)
export const STALL_MS = 3000
// ket4tec (NAS_CLOUD#271): первый кадр рисуем сразу в итоговом кадрировании — ждём первую детекцию не дольше этого
const HOLD_MS = 1500
// ket4tec (NAS_CLOUD#160): «мало кадров» — только когда отрисовка отстаёт от входа (камера в слабом свете даёт 10–14 к/с — это не сбой конвейера)
const LOW_FPS_RATIO = 0.7 // отрисовка < 70 % входа
const LOW_FPS_MS = 2000
const MIN_FPS = 15 // вход не измерить (нет getVideoPlaybackQuality) — прежнее правило: отрисовка < 15 к/с
const SIGNAL_DEAD_MS = 1000 // признак нового кадра не менялся при живом входе — признак негоден до конца запуска
const REDRAW_MAX_MS = 250 // вход не меняется дольше — всё равно перерисовываем (метаданные кадра могут не отражать смену кадра)
const STATS_LOG_MS = 5000
const STATS_CALLLOG_MS = 10000 // framing_stats в журнал звонка
// ket4tec (NAS_CLOUD#160): детектор MediaPipe на CPU не должен видеть полный кадр 1080p — рисуем в канвас постоянного размера (длинная сторона, px).
// Полный кадр — 320: BlazeFace short-range сам работает на 128×128, больше смысла нет. Плитка — 480: вырезка исходных пикселей
// (далёкое лицо в плитке 40 % кадра остаётся крупным), но не апскейл до размера кадра.
const DETECT_FULL_PX = 320
// ket4tec (NAS_CLOUD#160): сторона выходного квадрата не больше 720 (simulcast-верх 720p; 1080 на iPhone не вывозит),
// при нехватке мощности ступенью ниже — вдвое
const OUT_MAX_PX = 720
const EASE_JUDGE_MS = 3000 // после ступени остановка не раньше и только по fps, посчитанному целиком после неё
const PROBE_POLL_MS = 1000 // после публикации живость выхода — один rVFC пробы в секунду
const outSide = (w, h, eased) => Math.min(w, h, eased ? OUT_MAX_PX / 2 : OUT_MAX_PX)
const DETECT_TILE_PX = 480
// ket4tec (NAS_CLOUD#271): было 2000 — рука у лица или контровой свет на 2+ с уводили окно в общий план и обратно (скачок общий↔крупный)
const LOST_AFTER_MS = 8000
// Подстройка «Авто» (рамка детектора — лоб..подбородок, без макушки и шеи):
const AUTO_MAX_ZOOM = 3 // потолок приближения (#232: было 2.2, «Ближе» упиралось в него)
const AUTO_FACE_TIGHT_W = 1.8 // «ближе» до упора: окно по ширине = ширина рамки * это
const AUTO_FACE_TIGHT_H = 1.9 // «ближе» до упора: окно по высоте = высота рамки * это — макушка и подбородок ещё в кадре
const AUTO_HEAD_SHIFT = 0.12 // центр окна выше центра рамки на долю высоты рамки (макушка)

let level = 'auto' // ket4tec v7: кадр по лицу включён по умолчанию (Андрей 10.11)
try {
	const stored = localStorage.getItem(STORAGE_KEY)
	if (stored === 'off') {
		level = stored
	}
} catch (e) { /* localStorage недоступен */ }
const levelEvents = new EventTarget()

// «Дальность»: 0 — дальше (окно шире), 1 — ближе; 0.5 — прежнее «Авто»
let range = 0.5
try {
	const stored = parseFloat(localStorage.getItem(RANGE_KEY))
	if (stored >= 0 && stored <= 1) {
		range = stored
	}
} catch (e) { /* localStorage недоступен */ }

/** @return {number} дальность 0..1 */
export function getFaceFrameRange() {
	return range
}

/**
 * Читается покадрово при каждой детекции — превью и звонок подхватывают сразу.
 *
 * @param {number} value дальность 0..1
 */
export function setFaceFrameRange(value) {
	range = Math.min(1, Math.max(0, value))
	try {
		localStorage.setItem(RANGE_KEY, String(range))
	} catch (e) { /* localStorage недоступен */ }
}

/**
 * ket4tec (NAS_CLOUD#160): выбор кадрирования в журнал звонка
 *
 * @param {string} src 'join' (вход в звонок) или 'change' (смена человеком)
 */
export function logFaceFrameChoice(src) {
	calllog('framing', { on: level === 'off' ? 0 : 1, range, src })
}

/** @return {string} текущий уровень */
export function getFaceFrameLevel() {
	return level
}

/**
 * @param {string} newLevel новый уровень
 * @param {object} [options] параметры
 * @param {boolean} [options.persist] сохранить в localStorage (выбор человека); false — только до перезагрузки страницы (откат)
 */
export function setFaceFrameLevel(newLevel, { persist = true } = {}) {
	if (!LEVELS.includes(newLevel) || newLevel === level) {
		return
	}
	level = newLevel
	if (persist) {
		try {
			localStorage.setItem(STORAGE_KEY, level)
		} catch (e) { /* localStorage недоступен */ }
	}
	levelEvents.dispatchEvent(new Event('change'))
}

// ket4tec (NAS_CLOUD#160): текст всплывашки отката — по причине
const FALLBACK_TAIL = ' Камера работает без него; включить снова можно в настройках камеры.'
export const FALLBACK_TEXT = {
	detector: 'Слежение за лицом остановлено: распознаватель лиц не загрузился (браузер без WebGL/WebAssembly или нет связи). Кадр остаётся на месте.',
	capture: 'Кадр по лицу выключен: этот браузер не умеет передавать обработанное видео.' + FALLBACK_TAIL,
	input: 'Кадр по лицу выключен: камера не отдала кадры для кадрирования.' + FALLBACK_TAIL,
	output: 'Кадр по лицу выключен: сбой обработанного видео в этом браузере.' + FALLBACK_TAIL,
	lowFps: 'Слежение за лицом остановлено: устройству не хватает мощности. Кадр остаётся на месте.',
	error: 'Кадр по лицу выключен из-за ошибки.' + FALLBACK_TAIL,
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
 * @param {number} [r] дальность 0..1
 */
export function computeTarget(faces, r = range) {
	if (!faces.length) {
		return null
	}
	const x1 = Math.min(...faces.map((f) => f.x))
	const y1 = Math.min(...faces.map((f) => f.y))
	const x2 = Math.max(...faces.map((f) => f.x + f.w))
	const y2 = Math.max(...faces.map((f) => f.y + f.h))
	// ket4tec (NAS_CLOUD#232): «Дальность» 0 — весь кадр (1×), 1 — голова во весь квадрат (до потолка); между — равные шаги в разах.
	// Было: запас ×1.5..×0.6 от «обычного» окна — на крупном лице 0, 0.25 и 0.5 упирались в 1× и почти не различались
	const zMax = Math.min(AUTO_MAX_ZOOM, 1 / Math.max((x2 - x1) * AUTO_FACE_TIGHT_W, (y2 - y1) * AUTO_FACE_TIGHT_H, 1e-3))
	const zoom = Math.max(1, zMax) ** r
	const shift = (y2 - y1) * AUTO_HEAD_SHIFT
	return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 - shift, zoom: Math.max(1, zoom) }
}

export { stepWindow }

// ket4tec (NAS_CLOUD#160): iPad, мелкое лицо — рамка детектора дрожит, а цель масштаба шла в окно как есть («дышит зумом»).
// Масштаб держим, пока размер лица (zoom = zMax^range) не ушёл больше чем на ZOOM_HOLD_FACE по сырому замеру дольше ZOOM_HOLD_MS;
// разворот направления — не чаще ZOOM_FLIP_MS. Сдвиг окна идёт отдельно и этим не ограничен.
const ZOOM_HOLD_FACE = 1.25
const ZOOM_HOLD_MS = 500
const ZOOM_FLIP_MS = 2000

/**
 * @param {object} d состояние конвейера (поле zs хранит принятый масштаб)
 * @param {number} zoom сырой масштаб из замера
 * @param {number} now время, мс
 * @param {number} [r] дальность 0..1
 * @return {number} масштаб для цели
 */
export function holdZoom(d, zoom, now, r = range) {
	// ползунок «Дальность» сдвинули (или первый замер): цель принимается сразу, без выдержки
	if (!d.zs || d.zs.r !== r) {
		d.zs = { z: zoom, pend: 0, dir: 0, at: -Infinity, r }
		return zoom
	}
	const s = d.zs
	const err = Math.log(zoom / s.z)
	const dir = Math.sign(err)
	if (Math.abs(err) <= r * Math.log(ZOOM_HOLD_FACE) + 1e-9) {
		s.pend = 0
		return s.z
	}
	if (!s.pend || s.pdir !== dir) {
		s.pend = now
		s.pdir = dir
	}
	if (now - s.pend >= ZOOM_HOLD_MS && (dir === s.dir || now - s.at >= ZOOM_FLIP_MS)) {
		s.z = zoom
		s.pend = 0
		s.dir = dir
		s.at = now
	}
	return s.z
}

// ket4tec (NAS_CLOUD#160): мигающая ложная рамка (люстра, светильник) не должна двигать окно. Рамки сопоставляются между
// детекциями по близости центров; в охват входит рамка, державшаяся подряд >= STABLE_MS, и выходит через STABLE_MS после
// последнего появления. Пока устойчивых нет (первые 600 мс) — охват по текущим рамкам.
const STABLE_MS = 600
const TRACK_SPEED = 1 // допустимая скорость лица для сопоставления, ширин кадра в секунду

/**
 * @param {object} d состояние конвейера (поля tr и dts хранят треки и времена детекций)
 * @param {Array<{x: number, y: number, w: number, h: number}>} faces рамки текущей детекции
 * @param {number} now время, мс
 * @return {{cover: Array, stable: number}} рамки для охвата и число устойчивых
 */
export function stableFaces(d, faces, now) {
	// срок жизни и «устойчивости» — не меньше 2.5 средних интервалов детекции (в режиме плиток они реже 600 мс)
	const ts = (d.dts = [...(d.dts || []), now].slice(-6))
	const hold = Math.max(STABLE_MS, ts.length > 1 ? 2.5 * (now - ts[0]) / (ts.length - 1) : 0)
	const tr = (d.tr = (d.tr || []).filter((t) => now - t.last <= hold))
	if (faces.length) {
		const used = new Set()
		const fresh = []
		for (const f of faces) {
			// ближайший трек; допуск — ширина рамки, а для давно не виденного — путь, который лицо успело пройти
			const dist = (c) => Math.hypot(c.x + c.w / 2 - f.x - f.w / 2, c.y + c.h / 2 - f.y - f.h / 2)
			const tol = (c) => Math.max(c.w, f.w, TRACK_SPEED * (now - c.last) / 1000)
			const t = tr.filter((c) => !used.has(c) && Math.abs(c.x + c.w / 2 - f.x - f.w / 2) < tol(c) && Math.abs(c.y + c.h / 2 - f.y - f.h / 2) < Math.max(c.h, f.h, tol(c))).sort((p, q) => dist(p) - dist(q))[0]
			if (t) {
				used.add(t)
				Object.assign(t, f, { last: now, since: t.since ?? now })
				t.stable ||= now - t.since >= hold
			} else {
				const n = { ...f, last: now, since: now, stable: false }
				tr.push(n)
				used.add(n)
				fresh.push(n)
			}
		}
		const lost = tr.filter((t) => !used.has(t))
		// быстрое лицо ушло дальше допуска: ни один устойчивый трек не сопоставился, один пропал, одна новая рамка того же размера — трек переезжает
		const lostStable = lost.filter((t) => t.stable)
		if (lostStable.length === 1 && fresh.length === 1 && ![...used].some((t) => t.stable)) {
			const [o] = lostStable
			const ratio = fresh[0].w / o.w
			if (ratio >= 0.6 && ratio <= 1.6) {
				Object.assign(o, fresh[0], { last: now, since: now, stable: true })
				tr.splice(tr.indexOf(fresh[0]), 1)
				lost.splice(lost.indexOf(o), 1)
			}
		}
		for (const t of lost) {
			t.since = null // пропал при живой детекции — серия прервалась
		}
	}
	const st = tr.filter((t) => t.stable)
	return { cover: st.length ? st : faces, stable: st.length }
}

/**
 * Охват (рамки лиц) целиком внутри окна цели.
 *
 * @param {object} t цель
 * @param {Array} cover рамки
 * @param {number} W ширина кадра
 * @param {number} H высота кадра
 */
function fitsWindow(t, cover, W, H) {
	const c = clampTarget(t, W, H)
	const side = Math.min(W, H) / Math.max(1, c.zoom)
	const sx = c.cx * W - side / 2
	const sy = c.cy * H - side / 2
	return cover.every((f) => f.x * W >= sx - 0.5 && (f.x + f.w) * W <= sx + side + 0.5 && f.y * H >= sy - 0.5 && (f.y + f.h) * H <= sy + side + 0.5)
}

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

const round1 = (v) => Math.round(v * 10) / 10

// ket4tec (NAS_CLOUD#160): сервер журнала принимает ключи /^[a-z]{1,12}$/, до 12 на событие, значения скалярные —
// поэтому ключи без «_» и заглавных, а null/undefined не отправляем вовсе
const logEv = (name, fields) => calllog(name, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)))

/**
 * Среднее и 95-й перцентиль времени детекции по последним замерам, мс.
 *
 * @param {object} d состояние конвейера
 */
function detStats(d) {
	const sorted = [...(d.durs || [])].sort((a, b) => a - b)
	return {
		detAvg: sorted.length ? round1(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
		detP95: sorted.length ? round1(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]) : 0,
	}
}

/**
 * Узел: «кадр по лицу». Уровень берётся из общей настройки (getFaceFrameLevel).
 *
 * Цифровое окно с ведением за лицом, крупность — «Дальность» (getFaceFrameRange).
 * Какой путь сработал: свойство "path" ('off' | 'digital').
 *
 *        -----------
 *  ---> | FaceFrame | --->
 *        -----------
 */
export default class FaceFrame extends TrackSinkSource {
	/**
	 * @param {'call'|'preview'} [inst] метка экземпляра в журнале клиента (в звонке и в превью свои конвейеры)
	 */
	constructor(inst = 'preview') {
		super()
		this._inst = inst
		this._mode = 'off' // ket4tec (NAS_CLOUD#160): последний записанный в журнал путь

		this._addInputTrackSlot()
		this._addOutputTrackSlot()

		// для проверки в живом звонке: window.__k4ff[i].path / .window
		;(window.__k4ff ||= []).push(this)
		this.path = 'off'
		this._applyToken = 0
		this._outputTrack = null
		this._frozen = null // причина остановки слежения (детектор, мощность) — до смены уровня человеком
		this._unsubscribe = onFaceFrameLevelChange(() => {
			this._frozen = null
			this._apply()
		})
	}

	// ket4tec (NAS_CLOUD#160): смена пути (off/digital/frozen/fallback) — в журнал с причиной
	_setPath(mode, why) {
		this.path = mode
		if (mode !== this._mode) {
			this._mode = mode
			logEv('framing_mode', { inst: this._inst, mode, why })
		}
	}

	_handleInputTrack(trackId, newTrack) {
		this._apply()
	}

	_handleInputTrackEnabled(trackId, enabled) {
		// ket4tec (NAS_CLOUD#271): при включении сначала ставим выход-канвас — иначе исходная камера
		// успевает уйти на плитки и получателям некадрированной
		const early = enabled && getFaceFrameLevel() !== 'off'
		if (early) {
			this._apply()
		}
		// ket4tec (NAS_CLOUD#108): на выходе исходный трек (кадр «Выкл», аппаратный зум, откат) — замены трека нет,
		// получателям надо сказать явно, иначе кнопка камеры не переключается и камеру не вернуть
		if (this.getOutputTrack() === this.getInputTrack()) {
			this._setOutputTrackEnabled('default', enabled)
		}
		if (!enabled) {
			this._stopDigital()
			this._setOutput(this.getInputTrack())
			this._setPath('off', 'камера выключена')
			return
		}
		if (!early) {
			this._apply()
		}
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
		if (lvl !== 'off') {
			getDetector().catch(() => {}) // ket4tec (NAS_CLOUD#271): к включению камеры детектор уже загружен
		}

		if (!input || !input.enabled || lvl === 'off') {
			this._stopDigital()
			this._setPath('off', !input || !input.enabled ? 'нет включённого трека' : 'уровень выкл')
			this._setOutput(input)
			return
		}

		this.path = 'digital'
		// ket4tec (NAS_CLOUD#271): исходную камеру на выход не ставим — её некадрированный кадр и был «скачком».
		// Выход — канвас с первой отрисовки; плитки (свои и чужие) проявляются по первому настоящему кадру.
		try {
			this._startDigital(input)
		} catch (e) {
			this._fallback({ input, stopped: false }, 'error', 'запуск конвейера: ' + e.message)
			return
		}
		this._setPath(this._frozen ? 'frozen' : 'digital', this._frozen ? 'остановлено: ' + this._frozen : 'запуск')
	}

	_startDigital(input) {
		if (this._digital && this._digital.input === input) {
			return // уровень читается покадрово
		}
		this._stopDigital()
		// ket4tec (NAS_CLOUD#160): каждый новый запуск (камера выкл→вкл, смена устройства) пробует слежение заново;
		// «остаёмся без слежения» (#271) действует только внутри одного запуска
		this._frozen = null

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
		// ket4tec (NAS_CLOUD#271): сразу итоговый квадрат. Канвас по умолчанию 300×150 и до первой отрисовки уходит
		// в captureStream таким: Safari показывал на плитке квадрат поменьше посередине ~0,3 с, потом скачок во всю плитку
		const { width: sw, height: sh } = input.getSettings?.() || {}
		if (sw && sh) {
			canvas.width = canvas.height = outSide(sw, sh)
		}
		// Safari (предположение): captureStream отложенного от DOM канваса может отдавать чёрные кадры
		canvas.style.cssText = video.style.cssText
		document.body.appendChild(canvas)
		const ctx = canvas.getContext('2d')
		const t0 = performance.now()
		// ket4tec (NAS_CLOUD#271): после выкл/вкл продолжаем с последнего кадрирования, а не с центра
		const last = this._lastWin
		const d = {
			input,
			video,
			canvas,
			ctx,
			win: last ? { ...last } : { cx: 0.5, cy: 0.5, zoom: 1 },
			target: last ? { ...last } : { cx: 0.5, cy: 0.5, zoom: 1 },
			lastFace: last ? t0 : 0,
			placed: !!last, // окно стоит на итоговом месте, можно рисовать
			tileIdx: 0,
			noFace: true,
			nextDetectAt: 0,
			nextTileAt: 0,
			lastTick: 0,
			stopped: false,
			detector: null,
			startedAt: t0,
			frames: 0, // отрисовок канваса с ненулевым размером
			published: false, // выходной трек проверен пробой
			outMark: null, // последняя отметка прогресса выходного трека (кадры/время пробы)
			outAt: t0, // когда отметка менялась
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
			frozen: !!this._frozen, // слежение остановлено: окно стоит, детекций нет
			inTotal: 0, // кадров на входе (totalVideoFrames исходного video) на прошлом замере fps
			inFps: null, // fps входа; null — не измерить или счётчик входа ещё ни разу не вырос (тогда порог прежний, MIN_FPS)
			inSeen: false,
			qSeen: false, // счётчик кадров пробы хоть раз вырос
			qLast: 0,
			// ket4tec (NAS_CLOUD#160): счёт кадров входа по метаданным rVFC исходного video (Safari: totalVideoFrames стоит на 0)
			inRv: 0, // новых кадров входа по rVFC
			rvOk: false, // метаданные rVFC несут presentedFrames/mediaTime — счёт осмыслен
			lastPF: null,
			lastMT: null,
			lastQ: 0,
			lastDraw: 0,
			prevCb: 0,
			cbs: 0, // колбэков отрисовки (rVFC/rAF)
			novAt: 0, // когда последний раз менялся признак нового кадра
			badSig: false, // признак нового кадра негоден (стоит при живом входе) — рисуем каждый колбэк
			qinLast: 0,
			inSrc: 'none', // источник частоты входа: quality | rvfc | settings | none
			lastCb: 0,
			gapMax: 0, // макс. разрыв между колбэками кадра за интервал журнала, мс
			st: { t: t0, in: 0, cb: 0, draw: 0, out: 0, outq: 0 }, // отметки прошлой записи framing_stats
		}
		this._digital = d
		const logStart = () => logEv('framing_start', { inst: this._inst, w: sw || 0, h: sh || 0, cfgfps: input.getSettings?.().frameRate, sched: d.useRaf ? 'raf' : 'rvfc', frozen: d.frozen, ow: canvas.width, oh: canvas.height })
		// без размера в getSettings канвас пока 300×150: пишем фактический размер после первой отрисовки
		if (sw && sh) {
			logStart()
		} else {
			d.logStart = logStart
		}
		// выход — сразу канвас: до первой отрисовки кадров нет, на плитках держится облако
		d.output = canvas.captureStream().getVideoTracks()[0]
		if (!d.output) {
			throw new Error('captureStream без видеотрека')
		}
		// выходной трек кончился сам (не нашей остановкой) — получатели видели бы чёрное
		d.output.addEventListener('ended', () => this._fallback(d, 'output', 'выходной трек завершился'))
		// проба: <video> на выходном треке — канвас реально отдаёт кадры; иначе откат на камеру
		const probe = document.createElement('video')
		probe.muted = true
		probe.playsInline = true
		probe.setAttribute('playsinline', '')
		probe.style.cssText = video.style.cssText
		probe.srcObject = new MediaStream([d.output])
		document.body.appendChild(probe)
		d.probe = probe
		if (probe.requestVideoFrameCallback) {
			let lastOutPF = null
			const requestProbeFrame = () => {
				const id = probe.requestVideoFrameCallback((now, meta) => {
					if (id === d.probeRequest) {
						onOut(now, meta)
					}
				})
				d.probeRequest = id
			}
			const onOut = (_now, meta) => {
				if (!d.stopped) {
					// presentedFrames — счётчик показанных кадров: при редком опросе считаем приращение, а не колбэки; стоячие метаданные (Safari) — не меньше 1 за колбэк
					const pf = meta?.presentedFrames
					const step = typeof pf === 'number' && lastOutPF !== null ? Math.max(pf - lastOutPF, 1) : 1
					lastOutPF = typeof pf === 'number' ? pf : null
					d.outFrames = (d.outFrames || 0) + step
					// ket4tec (NAS_CLOUD#160): после публикации не декодируем пробу на каждый кадр — один колбэк в секунду
					if (d.published) {
						d.probeTimer = setTimeout(requestProbeFrame, PROBE_POLL_MS)
					} else {
						requestProbeFrame()
					}
				}
			}
			d.requestProbeFrame = requestProbeFrame
			requestProbeFrame()
		}
		probe.play?.()?.catch?.(() => {})
		this._setOutput(d.output)
		video.play().catch(() => {})
		if (!d.frozen) {
			getDetector().then((detector) => {
				d.detector = detector
			}).catch((e) => this._fallback(d, 'detector', 'детектор не загрузился: ' + e?.message))
		}

		const schedule = () => {
			const id = ++d.sid // устаревшие колбэки (rVFC после перехода на rAF) игнорируются
			const run = (now, meta) => {
				if (d.stopped || id !== d.sid) {
					return
				}
				d.rvfcFired = d.rvfcFired || !d.useRaf
				const cb = performance.now()
				d.gapMax = Math.max(d.gapMax, d.lastCb ? cb - d.lastCb : 0)
				d.lastCb = cb
				d.cbs++
				try {
					// ket4tec (NAS_CLOUD#160): было — рисовали на каждый колбэк (Safari: rVFC и rAF идут с частотой экрана, 57–60 к/с
					// при камере 30); теперь рисуем только на новый кадр входа
					if (this._isNewFrame(d, d.useRaf ? undefined : meta, cb)) {
						d.lastDraw = cb
						this._renderFrame(d, cb)
					}
				} catch (e) {
					// отрисовка упала — сразу на исходную камеру, не ждём сторожка
					this._fallback(d, 'error', 'отрисовка: ' + e.message)
					return
				}
				schedule()
			}
			if (d.useRaf) {
				requestAnimationFrame(run)
			} else {
				d.frameRequest = video.requestVideoFrameCallback(run)
			}
		}
		schedule()
		const waitForVideoFrame = () => {
			video.cancelVideoFrameCallback?.(d.frameRequest)
			const id = video.requestVideoFrameCallback(() => {
				if (d.stopped || !d.useRaf || id !== d.frameRequest) {
					return
				}
				d.useRaf = false
				schedule() // также отменяет ожидающий колбэк rAF через sid
			})
			d.frameRequest = id
		}
		// Safari может начать rVFC после тайм-аута. Рисуем по rAF, пока свежий запрос rVFC ждёт первого кадра.
		// Оставаться на rAF нельзя: totalVideoFrames источника бывает обновлён пачкой из нескольких кадров.
		d.rvfcTimer = setTimeout(() => {
			if (!d.stopped && !d.useRaf && !d.rvfcFired) {
				d.useRaf = true
				schedule()
				waitForVideoFrame()
			}
		}, RVFC_WAIT_MS)
		// После ухода в фон ожидающие колбэки кадров могут перестать вызываться.
		// При возврате запрашиваем их заново и даём сторожу полный интервал проверки.
		d.handleVisible = () => {
			if (document.hidden) {
				return
			}
			d.startedAt = d.outAt = performance.now()
			d.lowSince = 0
			if (!d.useRaf) {
				video.cancelVideoFrameCallback?.(d.frameRequest)
				schedule()
			} else if (video.requestVideoFrameCallback) {
				waitForVideoFrame()
			}
			if (d.requestProbeFrame) {
				clearTimeout(d.probeTimer)
				probe.cancelVideoFrameCallback?.(d.probeRequest)
				d.requestProbeFrame()
			}
		}
		document.addEventListener('visibilitychange', d.handleVisible)
		d.watch = setInterval(() => this._watch(d), 500)
	}

	// ket4tec (NAS_CLOUD#160): пришёл ли новый кадр входа. Метаданные rVFC (presentedFrames, иначе mediaTime) -> счётчик inRv;
	// в режиме rAF — счётчик totalVideoFrames, если он растёт; иначе признака нет — рисуем каждый колбэк (как раньше).
	// Вход встал — перерисовываем не реже REDRAW_MAX_MS, чтобы сторож выхода видел живой канвас, а не ложный сбой.
	_isNewFrame(d, meta, cb) {
		if (d.badSig) {
			return true
		}
		let inc
		if (meta && (typeof meta.presentedFrames === 'number' || typeof meta.mediaTime === 'number')) {
			const pf = typeof meta.presentedFrames === 'number' ? (d.lastPF === null ? 1 : meta.presentedFrames - d.lastPF) : 0
			const mt = typeof meta.mediaTime === 'number' && meta.mediaTime !== d.lastMT ? 1 : 0
			d.lastPF = meta.presentedFrames ?? d.lastPF
			d.lastMT = meta.mediaTime ?? d.lastMT
			d.rvOk = true
			inc = Math.max(pf, mt)
			d.inRv += Math.max(inc, 0)
		} else if (d.useRaf && d.inSeen) {
			const q = d.video.getVideoPlaybackQuality?.()?.totalVideoFrames
			if (typeof q !== 'number') {
				return true
			}
			inc = q - d.lastQ
			d.lastQ = q
		} else {
			return true
		}
		// пауза между колбэками > 1 с (вкладка в фоне, зависание потока) — не признак негодности: отсчёт заново
		if (!d.novAt || cb - d.prevCb > SIGNAL_DEAD_MS) {
			d.novAt = cb
		}
		d.prevCb = cb
		const t = d.input
		// вход настоящий-живой: дорожка live, не muted, video играет. Тогда стоящий признак — это сбой признака, не входа
		if (inc > 0 || t.readyState !== 'live' || t.muted || d.video.paused) {
			d.novAt = cb
		} else if (cb - d.novAt >= SIGNAL_DEAD_MS) {
			d.badSig = true
			logEv('framing_mode', { inst: this._inst, mode: this.path, why: 'признак кадра входа не растёт, рисуем каждый колбэк' })
			return true
		}
		return inc > 0 || cb - d.lastDraw >= REDRAW_MAX_MS
	}

	// страховка и замеры: раз в 0,5 с
	_watch(d) {
		if (d.stopped) {
			return
		}
		const now = performance.now()
		// ket4tec (NAS_CLOUD#160): вход измеряем по кадрам исходного video (totalVideoFrames считает декодированные кадры камеры
		// независимо от нашего rVFC/rAF). Счётчик наших отрисовок для этого не годится: rVFC при перегрузке сам теряет кадры,
		// и «камера даёт мало» не отличить от «мы не успеваем рисовать». Нет getVideoPlaybackQuality — inFps остаётся null.
		const inNow = d.video.getVideoPlaybackQuality?.()?.totalVideoFrames
		// счётчик кадров пробы: пригоден для сторожа выхода только после первого роста (бывает вечным нулём)
		const pq = d.probe?.getVideoPlaybackQuality?.()?.totalVideoFrames
		if (typeof pq === 'number') {
			d.qSeen = d.qSeen || pq > d.qLast
			d.qLast = pq
		}
		if (now - d.fpsT >= 1000) {
			if (typeof inNow === 'number') {
				// счётчик входа считаем измеренным только после первого роста: вечный 0 дал бы нулевой порог
				d.inSeen = d.inSeen || inNow > d.qinLast
				d.qinLast = inNow
			}
			// ket4tec (NAS_CLOUD#160): источник частоты входа — счёт кадров (totalVideoFrames или rVFC), иначе заявленная frameRate дорожки
			const cfg = d.input.getSettings?.().frameRate
			const src = d.badSig ? (cfg > 0 ? 'settings' : 'none') : d.inSeen ? 'quality' : d.rvOk && d.inRv > 0 ? 'rvfc' : cfg > 0 ? 'settings' : 'none'
			const cnt = src === 'quality' ? inNow : src === 'rvfc' ? d.inRv : null
			if (cnt !== null) {
				d.inFps = src === d.inSrc ? (cnt - d.inTotal) * 1000 / (now - d.fpsT) : d.inFps
				// прирост presentedFrames сверху не ограничен (Safari может отдавать больше частоты камеры) — потолок: заявленная частота
				if (src === 'rvfc' && cfg > 0 && d.inFps !== null) {
					d.inFps = Math.min(d.inFps, cfg)
				}
				d.inTotal = cnt
			} else {
				d.inFps = src === 'settings' ? cfg : null
			}
			d.inSrc = src
			d.fps = d.fpsFrames * 1000 / (now - d.fpsT)
			d.fpsFrom = d.fpsT // окно, по которому посчитан d.fps
			d.fpsT = now
			d.fpsFrames = 0
		}
		const { detAvg, detP95 } = detStats(d)
		const stats = {
			path: this.path,
			level: getFaceFrameLevel(),
			fps: Math.round(d.fps * 10) / 10,
			detAvg,
			detP95,
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

		// ket4tec (NAS_CLOUD#160): сводка раз в 10 с в журнал звонка — разбор «не кадрирует» без догадок
		if (now - d.st.t >= STATS_CALLLOG_MS) {
			const sec = (now - d.st.t) / 1000
			const srcSame = d.st.src === d.inSrc
			const inCnt = d.inSrc === 'quality' ? inNow : d.inSrc === 'rvfc' ? d.inRv : null
			const rate = (cur, prev) => (typeof cur === 'number' ? round1((cur - prev) / sec) : null)
			// выход: оба счётчика (rVFC пробы и playback quality), в журнал — больший прирост
			const outRates = [rate(d.outFrames || 0, d.st.out), rate(pq, d.st.outq)].filter((v) => v !== null)
			logEv('framing_stats', {
				inst: this._inst,
				infps: inCnt !== null && srcSame ? rate(inCnt, d.st.in) : (d.inFps === null ? null : round1(d.inFps)),
				insrc: d.inSrc,
				drawfps: rate(d.frames, d.st.draw),
				cbfps: rate(d.cbs, d.st.cb),
				outfps: outRates.length ? Math.max(...outRates) : null,
				detavg: detAvg,
				detp: detP95,
				gapmax: Math.round(d.gapMax),
				hidden: document.hidden,
				zoom: Math.round((d.win?.zoom || 1) * 100) / 100,
				zflips: d.zflips || 0,
			})
			// ket4tec (NAS_CLOUD#160): что видит детектор — разбор «кадр не держится на лице» (доля ширины кадра, пропуски, плитки)
			if (d.dm) {
				logEv('framing_face', {
					inst: this._inst,
					facew: d.fn ? Math.round(d.fw / d.fn * 1000) / 1000 : null,
					miss: Math.round(d.dmiss / d.dm * 100) / 100,
					tiles: Math.round(d.dtile / d.dm * 100) / 100,
					faces: d.fmax || 0,
					raw: d.rmax || 0,
				})
			}
			d.fw = d.fn = d.dm = d.dmiss = d.dtile = d.zflips = d.fmax = d.rmax = 0
			d.st = { t: now, src: d.inSrc, in: inCnt ?? 0, draw: d.frames, cb: d.cbs, out: d.outFrames || 0, outq: pq ?? 0 }
			d.gapMax = 0
		}

		// вкладка в фоне: rAF/rVFC стоят, fps 0 — это не поломка, страховку не судим
		if (document.hidden) {
			d.lowSince = 0
			d.startedAt = now
			d.outAt = now
			return
		}
		if (!d.published) {
			if (now - d.startedAt > NO_FRAMES_MS + HOLD_MS) {
				if (d.frames >= MIN_FRAMES) {
					this._fallback(d, 'output', `выходной трек не отдаёт кадры за ${NO_FRAMES_MS} мс`)
				} else {
					this._fallback(d, 'input', `канвас не получил кадров за ${NO_FRAMES_MS} мс`)
				}
			}
			return
		}
		// ket4tec (NAS_CLOUD#160): постоянный сторож выхода. Прогресс пробы: кадры rVFC / счётчик кадров — любой сдвиг считается живым.
		// currentTime у MediaStream растёт и без кадров, поэтому он — только последний запасной вариант, когда счётчиков кадров нет.
		// Исходная камера должна быть живой и включённой, иначе откат не поможет.
		// Счётчик годится, только если хоть раз вырос: вечный 0 (проба без rVFC) не должен исключать currentTime.
		const hasCounter = !!d.outFrames || d.qSeen
		const mark = `${d.outFrames || 0}|${pq ?? ''}|${hasCounter ? '' : d.probe?.currentTime ?? ''}`
		if (mark !== d.outMark) {
			d.outMark = mark
			d.outAt = now
		} else if (now - d.outAt > STALL_MS && d.input.readyState === 'live' && d.input.enabled) {
			this._fallback(d, 'output', `выходной трек встал через ${Math.round((now - d.outAt) / 1000)} с`)
			return
		}
		// ket4tec (NAS_CLOUD#160): сбой — отрисовка заметно отстаёт от входа; вход сам по себе 12 к/с — не сбой
		// rvfc и settings — не точный счёт (Safari): порог не строже прежнего MIN_FPS. Заявленная частота (settings) — не измерение: слабая камера отдаёт меньше заявленного, порог не выше прежнего MIN_FPS
		const lowLimit = d.inFps === null ? MIN_FPS : d.inSrc === 'quality' ? d.inFps * LOW_FPS_RATIO : Math.min(MIN_FPS, d.inFps * LOW_FPS_RATIO)
		if (d.eased && d.fpsFrom < d.easeAt) {
			// fps ещё посчитан по окну, захватившему время до ступени — не судим
		} else if (d.fps < lowLimit && !d.frozen) {
			d.lowSince = d.lowSince || now
			if (now - d.lowSince >= LOW_FPS_MS && !d.eased) {
				// ступень до остановки: рабочее разрешение вдвое и детектор вдвое реже; не помогло — остановка
				d.eased = true
				d.easeAt = now
				d.lowSince = 0
				logEv('framing_ease', { inst: this._inst, drawfps: round1(d.fps || 0), infps: (d.inFps ?? null) === null ? null : round1(d.inFps) })
			} else if (now - d.lowSince >= EASE_JUDGE_MS && now - d.easeAt >= EASE_JUDGE_MS) {
				this._fallback(d, 'lowFps', d.inFps === null ? `fps выхода ${stats.fps} < ${MIN_FPS} в течение ${LOW_FPS_MS} мс` : `отрисовка ${stats.fps} к/с при входе ${round1(d.inFps)} к/с (< ${LOW_FPS_RATIO * 100}%) в течение ${LOW_FPS_MS} мс`)
			}
		} else {
			d.lowSince = 0
		}
	}

	// откат на исходный трек: уровень «Выкл» до перезагрузки страницы (селектор покажет), путь 'fallback'.
	// Выбор человека в localStorage не трогаем: один сбой не выключает кадр по лицу навсегда (NAS_CLOUD#160).
	_fallback(d, kind, reason) {
		if (d.stopped) {
			return
		}
		logEv('framing_error', {
			reason: String(reason?.message ?? reason).split('\n')[0].slice(0, 100),
			inst: this._inst,
			kind,
			infps: (d.inFps ?? null) === null ? null : round1(d.inFps),
			drawfps: round1(d.fps || 0),
			detp: detStats(d).detP95,
		})
		console.error('FaceFrame: кадр по лицу —', reason)
		// ket4tec (NAS_CLOUD#271): нет детектора или мощности — остаёмся на канвасе с текущим кадром, без слежения.
		// Исходная камера — только если сам канвас-выход не даёт кадров (плитки проявят её по первому кадру).
		if (kind === 'detector' || kind === 'lowFps') {
			if (!d.frozen) {
				d.frozen = true
				d.target = { ...d.win }
				this._frozen = kind
				this._setPath('frozen', kind)
				showWarning(FALLBACK_TEXT[kind])
			}
			return
		}
		const input = d.input
		this._stopDigital()
		setFaceFrameLevel('off', { persist: false })
		this._setOutput(input)
		this._setPath('fallback', kind)
		if (window.__k4ffStats) {
			window.__k4ffStats.path = 'fallback'
		}
		showWarning(FALLBACK_TEXT[kind] ?? FALLBACK_TEXT.error)
	}

	// рамки приходят в пикселях источника (канваса детекции) и делятся на его размер — выходят в долях кадра
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

	// ket4tec (NAS_CLOUD#160): канвас детекции постоянного размера (длинная сторона = px, пропорции кадра); размер меняется
	// только если сменились пропорции кадра, не на каждый вызов
	_detectCanvas(d, key, px) {
		const { videoWidth: vw, videoHeight: vh } = d.video
		const k = px / Math.max(vw, vh)
		const w = Math.round(vw * k)
		const h = Math.round(vh * k)
		const c = d[key] ||= document.createElement('canvas')
		if (c.width !== w || c.height !== h) {
			c.width = w
			c.height = h
		}
		return c
	}

	// не больше одной детекции за кадр: полный кадр (до 8 раз/с), а когда лица нет — плитка (до 2 раз/с)
	_maybeDetect(d, now) {
		const { video } = d
		const full = now >= d.nextDetectAt
		const iv = d.eased ? DETECT_INTERVAL_MS * 2 : DETECT_INTERVAL_MS
		// до первой отрисовки плитки — каждый кадр: лицо у края полный кадр не видит, по 2 плитки/с искали бы до 2 с
		const tileDue = !full && d.noFace && (!d.placed || now >= d.nextTileAt)
		if (d.frozen || !d.detector || !(full || tileDue)) {
			return
		}
		const t = performance.now()
		try {
			let faces
			let tile = null
			if (full) {
				const fc = this._detectCanvas(d, 'fullCanvas', DETECT_FULL_PX)
				fc.getContext('2d').drawImage(video, 0, 0, fc.width, fc.height)
				faces = this._detectBoxes(d, fc, fc.width, fc.height, now)
			} else {
				// плитка — вырезка исходных пикселей в канвас DETECT_TILE_PX: далёкое лицо крупнее, чем в полном кадре
				tile = TILES[d.tileIdx % TILES.length]
				const tc = this._detectCanvas(d, 'tileCanvas', DETECT_TILE_PX)
				const vw = video.videoWidth
				const vh = video.videoHeight
				tc.getContext('2d').drawImage(video, tile.x * vw, tile.y * vh, tile.w * vw, tile.h * vh, 0, 0, tc.width, tc.height)
				faces = this._detectBoxes(d, tc, tc.width, tc.height, now).map((b) => tileToFrame(b, tile))
			}
			if (full) {
				d.noFace = !faces.length
			}
			if (tile && !faces.length) {
				d.tileIdx++
			}
			const { cover, stable } = stableFaces(d, faces, now)
			const target = computeTarget(cover)
			if (target) {
				if (cover.length === 1 && range > 0) { // «Дальность» 0 — весь кадр, без доводки к центру
					// ket4tec (NAS_CLOUD#172): лицо у края — квадрат сужается (до 1.5×), чтобы оно встало в центр плитки
					target.zoom = Math.max(target.zoom, centerZoom(target, video.videoWidth, video.videoHeight))
				}
				const raw = target.zoom
				target.zoom = holdZoom(d, raw, now)
				// удержанный масштаб не вмещает охват устойчивых лиц — уменьшаем сразу, в обход удержания
				if (target.zoom > raw && !fitsWindow(target, cover, video.videoWidth, video.videoHeight)) {
					target.zoom = raw
					d.zs.z = raw
					d.zs.pend = 0
					d.zs.dir = -1
					d.zs.at = now
				}
				d.target = target
				d.lastFace = now
				d.fw = (d.fw || 0) + Math.max(...cover.map((f) => f.x + f.w)) - Math.min(...cover.map((f) => f.x))
				d.fn = (d.fn || 0) + 1
			}
			d.fmax = Math.max(d.fmax || 0, stable)
			d.rmax = Math.max(d.rmax || 0, faces.length)
			d.dm = (d.dm || 0) + 1
			d.dmiss = (d.dmiss || 0) + (faces.length ? 0 : 1)
			d.dtile = (d.dtile || 0) + (tile ? 1 : 0)
		} catch (e) { /* пропускаем детекцию */ }
		const dur = performance.now() - t
		d.detCount++
		d.durs.push(dur)
		if (d.durs.length > 60) {
			d.durs.shift()
		}
		if (full) {
			d.nextDetectAt = now + (dur > SLOW_DETECT_MS ? Math.max(iv, dur * 4) : iv)
		} else {
			d.nextTileAt = now + TILE_INTERVAL_MS
			d.nextDetectAt = Math.max(d.nextDetectAt, now + (dur > SLOW_DETECT_MS ? dur * 4 : 0))
		}
	}

	// ket4tec (NAS_CLOUD#160): смены направления масштаба (размах > 1% от крайней точки) — для журнала
	_trackFlips(d) {
		const z = d.win.zoom
		const t = d.zt ||= { ext: z, dir: 0 }
		if (z > t.ext * 1.01 || z < t.ext / 1.01) {
			const dir = z > t.ext ? 1 : -1
			if (t.dir && dir !== t.dir) {
				d.zflips = (d.zflips || 0) + 1
			}
			t.dir = dir
			t.ext = z
		} else if ((t.dir === 1 && z > t.ext) || (t.dir === -1 && z < t.ext)) {
			t.ext = z
		}
	}

	_renderFrame(d, now) {
		const { video, canvas, ctx } = d
		if (!video.videoWidth) {
			return
		}
		// ket4tec (NAS_CLOUD#172): выход — квадрат (сторона = короткая сторона кадра), вырезается у отправителя:
		// сдвиг к лицу видят все — собеседники, своя плитка и превью проверки устройств
		const W = video.videoWidth
		const H = video.videoHeight
		const side = outSide(W, H, d.eased)
		if (canvas.width !== side || canvas.height !== side) {
			canvas.width = side
			canvas.height = side
		}
		if (d.logStart) {
			d.logStart()
			d.logStart = null
		}
		// ket4tec (NAS_CLOUD#271): до первой детекции не рисуем; нашли лицо — окно сразу на месте, без пружины
		if (!d.placed) {
			this._maybeDetect(d, now)
			if (d.lastFace) {
				d.win = clampTarget(d.target, W, H)
			} else if (!d.frozen && now - d.startedAt < HOLD_MS) {
				return
			}
			d.placed = true
		}

		if (!d.frozen && now - d.lastFace > LOST_AFTER_MS) {
			d.target = { cx: 0.5, cy: 0.5, zoom: 1 }
		}

		const dt = d.lastTick ? Math.min(now - d.lastTick, 100) : 0
		d.lastTick = now
		d.win = stepWindow(d.win, clampTarget(d.target, W, H), dt, { W, H })
		this.window = d.win
		this._trackFlips(d)

		const { sx, sy, side: ss } = squareRect(d.win, W, H)
		ctx.drawImage(video, sx, sy, ss, ss, 0, 0, side, side)
		d.frames++
		d.fpsFrames++

		if (!d.published && d.frames >= MIN_FRAMES && this._probeOk(d)) {
			d.published = true
		}

		// детекция после отрисовки: кадр от неё не зависит
		this._maybeDetect(d, now)
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
		this._lastWin = d.placed && d.lastFace ? { ...d.win } : null
		clearTimeout(d.rvfcTimer)
		clearTimeout(d.probeTimer)
		clearInterval(d.watch)
		document.removeEventListener('visibilitychange', d.handleVisible)
		d.video.cancelVideoFrameCallback?.(d.frameRequest)
		d.video.srcObject = null
		d.video.remove()
		d.canvas.remove()
		if (d.probe) {
			d.probe.cancelVideoFrameCallback?.(d.probeRequest)
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
	}
}
