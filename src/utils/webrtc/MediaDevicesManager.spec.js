/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { calllog } from '../calllog.js'
import MediaDevicesManager from './MediaDevicesManager.js'

vi.mock('../calllog.js', () => ({ calllog: vi.fn() }))

describe('MediaDevicesManager getUserMedia', () => {
	afterEach(() => {
		vi.clearAllMocks()
		vi.unstubAllGlobals()
	})

	test.each([true, false])('rejects one denied capture while device enumeration was pending (success: %s)', async (enumerationSucceeds) => {
		const denial = new DOMException('Access denied', 'NotAllowedError')
		const manager = new MediaDevicesManager()
		const getUserMedia = vi.fn().mockRejectedValue(denial)
		const enumerateDevices = vi.fn().mockResolvedValue([])
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices } })
		manager._pendingEnumerateDevicesPromise = enumerationSucceeds ? Promise.resolve() : Promise.reject(new Error('Enumeration failed'))

		await expect(manager.getUserMedia({ audio: true }, 'preview')).rejects.toBe(denial)
		expect(getUserMedia).toHaveBeenCalledTimes(1)
		expect(calllog).toHaveBeenCalledExactlyOnceWith('gum_err', { name: 'NotAllowedError', a: true, v: false, src: 'preview' })
	})
})
