/**
 * ket4tec (NAS_CLOUD#107): страницы PDF как фон доски. pdf.js берём с сервера (приложение files_pdfviewer),
 * в зависимости сборки он не входит. Каждый клиент сам качает PDF и рисует страницу в картинку.
 */
import { generateFilePath } from '@nextcloud/router'
import { bgUrl } from './useDrawing.js'

const SIDE = 1600 // длинная сторона картинки страницы, px
const KEEP = 6 // страниц в памяти; старые отпускаем

let lib = null
const docs = new Map() // `${token}/${id}` → Promise<PDFDocumentProxy>
const pages = new Map() // `${token}/${id}/${page}` → Promise<objectURL>, порядок вставки = давность

/** pdf.js с сервера (динамический import мимо webpack). */
function loadLib() {
	lib ??= import(/* webpackIgnore: true */ generateFilePath('files_pdfviewer', '', 'js/pdfjs/build/pdf.mjs')).then((m) => {
		m.GlobalWorkerOptions.workerSrc = generateFilePath('files_pdfviewer', '', 'js/pdfjs/build/pdf.worker.mjs')
		return m
	}).catch((e) => {
		lib = null
		throw e
	})
	return lib
}

/**
 *
 * @param token
 * @param id
 */
function openDoc(token, id) {
	const k = token + '/' + id
	if (!docs.has(k)) {
		const p = loadLib().then((m) => m.getDocument({ url: bgUrl({ t: 'p', id }), withCredentials: true }).promise)
		p.catch(() => docs.delete(k))
		docs.set(k, p)
	}
	return docs.get(k)
}

/**
 * Число страниц PDF из беседы.
 *
 * @param {string} token беседа
 * @param {number} id id сообщения с файлом
 * @return {Promise<number>}
 */
export async function pdfPages(token, id) {
	return (await openDoc(token, id)).numPages
}

/**
 * Страница PDF как адрес картинки (objectURL).
 *
 * @param {string} token беседа
 * @param {number} id id сообщения с файлом
 * @param {number} page страница, с 1
 * @return {Promise<string>}
 */
export function pdfPageUrl(token, id, page) {
	const k = token + '/' + id + '/' + page
	if (!pages.has(k)) {
		const p = (async () => {
			const pg = await (await openDoc(token, id)).getPage(page)
			const v1 = pg.getViewport({ scale: 1 })
			const viewport = pg.getViewport({ scale: SIDE / Math.max(v1.width, v1.height) })
			const cv = document.createElement('canvas')
			cv.width = Math.ceil(viewport.width)
			cv.height = Math.ceil(viewport.height)
			await pg.render({ canvasContext: cv.getContext('2d'), viewport }).promise
			const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.9))
			cv.width = cv.height = 0
			return URL.createObjectURL(blob)
		})()
		p.catch(() => pages.delete(k))
		pages.set(k, p)
		while (pages.size > KEEP) {
			const [old] = pages.keys()
			pages.get(old).then((u) => URL.revokeObjectURL(u), () => {})
			pages.delete(old)
		}
	}
	return pages.get(k)
}

/**
 * Адрес картинки фона любого вида: снимок и картинка беседы — по адресу, PDF — отрисованная страница.
 *
 * @param {object} bg фон доски
 * @param {string} token беседа
 * @return {Promise<string>}
 */
export async function bgSrc(bg, token) {
	return bg.t === 'p' ? pdfPageUrl(token, bg.id, bg.page) : bgUrl(bg)
}
