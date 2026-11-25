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
	let loadedImage
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
			set src(url) {
				loadedImage = url
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

	test.each([
		{ guest: false, screen: false, width: 400, height: 200 },
		{ guest: true, screen: true, width: 800, height: 400 },
	])('keeps full text within the PNG frame for guest=$guest and screen=$screen', async ({ guest, screen, width, height }) => {
		amGuest.mockReturnValue(guest)
		axios.post.mockResolvedValueOnce(response)
		board.className = screen ? 'screenContainer k4-layer' : 'k4-board'
		if (screen) {
			const video = document.createElement('video')
			Object.defineProperties(video, {
				videoWidth: { value: width },
				videoHeight: { value: height },
			})
			board.append(video)
		}
		const surface = board.firstElementChild
		Object.defineProperties(surface, {
			clientWidth: { value: 200 },
			clientHeight: { value: 100 },
		})
		surface.innerHTML = `<svg class="k4-ink" xmlns="http://www.w3.org/2000/svg">
			<g class="text"><rect x="-4" y="-6" width="40" height="20"/><text>Top left</text></g>
			<g class="text"><rect x="184" y="89" width="40" height="20"/><text>Bottom right</text></g>
			<g class="text"><rect x="20" y="40" width="40" height="20"/><text>Inside</text></g>
			<g class="marker"><path d="M 1 2 L 3 4"/></g>
		</svg>
		<span class="k4-chip" data-tool="marker" data-by="1" style="transform: translate(8px, 15px)">Tester</span>`
		const source = surface.innerHTML
		const roundRect = vi.fn()
		vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
			fillRect: vi.fn(),
			drawImage: vi.fn(),
			measureText: () => ({ width: 20 }),
			beginPath: vi.fn(),
			roundRect,
			fill: vi.fn(),
			fillText: vi.fn(),
		})

		await expect(shoot('room')).resolves.toBe(true)

		const output = document.createElement('template')
		output.innerHTML = decodeURIComponent(loadedImage.split(',')[1])
		const svg = output.content.firstElementChild
		const groups = [...svg.children]
		expect(groups.map((group) => group.getAttribute('transform'))).toEqual([
			'translate(4,6)',
			'translate(-24,-9)',
			null,
			null,
		])
		expect(groups.map((group) => group.textContent)).toEqual(['Top left', 'Bottom right', 'Inside', ''])
		for (const rect of svg.querySelectorAll('rect')) {
			expect(rect.getAttribute('width')).toBe('40')
			expect(rect.getAttribute('height')).toBe('20')
		}
		expect(surface.innerHTML).toBe(source)
		expect(svg.getAttribute('viewBox')).toBe('0 0 200 100')
		expect(svg.getAttribute('width')).toBe(String(width))
		expect(svg.getAttribute('height')).toBe(String(height))
		expect(roundRect.mock.calls[0][1]).toBe(20 * (width / 200) + 2)
		const [canvas] = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts
		expect(canvas).toMatchObject({ width, height })
		const [[, form]] = axios.post.mock.calls
		expect(form.get('image')).toMatchObject({ type: 'image/png', name: 'snapshot.png' })
		expect(download).toHaveBeenCalledTimes(guest ? 1 : 0)
	})
})
