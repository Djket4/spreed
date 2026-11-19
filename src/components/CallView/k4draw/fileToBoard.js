/**
 * ket4tec (NAS_CLOUD#107): файл беседы (картинка или PDF) — на доску у всех; файл с устройства сперва уходит в беседу.
 */
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import store from '../../../store/index.js'
import { useTokenStore } from '../../../stores/token.ts'
import { useUploadStore } from '../../../stores/upload.ts'
import { isTemporaryId } from '../../../utils/message.ts'
import { pdfPages } from './pdfBg.js'
import { canShow, showImage } from './useDrawing.js'

export const BOARD_FILE_TYPES = ['image/png', 'image/jpeg', 'application/pdf']
const WAIT_MS = 45000 // загрузка и появление сообщения в беседе

/**
 * «Показать всем» файл беседы: картинка — фон доски, PDF — страница 1 с листанием.
 *
 * @param {number} id id сообщения беседы с файлом
 * @param {boolean} pdf файл — PDF
 * @return {Promise<string>} '' — показано, иначе причина
 */
export async function showChatFile(id, pdf) {
	const token = useTokenStore().token
	const bg = pdf ? { t: 'p', id, page: 1, pages: await pdfPages(token, id) } : { t: 'm', id }
	const denied = canShow(bg)
	return denied || showImage(bg, () => axios.post(generateOcsUrl('apps/spreed/api/v1/k4draw/{token}/image/{id}', { token, id })))
}

/**
 * Файл с устройства: в беседу штатным путём Talk (как вложение), затем на доску.
 *
 * @param {File} file png, jpeg или pdf
 * @return {Promise<string>} '' — показано, иначе причина
 */
export async function fileToBoard(file) {
	if (!BOARD_FILE_TYPES.includes(file.type)) {
		return 'На доску можно положить картинку PNG или JPEG либо PDF'
	}
	const token = useTokenStore().token
	// сразу проверим, что доска не занята, чтобы не лить файл зря
	const denied = canShow({ t: 'm', id: 1 })
	if (denied) {
		return denied
	}
	const uploads = useUploadStore()
	const uploadId = 'k4board' + Date.now()
	uploads.initialiseUpload({ uploadId, token, files: [file] })
	const ref = uploads.getInitialisedUploads(uploadId)[0][1].temporaryMessage.referenceId
	await uploads.uploadFiles({ token, uploadId, caption: null, options: null, allowUpdate: undefined, compressImages: false })
	// настоящее сообщение приходит по тому же referenceId
	const t0 = Date.now()
	for (;;) {
		const m = store.getters.messagesList(token).find((x) => x.referenceId === ref && !isTemporaryId(x.id) && x.messageParameters?.file)
		if (m) {
			return showChatFile(+m.id, (m.messageParameters.file.mimetype || file.type) === 'application/pdf')
		}
		if (Date.now() - t0 > WAIT_MS) {
			return 'Файл не дошёл до беседы: попробуйте ещё раз'
		}
		await new Promise((r) => setTimeout(r, 400))
	}
}
