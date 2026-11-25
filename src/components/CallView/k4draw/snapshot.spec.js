/*
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { showError, showSuccess } from '@nextcloud/dialogs'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { shoot, snap } from './snapshot.js'
import { amGuest, sendSnap } from './useDrawing.js'

vi.mock('@nextcloud/axios', () => ({ default: { post: vi.fn() } }))
vi.mock('../../../stores/actor.ts', () => ({ useActorStore: vi.fn() }))
vi.mock('../../../stores/token.ts', () => ({ useTokenStore: vi.fn() }))
vi.mock('./pdfBg.js', () => ({ bgSrc: vi.fn() }))
vi.mock('./useDrawing.js', () => ({
	amGuest: vi.fn(),
	sendSnap: vi.fn(),
	setAutoSnap: vi.fn(),
	state: { big: 'board' },
}))

describe('shoot', () => {
	let board
	let download
	const response = { data: { ocs: { data: { id: 42 } } } }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		amGuest.mockReturnValue(true)
		board = document.createElement('div')
		board.className = 'k4-board'
		board.innerHTML = '<div><div class="k4-ink"></div></div>'
		document.body.append(board)
		vi.stubGlobal('Image', class {
			set src(_url) {
				queueMicrotask(() => this.onload())
			}
		})
		vi.stubGlobal('URL', class extends URL {
			static createObjectURL = vi.fn(() => 'blob:snapshot')
			static revokeObjectURL = vi.fn()
		})
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() })
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
		download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
	})

	afterEach(() => {
		board.remove()
		vi.useRealTimers()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	test('downloads for guests after the server response and success toast', async () => {
		const { promise, resolve } = Promise.withResolvers()
		axios.post.mockReturnValueOnce(promise)

		const result = shoot('room')
		await vi.waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1))
		expect(snap.busy).toBe(true)
		expect(download).not.toHaveBeenCalled()
		expect(showSuccess).not.toHaveBeenCalled()

		resolve(response)
		await expect(result).resolves.toBe(true)
		expect(sendSnap).toHaveBeenCalledWith(1)
		expect(showSuccess).toHaveBeenCalledBefore(download)
		expect(download).toHaveBeenCalledTimes(1)
		expect(snap.busy).toBe(false)
	})

	test('still downloads for guests after a failed upload', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		axios.post.mockRejectedValueOnce(new Error('upload failed'))

		await expect(shoot('room')).resolves.toBe(false)
		expect(showError).toHaveBeenCalledWith('Снимок не сохранился')
		expect(showError).toHaveBeenCalledBefore(download)
		expect(download).toHaveBeenCalledTimes(1)
		expect(sendSnap).not.toHaveBeenCalled()
		expect(snap.busy).toBe(false)
	})

	test.each([
		{ guest: true, quiet: true, toast: 'Сохранено' },
		{ guest: false, quiet: false, toast: 'Сохранено · открыть' },
	])('saves without downloading for guest=$guest and quiet=$quiet', async ({ guest, quiet, toast }) => {
		amGuest.mockReturnValue(guest)
		axios.post.mockResolvedValueOnce(response)

		await expect(shoot('room', null, quiet)).resolves.toBe(true)
		expect(showSuccess).toHaveBeenCalledWith(toast, expect.any(Object))
		expect(download).not.toHaveBeenCalled()
	})
})
