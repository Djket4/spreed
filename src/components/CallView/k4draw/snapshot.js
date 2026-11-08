/**
 * ket4tec: k4draw. Снимок «кадр показа + постоянные пометки» → PNG → сервер (K4DrawController).
 * Пометки берём из DOM слоя (тот же рендер, что на экране): клон SVG постоянных штрихов с вшитыми стилями + подписи рисуются на canvas.
 */
import axios from '@nextcloud/axios'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { generateOcsUrl } from '@nextcloud/router'
import { reactive } from 'vue'
import { myId, onDraw, sendSnap, SP, state } from './useDrawing.js'

export const snap = reactive({ n: 0, k: '', busy: false })
const PERM = ['marker', 'arrow', 'frame'] // ponytail: тексты (блок 3) добавить сюда, когда слой начнёт их рисовать в .k4-ink
const STYLE = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity']

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
			showSuccess(`${ev.name} сохранил(а) снимок`)
		}
	})
}

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
 * @return {Promise<Blob>} PNG
 */
async function render() {
	const ink = document.querySelector('.k4-layer .k4-ink')
	const video = ink?.closest('.screenContainer')?.querySelector('video')
	if (!ink || !video || !video.videoWidth) {
		throw new Error('no video')
	}
	const vw = video.videoWidth
	const vh = video.videoHeight
	const surf = ink.parentElement
	const W = surf.clientWidth || vw
	const H = surf.clientHeight || vh
	const k = vw / W
	const cv = document.createElement('canvas')
	cv.width = vw
	cv.height = vh
	const ctx = cv.getContext('2d')
	ctx.drawImage(video, 0, 0, vw, vh)

	// штрихи: клон постоянных групп, computed-стили вшиваем (CSS слоя в изолированный SVG не попадёт)
	const NS = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(NS, 'svg')
	svg.setAttribute('xmlns', NS)
	svg.setAttribute('width', vw)
	svg.setAttribute('height', vh)
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
	ink.querySelectorAll(':scope > g').forEach((g) => {
		if (!PERM.includes(g.getAttribute('class')?.split(' ')[0]) || g.classList.contains('out')) {
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

	// подписи с именами (постоянные, без «гаснущих»)
	ctx.textBaseline = 'middle'
	ink.parentElement.querySelectorAll('.k4-chip').forEach((el) => {
		if (!PERM.includes(el.dataset.tool) || el.classList.contains('out')) {
			return
		}
		const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform)
		if (!m) {
			return
		}
		const [x, y, h] = [m[1] * k, m[2] * k, 26 * k]
		const w = el.offsetWidth * k
		ctx.fillStyle = el.style.getPropertyValue('--c') || '#b98bff'
		ctx.beginPath()
		ctx.roundRect(x, y, w, h, h / 2)
		ctx.fill()
		ctx.fillStyle = '#1d1819'
		ctx.font = `700 ${12.5 * k}px sans-serif`
		ctx.fillText(el.textContent, x + 11 * k, y + h / 2 + k)
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

/**
 * @param {string} token комнаты
 * @param {HTMLElement|null} btn кнопка «В выжимку» (цель анимации)
 */
export async function takeSnapshot(token, btn) {
	if (snap.busy || !state.big) {
		return
	}
	snap.busy = true
	try {
		const blob = await render()
		const fd = new FormData()
		fd.append('image', blob, 'snapshot.png')
		fly(blob, btn)
		await axios.post(generateOcsUrl('apps/spreed/api/v1/k4draw/{token}/snapshot', { token }), fd)
		sendSnap(snap.n + 1)
		showSuccess('Снимок в выжимке')
	} catch (e) {
		console.error('k4draw snapshot', e)
		showError('Снимок не сохранился')
	} finally {
		snap.busy = false
	}
}
