/**
 * ket4tec: k4draw. Снимок «кадр показа + постоянные пометки» → PNG → сервер (K4DrawController).
 * Пометки берём из DOM слоя (тот же рендер, что на экране): клон SVG постоянных штрихов с вшитыми стилями + подписи рисуются на canvas.
 */
import axios from '@nextcloud/axios'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import { reactive } from 'vue'
import { useActorStore } from '../../../stores/actor.ts'
import { useTokenStore } from '../../../stores/token.ts'
import { amGuest, localScreen, myId, onDraw, sendSnap, setAutoSnap, SP, state } from './useDrawing.js'

export const snap = reactive({ n: 0, k: '', busy: false })
const PERM = ['marker', 'arrow', 'frame', 'text']
// в выжимку — только постоянные (гаснущие тексты с ttl не идут); снимок себе (all) — всё, что сейчас видно
const keep = (tool, ttl, el, all) => !el.classList.contains('out') && (all || (PERM.includes(tool) && !(+ttl)))
const STYLE = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight']

/**
 * Слушатель событий `snap` (счётчик и тост у остальных). Вернуть отписку.
 */
export function watchSnaps() {
	return onDraw((ev) => {
		if (ev.t !== 'snap') {
			return
		}
		if (snap.k !== ev.show.k) {
			snap.k = ev.show.k
			snap.n = 0
		}
		snap.n = Math.max(snap.n, ev.n)
		if (ev.by !== myId()) {
			showSuccess(`Снимок сохранён — ${esc(ev.name)}`)
		}
	})
}

// тосты @nextcloud/dialogs разбирают строку как HTML: имя автора экранируем
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')

/**
 *
 * @param src
 */
function loadImg(src) {
	return new Promise((resolve, reject) => {
		const i = new Image()
		i.onload = () => resolve(i)
		i.onerror = reject
		i.src = src
	})
}

/**
 * @param {boolean} all все видимые пометки, а не только постоянные
 * @return {Promise<Blob>} PNG
 */
async function render(all = false) {
	const ink = document.querySelector('.k4-board .k4-ink') || document.querySelector('.k4-layer .k4-ink')
	const board = !!ink?.closest('.k4-board')
	const video = board ? null : ink?.closest('.screenContainer')?.querySelector('video')
	if (!ink || (!board && (!video || !video.videoWidth))) {
		throw new Error('no video')
	}
	const surf = ink.parentElement
	// доска: кадра нет, PNG вдвое крупнее холста на экране
	const vw = board ? Math.round(surf.clientWidth * 2) : video.videoWidth
	const vh = board ? Math.round(surf.clientHeight * 2) : video.videoHeight
	const W = surf.clientWidth || vw
	const H = surf.clientHeight || vh
	const k = vw / W
	const cv = document.createElement('canvas')
	cv.width = vw
	cv.height = vh
	const ctx = cv.getContext('2d')
	if (board) {
		ctx.fillStyle = getComputedStyle(surf).backgroundColor
		ctx.fillRect(0, 0, vw, vh)
	} else {
		ctx.drawImage(video, 0, 0, vw, vh)
	}

	// штрихи: клон постоянных групп, computed-стили вшиваем (CSS слоя в изолированный SVG не попадёт)
	const NS = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(NS, 'svg')
	svg.setAttribute('xmlns', NS)
	svg.setAttribute('width', vw)
	svg.setAttribute('height', vh)
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
	ink.querySelectorAll(':scope > g').forEach((g) => {
		if (!keep(g.getAttribute('class')?.split(' ')[0], g.dataset.ttl, g, all)) {
			return
		}
		const c = g.cloneNode(true)
		const src = g.querySelectorAll('*')
		c.querySelectorAll('*').forEach((el, i) => {
			const cs = getComputedStyle(src[i])
			el.setAttribute('style', STYLE.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'))
		})
		c.setAttribute('style', 'opacity:1')
		svg.append(c)
	})
	const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
	ctx.drawImage(await loadImg(url), 0, 0, vw, vh)

	// Подписи: одна на автора (у его первой постоянной пометки, не у текста — текст и так его цветом),
	// размер 1,6% высоты кадра, целиком в кадре, не поверх текстов.
	// Разрешение PNG = разрешение принятого видео: у гостя при показе 4K приходит 1920x1080/2560x1440, у показывающего полное.
	const fh = vh * 0.016 * 1.6 // высота капсулы; кегль 1,6% высоты кадра
	const texts = [...ink.querySelectorAll(':scope > g.text')].filter((g) => keep('text', g.dataset.ttl, g, all)).map((g) => {
		const r = g.querySelector('rect')
		return r && [+r.getAttribute('x') * k, +r.getAttribute('y') * k, +r.getAttribute('width') * k, +r.getAttribute('height') * k]
	}).filter(Boolean)
	const done = new Set()
	const placed = []
	const hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
	ctx.textBaseline = 'middle'
	ctx.font = `700 ${vh * 0.016}px sans-serif`
	ink.parentElement.querySelectorAll('.k4-chip').forEach((el) => {
		const by = el.dataset.by
		if (el.dataset.tool === 'text' || done.has(by) || !keep(el.dataset.tool, el.dataset.ttl, el, all)) {
			return
		}
		const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)
		if (!m) {
			return
		}
		done.add(by)
		const name = el.textContent === 'Вы' ? useActorStore().displayName || 'Вы' : el.textContent
		const pad = fh * 0.45
		const w = ctx.measureText(name).width + pad * 2
		const box = [Math.max(0, Math.min(vw - w, m[1] * k)), Math.max(0, Math.min(vh - fh, m[2] * k)), w, fh]
		for (const o of [...texts, ...placed]) {
			if (hit(box, o)) {
				box[1] = o[1] - fh - 2 >= 0 ? o[1] - fh - 2 : Math.min(vh - fh, o[1] + o[3] + 2)
			}
		}
		placed.push(box)
		ctx.fillStyle = el.style.getPropertyValue('--c') || '#b98bff'
		ctx.beginPath()
		ctx.roundRect(box[0], box[1], w, fh, fh / 2)
		ctx.fill()
		ctx.fillStyle = '#1d1819'
		ctx.fillText(name, box[0] + pad, box[1] + fh / 2)
	})
	return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

/**
 * Копия снимка уменьшается и улетает в кнопку.
 *
 * @param blob
 * @param btn
 */
function fly(blob, btn) {
	if (!btn || matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return
	}
	const img = document.createElement('img')
	img.src = URL.createObjectURL(blob)
	const b = btn.getBoundingClientRect()
	const w = Math.min(window.innerWidth * 0.5, 480)
	img.style.cssText = `position:fixed;z-index:3100;pointer-events:none;border-radius:12px;box-shadow:0 8px 30px #0008;left:${innerWidth / 2 - w / 2}px;top:${innerHeight / 2 - w * 0.3}px;width:${w}px;transform-origin:0 0`
	document.body.append(img)
	const s = 36 / w
	const a = img.animate([
		{ transform: 'none', opacity: 1 },
		{ transform: `translate(${b.left + b.width / 2 - (innerWidth / 2 - w / 2) - 18}px,${b.top + b.height / 2 - (innerHeight / 2 - w * 0.3) - 12}px) scale(${s})`, opacity: 0.4 },
	], { duration: 560, easing: SP.in, fill: 'forwards' })
	a.onfinish = () => {
		img.remove()
		URL.revokeObjectURL(img.src)
	}
}

/** Имя файла снимка по времени. */
function fileName() {
	const d = new Date()
	const p2 = (n) => String(n).padStart(2, '0')
	return `Снимок ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}.png`
}

/**
 * Кнопка снимка в капсуле: доска или кадр показа с пометками → сервер (Talk/Recording/<token>/Снимки/, к выжимке звонка).
 * На телефоне — ещё системное «Поделиться», гостю на компьютере — скачать (своих Файлов у гостя нет).
 *
 * @param {string} token комнаты
 * @param {HTMLElement|null} btn кнопка (цель анимации)
 * @param {boolean} quiet автоснимок при выходе: без «Поделиться», скачивания и тоста об ошибке
 * @return {Promise<boolean>} сохранён ли на сервере
 */
export async function shoot(token, btn = null, quiet = false) {
	if (snap.busy || !state.big) {
		return false
	}
	snap.busy = true
	try {
		const blob = await render(true)
		fly(blob, btn)
		// ket4tec (NAS_CLOUD#103 п.40): снимок тихо уходит в Файлы, без системного окна «Поделиться»; гостю (у него нет Файлов) — скачать
		if (!quiet && amGuest()) {
			save(blob)
		}
		const fd = new FormData()
		fd.append('image', blob, 'snapshot.png')
		const res = await axios.post(generateOcsUrl('apps/spreed/api/v1/k4draw/{token}/snapshot', { token }), fd)
		const id = res.data?.ocs?.data?.id
		sendSnap(snap.n + 1)
		const link = id && !amGuest() ? generateUrl('/f/{id}', { id }) : ''
		showSuccess(link ? 'Сохранено · открыть' : 'Сохранено', link ? { onClick: () => window.open(link, '_blank', 'noopener') } : {})
		return true
	} catch (e) {
		console.error('k4draw shoot', e)
		quiet || showError('Снимок не сохранился')
		return false
	} finally {
		snap.busy = false
	}
}

/**
 * PNG скачивается (гость, приложение для Мака).
 *
 * @param {Blob} blob
 */
function save(blob) {
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = fileName()
	document.body.append(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * «Снимок»: кадр показа с пометками, которые сейчас на экране, — PNG скачивается тому, кто нажал.
 *
 * @return {Promise<boolean>} сохранён ли
 */
export async function downloadSnapshot() {
	if (snap.busy || !state.big) {
		return false
	}
	snap.busy = true
	try {
		save(await render(true))
		return true
	} catch (e) {
		console.error('k4draw download snapshot', e)
		showError('Снимок не получился')
		return false
	} finally {
		snap.busy = false
	}
}

/**
 * Снимок показывающего из приложения для Мака: свой показ крупно у него не открыт (плашка «Вы демонстрируете экран»),
 * поэтому кадр берём из своего потока экрана, а пометки — готовым PNG слоя приложения (как они на экране).
 * Работает и в фоновой вкладке: ждём события видео, а не таймеры.
 *
 * @param {string} png base64 PNG слоя пометок от приложения
 * @return {Promise<boolean>} сохранён ли
 */
export async function screenSnapshot(png) {
	const track = localScreen()?.getVideoTracks()[0]
	if (snap.busy || !track || track.readyState !== 'live') {
		return false
	}
	snap.busy = true
	const v = document.createElement('video')
	try {
		const ink = await loadImg('data:image/png;base64,' + png)
		v.muted = true
		v.playsInline = true
		v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none' // Safari не отдаёт кадры <video> вне документа
		document.body.append(v)
		v.srcObject = new MediaStream([track])
		await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(new Error('no frame')), 10000)
			v.addEventListener('loadeddata', () => {
				clearTimeout(t)
				resolve()
			}, { once: true })
			v.play().catch(() => {})
		})
		const vw = v.videoWidth
		const vh = v.videoHeight
		if (!vw || !vh) {
			throw new Error('no video')
		}
		const cv = document.createElement('canvas')
		cv.width = vw
		cv.height = vh
		const ctx = cv.getContext('2d')
		ctx.drawImage(v, 0, 0, vw, vh)
		ctx.drawImage(ink, 0, 0, vw, vh)
		save(await new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png')))
		return true
	} catch (e) {
		console.error('k4draw screen snapshot', e)
		return false
	} finally {
		v.srcObject = null
		v.remove()
		snap.busy = false
	}
}

// ket4tec: k4draw. Последний уходит из звонка с рисунком на доске: снимок в Файлы без вопросов
setAutoSnap(() => shoot(useTokenStore().token, null, true))
